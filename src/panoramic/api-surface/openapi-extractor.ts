/**
 * OpenAPI / Swagger Schema 解析
 */
import * as path from 'node:path';
import type { ApiEndpoint, ApiParameter, ApiParameterLocation, ApiResponse, ExtractionResult } from './types.js';
import {
  collectProjectFiles,
  getRelativePath,
  HTTP_METHODS,
  OPENAPI_FILE_PATTERN,
  tryReadFile,
  uniqueStrings,
} from './utils.js';
import { dedupeEndpoints, renderResponseType } from './endpoint-utils.js';

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveRef(doc: unknown, ref: unknown): unknown {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    return null;
  }

  const segments = ref.slice(2).split('/').map(decodeJsonPointerSegment);
  let current: unknown = doc;
  for (const segment of segments) {
    if (!isPlainObject(current) && !Array.isArray(current)) {
      return null;
    }
    current = (current as any)[segment];
  }
  return current ?? null;
}

function dereference<T>(doc: unknown, value: T): T {
  if (!isPlainObject(value) || typeof value.$ref !== 'string') {
    return value;
  }

  const resolved = resolveRef(doc, value.$ref);
  if (!resolved || !isPlainObject(resolved)) {
    return value;
  }

  return {
    ...(resolved as Record<string, unknown>),
    ...Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== '$ref'),
    ),
  } as T;
}

function formatSchemaType(doc: unknown, schema: unknown): string {
  if (!schema) {
    return 'unknown';
  }

  if (isPlainObject(schema) && typeof schema.$ref === 'string') {
    const refSegments = schema.$ref.split('/');
    return refSegments[refSegments.length - 1] ?? 'unknown';
  }

  const resolvedSchema = dereference(doc, schema as Record<string, unknown>);
  if (!isPlainObject(resolvedSchema)) {
    return 'unknown';
  }

  if (Array.isArray(resolvedSchema.oneOf) && resolvedSchema.oneOf.length > 0) {
    return uniqueStrings(resolvedSchema.oneOf.map((item) => formatSchemaType(doc, item))).join(' | ');
  }

  if (Array.isArray(resolvedSchema.anyOf) && resolvedSchema.anyOf.length > 0) {
    return uniqueStrings(resolvedSchema.anyOf.map((item) => formatSchemaType(doc, item))).join(' | ');
  }

  if (Array.isArray(resolvedSchema.allOf) && resolvedSchema.allOf.length > 0) {
    return uniqueStrings(resolvedSchema.allOf.map((item) => formatSchemaType(doc, item))).join(' & ');
  }

  if (Array.isArray(resolvedSchema.enum) && resolvedSchema.enum.length > 0) {
    return `enum(${resolvedSchema.enum.map(String).join(', ')})`;
  }

  if (resolvedSchema.type === 'array') {
    return `${formatSchemaType(doc, resolvedSchema.items)}[]`;
  }

  if (resolvedSchema.type === 'object' && resolvedSchema.additionalProperties) {
    return `Record<string, ${formatSchemaType(doc, resolvedSchema.additionalProperties)}>`;
  }

  if (typeof resolvedSchema.type === 'string') {
    return resolvedSchema.type;
  }

  if (isPlainObject(resolvedSchema.properties)) {
    return 'object';
  }

  return 'unknown';
}

function normalizeSchemaParameters(doc: unknown, rawParameters: unknown[]): ApiParameter[] {
  const parameters: ApiParameter[] = [];

  for (const rawParameter of rawParameters) {
    const parameter = dereference(doc, rawParameter as Record<string, unknown>);
    if (!isPlainObject(parameter)) {
      continue;
    }

    const name = typeof parameter.name === 'string' ? parameter.name : 'body';
    const location = typeof parameter.in === 'string'
      ? parameter.in as ApiParameterLocation
      : 'unknown';

    let type = 'unknown';
    if (parameter.schema) {
      type = formatSchemaType(doc, parameter.schema);
    } else if (parameter.content && isPlainObject(parameter.content)) {
      const firstContent = Object.values(parameter.content)[0];
      type = formatSchemaType(doc, isPlainObject(firstContent) ? firstContent.schema : undefined);
    }

    parameters.push({
      name,
      in: location,
      type,
      required: location === 'path' ? true : Boolean(parameter.required),
      description: typeof parameter.description === 'string' ? parameter.description : undefined,
    });
  }

  return parameters;
}

function extractRequestBodyParameter(doc: unknown, rawRequestBody: unknown): ApiParameter[] {
  const requestBody = dereference(doc, rawRequestBody as Record<string, unknown>);
  if (!isPlainObject(requestBody) || !isPlainObject(requestBody.content)) {
    return [];
  }

  const preferredContent =
    requestBody.content['application/json'] ??
    Object.values(requestBody.content)[0];

  const schema = isPlainObject(preferredContent) ? preferredContent.schema : undefined;
  return [{
    name: 'body',
    in: 'body',
    type: formatSchemaType(doc, schema),
    required: Boolean(requestBody.required),
    description: typeof requestBody.description === 'string' ? requestBody.description : undefined,
  }];
}

