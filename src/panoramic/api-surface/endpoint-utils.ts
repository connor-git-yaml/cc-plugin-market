/**
 * 端点级工具函数 — 去重、标准化、标签推导等
 */
import * as path from 'node:path';
import type { ApiEndpoint, ApiParameter, ApiParameterLocation, ApiResponse } from './types.js';
import { AUTH_HINT_PATTERN, GENERIC_TAG_SEGMENTS, uniqueStrings } from './utils.js';

export function unwrapPromiseType(typeText: string): string {
  let current = typeText.trim();
  while (/^Promise<.*>$/.test(current)) {
    current = current.replace(/^Promise<(.*)>$/, '$1').trim();
  }
  return current || 'unknown';
}

export function normalizeTypeText(typeText: string | undefined): string {
  if (!typeText || typeText.trim().length === 0) {
    return 'unknown';
  }
  return unwrapPromiseType(typeText.replace(/\s+/g, ' ').trim());
}

export function methodSortKey(method: string): number {
  const upper = method.toUpperCase();
  const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE', 'ALL'];
  const idx = order.indexOf(upper);
  return idx >= 0 ? idx : order.length;
}

export function dedupeParameters(parameters: ApiParameter[]): ApiParameter[] {
  const deduped = new Map<string, ApiParameter>();
  for (const parameter of parameters) {
    deduped.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...deduped.values()].sort((a, b) =>
    `${a.in}:${a.name}`.localeCompare(`${b.in}:${b.name}`),
  );
}

export function dedupeResponses(responses: ApiResponse[]): ApiResponse[] {
  const deduped = new Map<string, ApiResponse>();
  for (const response of responses) {
    deduped.set(`${response.statusCode}:${response.type}`, response);
  }
  return [...deduped.values()].sort((a, b) =>
    a.statusCode.localeCompare(b.statusCode),
  );
}

export function renderResponseType(responses: ApiResponse[]): string {
  if (responses.length === 0) {
    return 'unknown';
  }
  return responses
    .map((response) => `${response.statusCode}: ${response.type}`)
    .join(' | ');
}

export function extractPathParameters(pathValue: string): ApiParameter[] {
  const parameters: ApiParameter[] = [];
  const openApiPattern = /\{([^}]+)\}/g;
  const expressPattern = /:([A-Za-z_]\w*)/g;

  let match: RegExpExecArray | null;
  while ((match = openApiPattern.exec(pathValue)) !== null) {
    parameters.push({
      name: match[1]!,
      in: 'path' as ApiParameterLocation,
      type: 'string',
      required: true,
    });
  }

  while ((match = expressPattern.exec(pathValue)) !== null) {
    parameters.push({
      name: match[1]!,
      in: 'path' as ApiParameterLocation,
      type: 'string',
      required: true,
    });
  }

  return dedupeParameters(parameters);
}

export function isMeaningfulTagSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    !segment.startsWith(':') &&
    !segment.startsWith('{') &&
    !GENERIC_TAG_SEGMENTS.has(segment.toLowerCase()) &&
    !/^v\d+$/i.test(segment)
  );
}

export function deriveTags(pathValue: string, sourceFile?: string): string[] {
  const pathSegments = pathValue.split('/').filter(Boolean);
  const meaningful = pathSegments.find(isMeaningfulTagSegment);
  if (meaningful) {
    return [meaningful];
  }

  if (sourceFile) {
    const fileName = path.basename(sourceFile, path.extname(sourceFile));
    if (fileName.length > 0) {
      return [fileName];
    }
  }

  return ['default'];
}

export function isAuthHint(text: string): boolean {
  return AUTH_HINT_PATTERN.test(text);
}

export function collectAuthHints(names: string[]): string[] {
  return uniqueStrings(names.filter(isAuthHint)).sort();
}

export function finalizeEndpoint(endpoint: ApiEndpoint): ApiEndpoint {
  const parameters = dedupeParameters([
    ...extractPathParameters(endpoint.path),
    ...endpoint.parameters,
  ]);
  const responses = dedupeResponses(endpoint.responses);
  const tags = uniqueStrings(endpoint.tags).sort();
  const auth = uniqueStrings(endpoint.auth).sort();

  return {
    ...endpoint,
    method: endpoint.method.toUpperCase(),
    path: endpoint.path,
    parameters,
    responses,
    responseType: renderResponseType(responses),
    tags: tags.length > 0 ? tags : deriveTags(endpoint.path, endpoint.sourceFile),
    auth,
  };
}

export function dedupeEndpoints(endpoints: ApiEndpoint[]): ApiEndpoint[] {
  const merged = new Map<string, ApiEndpoint>();

  for (const rawEndpoint of endpoints) {
    const endpoint = finalizeEndpoint(rawEndpoint);
    const key = `${endpoint.method}:${endpoint.path}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, endpoint);
      continue;
    }

    merged.set(key, finalizeEndpoint({
      ...existing,
      parameters: [...existing.parameters, ...endpoint.parameters],
      responses: [...existing.responses, ...endpoint.responses],
      auth: [...existing.auth, ...endpoint.auth],
      tags: [...existing.tags, ...endpoint.tags],
      sourceFile: existing.sourceFile ?? endpoint.sourceFile,
      summary: existing.summary ?? endpoint.summary,
      operationId: existing.operationId ?? endpoint.operationId,
    }));
  }

  return [...merged.values()].sort((a, b) => {
    const pathCompare = a.path.localeCompare(b.path);
    if (pathCompare !== 0) {
      return pathCompare;
    }
    return methodSortKey(a.method) - methodSortKey(b.method);
  });
}