function extractSchemaResponses(doc: unknown, rawResponses: unknown): ApiResponse[] {
  if (!isPlainObject(rawResponses)) {
    return [];
  }

  const responses: ApiResponse[] = [];
  for (const [statusCode, rawValue] of Object.entries(rawResponses)) {
    const response = dereference(doc, rawValue as Record<string, unknown>);
    if (!isPlainObject(response)) {
      continue;
    }

    let type = 'unknown';
    if (isPlainObject(response.content)) {
      const preferredContent =
        response.content['application/json'] ??
        Object.values(response.content)[0];
      type = formatSchemaType(doc, isPlainObject(preferredContent) ? preferredContent.schema : undefined);
    } else if (response.schema) {
      type = formatSchemaType(doc, response.schema);
    }

    responses.push({
      statusCode,
      type,
      description: typeof response.description === 'string' ? response.description : undefined,
    });
  }

  const preferred = responses
    .filter((response) => /^2\d\d$/.test(response.statusCode))
    .sort((a, b) => a.statusCode.localeCompare(b.statusCode));

  if (preferred.length > 0) {
    return [...preferred, ...responses.filter((response) => !/^2\d\d$/.test(response.statusCode))];
  }

  return responses.sort((a, b) => a.statusCode.localeCompare(b.statusCode));
}

function extractSecuritySchemes(rawSecurity: unknown): string[] {
  if (!Array.isArray(rawSecurity)) {
    return [];
  }

  const schemeNames: string[] = [];
  for (const entry of rawSecurity) {
    if (!isPlainObject(entry)) {
      continue;
    }
    schemeNames.push(...Object.keys(entry));
  }
  return uniqueStrings(schemeNames).sort();
}

export function extractFromSchema(projectRoot: string): ExtractionResult | null {
  const schemaFiles = collectProjectFiles(projectRoot, {
    extensions: ['.json', '.yaml', '.yml'],
    fileNamePattern: OPENAPI_FILE_PATTERN,
  });

  const endpoints: ApiEndpoint[] = [];
  const sourceFiles: string[] = [];

  for (const filePath of schemaFiles) {
    if (path.extname(filePath).toLowerCase() !== '.json') {
      continue;
    }

    const content = tryReadFile(filePath);
    if (!content) {
      continue;
    }

    let doc: unknown;
    try {
      doc = JSON.parse(content);
    } catch {
      continue;
    }

    if (!isPlainObject(doc) || !isPlainObject(doc.paths)) {
      continue;
    }

    const globalSecurity = extractSecuritySchemes(doc.security);
    sourceFiles.push(getRelativePath(projectRoot, filePath));

    for (const [rawPath, rawPathItem] of Object.entries(doc.paths)) {
      if (!isPlainObject(rawPathItem)) {
        continue;
      }

      const pathLevelParameters = normalizeSchemaParameters(
        doc,
        Array.isArray(rawPathItem.parameters) ? rawPathItem.parameters : [],
      );
      const pathLevelSecurity = extractSecuritySchemes(rawPathItem.security);

      for (const method of HTTP_METHODS) {
        const operation = rawPathItem[method];
        if (!isPlainObject(operation)) {
          continue;
        }

        const operationParameters = normalizeSchemaParameters(
          doc,
          Array.isArray(operation.parameters) ? operation.parameters : [],
        );
        const requestBodyParameters = extractRequestBodyParameter(doc, operation.requestBody);
        const responses = extractSchemaResponses(doc, operation.responses);
        const tags = Array.isArray(operation.tags)
          ? operation.tags.filter((tag): tag is string => typeof tag === 'string')
          : [];
        const auth = uniqueStrings([
          ...extractSecuritySchemes(operation.security),
          ...pathLevelSecurity,
          ...globalSecurity,
        ]);

        endpoints.push({
          method: method.toUpperCase(),
          path: rawPath,
          parameters: [...pathLevelParameters, ...operationParameters, ...requestBodyParameters],
          responses,
          responseType: renderResponseType(responses),
          auth,
          tags,
          source: 'schema',
          sourceFile: getRelativePath(projectRoot, filePath),
          summary: typeof operation.summary === 'string' ? operation.summary : undefined,
          operationId: typeof operation.operationId === 'string' ? operation.operationId : undefined,
        });
      }
    }
  }

  const deduped = dedupeEndpoints(endpoints);
  if (deduped.length === 0) {
    return null;
  }

  return {
    source: 'schema',
    endpoints: deduped,
    sourceFiles: uniqueStrings(sourceFiles).sort(),
  };
}
