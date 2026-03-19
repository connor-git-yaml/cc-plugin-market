/**
 * ApiSurfaceGenerator -- API Surface Reference 生成器
 *
 * 优先级固定为：
 * 1. 读取现有 OpenAPI / Swagger 产物
 * 2. 静态解析 FastAPI / tsoa 元数据
 * 3. Express AST fallback
 *
 * 实现 DocumentGenerator<ApiSurfaceInput, ApiSurfaceOutput> 接口。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project, Node } from 'ts-morph';
import type { DocumentGenerator, ProjectContext, GenerateOptions } from './interfaces.js';
import { loadTemplate } from './utils/template-loader.js';

// ============================================================
// 类型定义
// ============================================================

export type ApiSource = 'schema' | 'introspection' | 'ast';

export type ApiParameterLocation =
  | 'path'
  | 'query'
  | 'body'
  | 'header'
  | 'cookie'
  | 'form'
  | 'unknown';

export interface ApiParameter {
  name: string;
  in: ApiParameterLocation;
  type: string;
  required: boolean;
  description?: string;
}

export interface ApiResponse {
  statusCode: string;
  type: string;
  description?: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  parameters: ApiParameter[];
  responses: ApiResponse[];
  responseType: string;
  auth: string[];
  tags: string[];
  source: ApiSource;
  sourceFile?: string;
  summary?: string;
  operationId?: string;
}

export interface ApiSurfaceInput {
  projectName: string;
  source: ApiSource;
  endpoints: ApiEndpoint[];
  sourceFiles: string[];
}

export interface ApiSurfaceOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  source: ApiSource;
  endpoints: ApiEndpoint[];
  totalEndpoints: number;
  totalParameters: number;
  sourceFiles: string[];
  byMethod: Record<string, number>;
  tags: string[];
}

interface ExtractionResult {
  source: ApiSource;
  endpoints: ApiEndpoint[];
  sourceFiles: string[];
}

interface FileCollectionOptions {
  extensions?: string[];
  fileNamePattern?: RegExp;
}

interface RouterImportBinding {
  targetFile: string;
  exportName: string;
}

interface ExpressRouteDecl {
  method: string;
  path: string;
  middlewares: string[];
  sourceFile: string;
}

interface ExpressMountDecl {
  prefix: string;
  middlewares: string[];
  targetLocalName: string;
}

interface ExpressRouterDef {
  id: string;
  filePath: string;
  localName: string;
  kind: 'app' | 'router';
  routes: ExpressRouteDecl[];
  mounts: ExpressMountDecl[];
}

interface ExpressFileAnalysis {
  filePath: string;
  routers: Map<string, ExpressRouterDef>;
  defaultExport?: string;
  namedExports: Map<string, string>;
  imports: Map<string, RouterImportBinding>;
}

interface ResolvedExpressMount {
  prefix: string;
  middlewares: string[];
  targetId: string;
}

type ResolvedExpressRouterDef = Omit<ExpressRouterDef, 'mounts'> & {
  mounts: ResolvedExpressMount[];
};

interface FastApiRouteDecl {
  method: string;
  path: string;
  parameters: ApiParameter[];
  responseType: string;
  auth: string[];
  tags: string[];
  summary?: string;
  operationId?: string;
  sourceFile: string;
}

interface FastApiMountDecl {
  prefix: string;
  tags: string[];
  auth: string[];
  targetLocalName: string;
}

interface FastApiRouterDef {
  id: string;
  filePath: string;
  localName: string;
  kind: 'app' | 'router';
  prefix: string;
  tags: string[];
  auth: string[];
  routes: FastApiRouteDecl[];
  mounts: FastApiMountDecl[];
}

interface FastApiFileAnalysis {
  filePath: string;
  routers: Map<string, FastApiRouterDef>;
  imports: Map<string, RouterImportBinding>;
}

interface ResolvedFastApiMount {
  prefix: string;
  tags: string[];
  auth: string[];
  targetId: string;
}

type ResolvedFastApiRouterDef = Omit<FastApiRouterDef, 'mounts'> & {
  mounts: ResolvedFastApiMount[];
};

// ============================================================
// 常量
// ============================================================

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
] as const;

const HTTP_METHOD_SET = new Set<string>([...HTTP_METHODS, 'all']);
const TSOA_HTTP_DECORATORS = new Map<string, string>([
  ['Get', 'GET'],
  ['Post', 'POST'],
  ['Put', 'PUT'],
  ['Patch', 'PATCH'],
  ['Delete', 'DELETE'],
  ['Options', 'OPTIONS'],
  ['Head', 'HEAD'],
]);

const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
]);

const OPENAPI_FILE_PATTERN = /(?:^|[-_.])(openapi|swagger)(?:[-_.].*)?\.(json|yaml|yml)$/i;
const AUTH_HINT_PATTERN = /(auth|guard|jwt|session|passport|protected|require|permission|token|acl)/i;
const GENERIC_TAG_SEGMENTS = new Set(['api']);
const TS_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];
const PYTHON_EXTENSIONS = ['.py'];

// ============================================================
// 通用辅助函数
// ============================================================

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function uniqueStrings(items: Iterable<string>): string[] {
  return [...new Set(
    [...items]
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )];
}

function getRelativePath(projectRoot: string, filePath: string): string {
  return toPosixPath(path.relative(projectRoot, filePath));
}

function collectProjectFiles(
  projectRoot: string,
  options: FileCollectionOptions,
): string[] {
  const results: string[] = [];
  const allowedExtensions = new Set((options.extensions ?? []).map((ext) => ext.toLowerCase()));
  const fileNamePattern = options.fileNamePattern;

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const matchesExt = allowedExtensions.size === 0 || allowedExtensions.has(ext);
      const matchesName = fileNamePattern ? fileNamePattern.test(entry.name) : true;
      if (matchesExt && matchesName) {
        results.push(fullPath);
      }
    }
  }

  walk(projectRoot);
  results.sort();
  return results;
}

function detectProjectName(projectRoot: string): string {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (typeof pkg.name === 'string' && pkg.name.trim().length > 0) {
        return pkg.name.trim();
      }
    } catch {
      // ignore
    }
  }

  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // ignore
    }
  }

  return path.basename(projectRoot);
}

function joinUrlPaths(...segments: string[]): string {
  const parts: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === '/') {
      continue;
    }
    const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
    if (cleaned.length > 0) {
      parts.push(cleaned);
    }
  }

  if (parts.length === 0) {
    return '/';
  }

  return `/${parts.join('/')}`.replace(/\/{2,}/g, '/');
}

function splitTopLevel(text: string, separator = ','): string[] {
  const result: string[] = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escape = false;

  for (const ch of text) {
    if (quote) {
      current += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;

    if (
      ch === separator &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      const piece = current.trim();
      if (piece.length > 0) {
        result.push(piece);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    result.push(tail);
  }

  return result;
}

function extractBalancedContent(
  text: string,
  openParenIndex: number,
): { content: string; endIndex: number } | null {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escape = false;

  for (let i = openParenIndex; i < text.length; i++) {
    const ch = text[i]!;

    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '(') {
      depth++;
      continue;
    }

    if (ch === ')') {
      depth--;
      if (depth === 0) {
        return {
          content: text.slice(openParenIndex + 1, i),
          endIndex: i,
        };
      }
    }
  }

  return null;
}

function stripWrappingQuotes(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(["'`])([\s\S]*)\1$/);
  return match ? match[2]! : null;
}

function getNamedArgumentValue(argsText: string, key: string): string | undefined {
  for (const part of splitTopLevel(argsText)) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim();
    if (name === key) {
      return part.slice(eqIndex + 1).trim();
    }
  }
  return undefined;
}

function getPositionalArguments(argsText: string): string[] {
  return splitTopLevel(argsText).filter((part) => !/^[a-zA-Z_]\w*\s*=/.test(part));
}

function extractStringArray(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    const single = stripWrappingQuotes(trimmed);
    return single ? [single] : [];
  }

  const inner = trimmed.slice(1, -1);
  return splitTopLevel(inner)
    .map((part) => stripWrappingQuotes(part))
    .filter((item): item is string => item !== null);
}

function extractDependencyNames(text: string): string[] {
  const names: string[] = [];
  const dependsPattern = /\b(?:Depends|Security)\(\s*([A-Za-z_]\w*)/g;
  let match: RegExpExecArray | null;
  while ((match = dependsPattern.exec(text)) !== null) {
    names.push(match[1]!);
  }
  return uniqueStrings(names);
}

function unwrapPromiseType(typeText: string): string {
  let current = typeText.trim();
  while (/^Promise<.*>$/.test(current)) {
    current = current.replace(/^Promise<(.*)>$/, '$1').trim();
  }
  return current || 'unknown';
}

function normalizeTypeText(typeText: string | undefined): string {
  if (!typeText || typeText.trim().length === 0) {
    return 'unknown';
  }
  return unwrapPromiseType(typeText.replace(/\s+/g, ' ').trim());
}

function methodSortKey(method: string): number {
  const upper = method.toUpperCase();
  const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE', 'ALL'];
  const idx = order.indexOf(upper);
  return idx >= 0 ? idx : order.length;
}

function dedupeParameters(parameters: ApiParameter[]): ApiParameter[] {
  const deduped = new Map<string, ApiParameter>();
  for (const parameter of parameters) {
    deduped.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...deduped.values()].sort((a, b) =>
    `${a.in}:${a.name}`.localeCompare(`${b.in}:${b.name}`),
  );
}

function dedupeResponses(responses: ApiResponse[]): ApiResponse[] {
  const deduped = new Map<string, ApiResponse>();
  for (const response of responses) {
    deduped.set(`${response.statusCode}:${response.type}`, response);
  }
  return [...deduped.values()].sort((a, b) =>
    a.statusCode.localeCompare(b.statusCode),
  );
}

function renderResponseType(responses: ApiResponse[]): string {
  if (responses.length === 0) {
    return 'unknown';
  }
  return responses
    .map((response) => `${response.statusCode}: ${response.type}`)
    .join(' | ');
}

function extractPathParameters(pathValue: string): ApiParameter[] {
  const parameters: ApiParameter[] = [];
  const openApiPattern = /\{([^}]+)\}/g;
  const expressPattern = /:([A-Za-z_]\w*)/g;

  let match: RegExpExecArray | null;
  while ((match = openApiPattern.exec(pathValue)) !== null) {
    parameters.push({
      name: match[1]!,
      in: 'path',
      type: 'string',
      required: true,
    });
  }

  while ((match = expressPattern.exec(pathValue)) !== null) {
    parameters.push({
      name: match[1]!,
      in: 'path',
      type: 'string',
      required: true,
    });
  }

  return dedupeParameters(parameters);
}

function isMeaningfulTagSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    !segment.startsWith(':') &&
    !segment.startsWith('{') &&
    !GENERIC_TAG_SEGMENTS.has(segment.toLowerCase()) &&
    !/^v\d+$/i.test(segment)
  );
}

function deriveTags(pathValue: string, sourceFile?: string): string[] {
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

function isAuthHint(text: string): boolean {
  return AUTH_HINT_PATTERN.test(text);
}

function collectAuthHints(names: string[]): string[] {
  return uniqueStrings(names.filter(isAuthHint)).sort();
}

function finalizeEndpoint(endpoint: ApiEndpoint): ApiEndpoint {
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

function dedupeEndpoints(endpoints: ApiEndpoint[]): ApiEndpoint[] {
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

function tryReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function resolveModulePath(fromFile: string, specifier: string, extensions: string[]): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }

  const basePath = specifier.startsWith('/')
    ? specifier
    : path.resolve(path.dirname(fromFile), specifier);

  const candidates = new Set<string>([
    basePath,
    ...extensions.map((ext) => `${basePath}${ext}`),
    ...extensions.map((ext) => path.join(basePath, `index${ext}`)),
  ]);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.resolve(candidate);
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function resolvePythonModulePath(fromFile: string, specifier: string, projectRoot: string): string | null {
  let candidateBase: string;

  if (specifier.startsWith('.')) {
    let level = 0;
    while (specifier[level] === '.') {
      level++;
    }
    let baseDir = path.dirname(fromFile);
    for (let i = 1; i < level; i++) {
      baseDir = path.dirname(baseDir);
    }
    const remainder = specifier.slice(level);
    candidateBase = remainder.length > 0
      ? path.join(baseDir, ...remainder.split('.'))
      : baseDir;
  } else {
    candidateBase = path.join(projectRoot, ...specifier.split('.'));
  }

  const candidates = [
    `${candidateBase}.py`,
    path.join(candidateBase, '__init__.py'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return path.resolve(candidate);
      }
    } catch {
      // ignore
    }
  }

  return null;
}

// ============================================================
// Schema ingest
// ============================================================

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

function extractFromSchema(projectRoot: string): ExtractionResult | null {
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

// ============================================================
// FastAPI introspection
// ============================================================

function parseFastApiRouteParameters(argsText: string, pathValue: string): {
  parameters: ApiParameter[];
  auth: string[];
} {
  const parameters: ApiParameter[] = [];
  const authHints: string[] = [];

  const defMatch = argsText.match(/^\s*([A-Za-z_]\w*)\s*:\s*([^=,]+?)(?:\s*=\s*(.+))?$/);
  if (!defMatch) {
    return { parameters, auth: authHints };
  }

  const name = defMatch[1]!;
  const annotation = normalizeTypeText(defMatch[2]);
  const defaultExpr = defMatch[3]?.trim();

  if (defaultExpr && /\b(?:Depends|Security)\(/.test(defaultExpr)) {
    authHints.push(...extractDependencyNames(defaultExpr));
    return { parameters, auth: authHints };
  }

  let location: ApiParameterLocation = 'query';
  if (defaultExpr && /\bPath\(/.test(defaultExpr)) location = 'path';
  else if (defaultExpr && /\bQuery\(/.test(defaultExpr)) location = 'query';
  else if (defaultExpr && /\bBody\(/.test(defaultExpr)) location = 'body';
  else if (defaultExpr && /\bHeader\(/.test(defaultExpr)) location = 'header';
  else if (defaultExpr && /\bCookie\(/.test(defaultExpr)) location = 'cookie';
  else if (defaultExpr && /\bForm\(/.test(defaultExpr)) location = 'form';
  else if (new RegExp(`\\{${name}\\}`).test(pathValue)) location = 'path';

  const required = location === 'path'
    ? true
    : !defaultExpr || defaultExpr.includes('...');

  parameters.push({
    name,
    in: location,
    type: annotation,
    required,
  });

  return { parameters, auth: authHints };
}

function analyzeFastApiFile(projectRoot: string, filePath: string, content: string): FastApiFileAnalysis {
  const routers = new Map<string, FastApiRouterDef>();
  const imports = new Map<string, RouterImportBinding>();

  for (const line of content.split('\n')) {
    const fromImportMatch = line.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)\s*$/);
    if (!fromImportMatch) {
      continue;
    }

    const modulePath = fromImportMatch[1]!;
    const resolvedFile = resolvePythonModulePath(filePath, modulePath, projectRoot);
    if (!resolvedFile) {
      continue;
    }

    for (const entry of splitTopLevel(fromImportMatch[2]!)) {
      const aliasMatch = entry.match(/^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/);
      if (!aliasMatch) {
        continue;
      }
      const importedName = aliasMatch[1]!;
      const localName = aliasMatch[2] ?? importedName;
      imports.set(localName, {
        targetFile: resolvedFile,
        exportName: importedName,
      });
    }
  }

  const routerDeclPattern = /\b([A-Za-z_]\w*)\s*=\s*(FastAPI|APIRouter)\s*\(/g;
  let routerMatch: RegExpExecArray | null;
  while ((routerMatch = routerDeclPattern.exec(content)) !== null) {
    const localName = routerMatch[1]!;
    const kind = routerMatch[2] === 'FastAPI' ? 'app' : 'router';
    const openParenIndex = routerDeclPattern.lastIndex - 1;
    const balanced = extractBalancedContent(content, openParenIndex);
    if (!balanced) {
      continue;
    }

    const argsText = balanced.content;
    const prefix = stripWrappingQuotes(getNamedArgumentValue(argsText, 'prefix') ?? '') ?? '';
    const tags = extractStringArray(getNamedArgumentValue(argsText, 'tags'));
    const auth = extractDependencyNames(getNamedArgumentValue(argsText, 'dependencies') ?? '');

    routers.set(localName, {
      id: `${filePath}#${localName}`,
      filePath,
      localName,
      kind,
      prefix,
      tags,
      auth,
      routes: [],
      mounts: [],
    });

    routerDeclPattern.lastIndex = balanced.endIndex + 1;
  }

  const routePattern = /@([A-Za-z_]\w*)\.(get|post|put|patch|delete|options|head|trace)\s*\(/g;
  let routeMatch: RegExpExecArray | null;
  while ((routeMatch = routePattern.exec(content)) !== null) {
    const routerName = routeMatch[1]!;
    const router = routers.get(routerName);
    if (!router) {
      continue;
    }

    const balanced = extractBalancedContent(content, routePattern.lastIndex - 1);
    if (!balanced) {
      continue;
    }

    const argsText = balanced.content;
    const afterDecorator = content.slice(balanced.endIndex + 1);
    const defMatch = afterDecorator.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\(([\s\S]*?)\)(?:\s*->\s*([^:\n]+))?:/m);
    if (!defMatch) {
      continue;
    }

    const positionalArgs = getPositionalArguments(argsText);
    const rawPath = stripWrappingQuotes(positionalArgs[0] ?? '') ?? '/';
    const routeTags = extractStringArray(getNamedArgumentValue(argsText, 'tags'));
    const routeAuth = extractDependencyNames(argsText);
    const responseModel = normalizeTypeText(getNamedArgumentValue(argsText, 'response_model') ?? defMatch[3]);

    const parameters: ApiParameter[] = [];
    const functionAuth: string[] = [];
    for (const rawParam of splitTopLevel(defMatch[2]!)) {
      const trimmed = rawParam.trim();
      if (!trimmed || trimmed === 'self' || trimmed === 'cls') {
        continue;
      }
      const parsed = parseFastApiRouteParameters(trimmed, rawPath);
      parameters.push(...parsed.parameters);
      functionAuth.push(...parsed.auth);
    }

    router.routes.push({
      method: routeMatch[2]!.toUpperCase(),
      path: rawPath,
      parameters,
      responseType: responseModel,
      auth: uniqueStrings([...routeAuth, ...functionAuth]),
      tags: routeTags,
        summary: stripWrappingQuotes(getNamedArgumentValue(argsText, 'summary') ?? '') ?? undefined,
      operationId: defMatch[1],
      sourceFile: getRelativePath(projectRoot, filePath),
    });

    routePattern.lastIndex = balanced.endIndex + 1;
  }

  const includeRouterPattern = /\b([A-Za-z_]\w*)\.include_router\s*\(/g;
  let includeMatch: RegExpExecArray | null;
  while ((includeMatch = includeRouterPattern.exec(content)) !== null) {
    const parentName = includeMatch[1]!;
    const parent = routers.get(parentName);
    if (!parent) {
      continue;
    }

    const balanced = extractBalancedContent(content, includeRouterPattern.lastIndex - 1);
    if (!balanced) {
      continue;
    }

    const argsText = balanced.content;
    const positionalArgs = getPositionalArguments(argsText);
    const childName = positionalArgs[0]?.trim();
    if (!childName || !/^[A-Za-z_]\w*$/.test(childName)) {
      continue;
    }

    parent.mounts.push({
      targetLocalName: childName,
      prefix: stripWrappingQuotes(getNamedArgumentValue(argsText, 'prefix') ?? '') ?? '',
      tags: extractStringArray(getNamedArgumentValue(argsText, 'tags')),
      auth: extractDependencyNames(getNamedArgumentValue(argsText, 'dependencies') ?? ''),
    });

    includeRouterPattern.lastIndex = balanced.endIndex + 1;
  }

  return {
    filePath,
    routers,
    imports,
  };
}

function resolveFastApiRouters(
  analyses: FastApiFileAnalysis[],
): Map<string, ResolvedFastApiRouterDef> {
  const resolved = new Map<string, ResolvedFastApiRouterDef>();
  const byFile = new Map<string, FastApiFileAnalysis>(analyses.map((analysis) => [analysis.filePath, analysis]));

  for (const analysis of analyses) {
    for (const router of analysis.routers.values()) {
      const mounts: ResolvedFastApiMount[] = [];

      for (const mount of router.mounts) {
        let targetId: string | undefined;

        if (analysis.routers.has(mount.targetLocalName)) {
          targetId = analysis.routers.get(mount.targetLocalName)!.id;
        } else {
          const binding = analysis.imports.get(mount.targetLocalName);
          const importedAnalysis = binding ? byFile.get(binding.targetFile) : undefined;
          const importedRouter = importedAnalysis?.routers.get(binding?.exportName ?? '');
          if (importedRouter) {
            targetId = importedRouter.id;
          }
        }

        if (targetId) {
          mounts.push({
            prefix: mount.prefix,
            tags: mount.tags,
            auth: mount.auth,
            targetId,
          });
        }
      }

      resolved.set(router.id, {
        ...router,
        mounts,
      });
    }
  }

  return resolved;
}

function extractFromFastApi(projectRoot: string): ExtractionResult | null {
  const files = collectProjectFiles(projectRoot, { extensions: PYTHON_EXTENSIONS });
  const analyses = files
    .map((filePath) => {
      const content = tryReadFile(filePath);
      return content ? analyzeFastApiFile(projectRoot, filePath, content) : null;
    })
    .filter((item): item is FastApiFileAnalysis => item !== null);

  const routers = resolveFastApiRouters(analyses);
  if (routers.size === 0) {
    return null;
  }

  const parentCounts = new Map<string, number>();
  for (const router of routers.values()) {
    parentCounts.set(router.id, parentCounts.get(router.id) ?? 0);
    for (const mount of router.mounts) {
      parentCounts.set(mount.targetId, (parentCounts.get(mount.targetId) ?? 0) + 1);
    }
  }

  const roots = [...routers.values()].filter((router) =>
    router.kind === 'app' || (parentCounts.get(router.id) ?? 0) === 0,
  );

  const endpoints: ApiEndpoint[] = [];
  const sourceFiles = new Set<string>();
  const visited = new Set<string>();

  function walk(
    routerId: string,
    prefix: string,
    inheritedTags: string[],
    inheritedAuth: string[],
  ): void {
    const router = routers.get(routerId);
    if (!router) {
      return;
    }

    const combinedPrefix = joinUrlPaths(prefix, router.prefix);
    const routerTags = uniqueStrings([...inheritedTags, ...router.tags]);
    const routerAuth = uniqueStrings([...inheritedAuth, ...router.auth]);

    for (const route of router.routes) {
      const fullPath = joinUrlPaths(combinedPrefix, route.path);
      const auth = collectAuthHints([...routerAuth, ...route.auth]);
      const tags = uniqueStrings([...routerTags, ...route.tags]);
      sourceFiles.add(route.sourceFile);

      endpoints.push({
        method: route.method,
        path: fullPath,
        parameters: route.parameters,
        responses: [{
          statusCode: '200',
          type: normalizeTypeText(route.responseType),
        }],
        responseType: normalizeTypeText(route.responseType),
        auth,
        tags,
        source: 'introspection',
        sourceFile: route.sourceFile,
        summary: route.summary,
        operationId: route.operationId,
      });
    }

    for (const mount of router.mounts) {
      const visitKey = `${routerId}->${mount.targetId}:${mount.prefix}`;
      if (visited.has(visitKey)) {
        continue;
      }
      visited.add(visitKey);
      walk(
        mount.targetId,
        joinUrlPaths(combinedPrefix, mount.prefix),
        [...routerTags, ...mount.tags],
        [...routerAuth, ...mount.auth],
      );
    }
  }

  const rootRouters = roots.length > 0 ? roots : [...routers.values()];
  for (const root of rootRouters) {
    walk(root.id, '', [], []);
  }

  const deduped = dedupeEndpoints(endpoints);
  if (deduped.length === 0) {
    return null;
  }

  return {
    source: 'introspection',
    endpoints: deduped,
    sourceFiles: [...sourceFiles].sort(),
  };
}

// ============================================================
// tsoa introspection
// ============================================================

function extractDecoratorStringArg(decorator: Node | undefined): string | null {
  if (!decorator || !Node.isDecorator(decorator)) {
    return null;
  }
  const firstArg = decorator.getArguments()[0];
  if (!firstArg) {
    return null;
  }
  return stripWrappingQuotes(firstArg.getText());
}

function extractDecoratorStringArgs(decorator: Node | undefined): string[] {
  if (!decorator || !Node.isDecorator(decorator)) {
    return [];
  }
  return decorator.getArguments()
    .map((arg) => stripWrappingQuotes(arg.getText()))
    .filter((item): item is string => item !== null);
}

function extractTsoaSecurity(decorators: Node[]): string[] {
  const authHints: string[] = [];
  for (const decorator of decorators) {
    if (!Node.isDecorator(decorator) || decorator.getName() !== 'Security') {
      continue;
    }
    const arg = decorator.getArguments()[0];
    const value = arg ? stripWrappingQuotes(arg.getText()) : null;
    if (value) {
      authHints.push(value);
    }
  }
  return uniqueStrings(authHints).sort();
}

function parseTsoaParameter(parameter: Node): ApiParameter | null {
  if (!Node.isParameterDeclaration(parameter)) {
    return null;
  }

  const decorators = parameter.getDecorators();
  if (decorators.length === 0) {
    return null;
  }

  let location: ApiParameterLocation | null = null;
  let name = parameter.getName();

  for (const decorator of decorators) {
    const decoratorName = decorator.getName();
    if (decoratorName === 'Path') location = 'path';
    else if (decoratorName === 'Query') location = 'query';
    else if (decoratorName === 'Body' || decoratorName === 'BodyProp') location = 'body';
    else if (decoratorName === 'Header') location = 'header';
    else if (decoratorName === 'Cookie') location = 'cookie';
    else if (decoratorName === 'FormField') location = 'form';

    if (location) {
      const alias = extractDecoratorStringArg(decorator);
      if (alias) {
        name = alias;
      }
      break;
    }
  }

  if (!location) {
    return null;
  }

  return {
    name,
    in: location,
    type: normalizeTypeText(parameter.getTypeNode()?.getText()),
    required: location === 'path' ? true : !parameter.isOptional(),
  };
}

function extractFromTsoa(projectRoot: string): ExtractionResult | null {
  const files = collectProjectFiles(projectRoot, {
    extensions: TS_SOURCE_EXTENSIONS.filter((ext) => ext !== '.js' && ext !== '.jsx'),
  });
  if (files.length === 0) {
    return null;
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      experimentalDecorators: true,
    },
  });

  for (const filePath of files) {
    try {
      project.addSourceFileAtPath(filePath);
    } catch {
      // ignore parse failure
    }
  }

  const endpoints: ApiEndpoint[] = [];
  const sourceFiles = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    const relativePath = getRelativePath(projectRoot, sourceFile.getFilePath());

    for (const classDecl of sourceFile.getClasses()) {
      const routeDecorator = classDecl.getDecorators().find((decorator) => decorator.getName() === 'Route');
      if (!routeDecorator) {
        continue;
      }

      const classRoute = extractDecoratorStringArg(routeDecorator) ?? '/';
      const classTags = extractDecoratorStringArgs(
        classDecl.getDecorators().find((decorator) => decorator.getName() === 'Tags'),
      );
      const classSecurity = extractTsoaSecurity(classDecl.getDecorators());

      for (const methodDecl of classDecl.getMethods()) {
        const httpDecorator = methodDecl.getDecorators().find((decorator) =>
          TSOA_HTTP_DECORATORS.has(decorator.getName()),
        );
        if (!httpDecorator) {
          continue;
        }

        const method = TSOA_HTTP_DECORATORS.get(httpDecorator.getName())!;
        const methodRoute = extractDecoratorStringArg(httpDecorator) ?? '/';
        const methodTags = extractDecoratorStringArgs(
          methodDecl.getDecorators().find((decorator) => decorator.getName() === 'Tags'),
        );
        const auth = uniqueStrings([
          ...classSecurity,
          ...extractTsoaSecurity(methodDecl.getDecorators()),
        ]);

        const parameters = methodDecl.getParameters()
          .map((parameter) => parseTsoaParameter(parameter))
          .filter((parameter): parameter is ApiParameter => parameter !== null);
        const responseType = normalizeTypeText(methodDecl.getReturnTypeNode()?.getText());
        const fullPath = joinUrlPaths(classRoute, methodRoute);

        sourceFiles.add(relativePath);
        endpoints.push({
          method,
          path: fullPath,
          parameters,
          responses: [{
            statusCode: '200',
            type: responseType,
          }],
          responseType,
          auth,
          tags: uniqueStrings([...classTags, ...methodTags]),
          source: 'introspection',
          sourceFile: relativePath,
          operationId: methodDecl.getName(),
        });
      }
    }
  }

  const deduped = dedupeEndpoints(endpoints);
  if (deduped.length === 0) {
    return null;
  }

  return {
    source: 'introspection',
    endpoints: deduped,
    sourceFiles: [...sourceFiles].sort(),
  };
}

function extractFromFrameworkIntrospection(projectRoot: string): ExtractionResult | null {
  const fastApiResult = extractFromFastApi(projectRoot);
  const tsoaResult = extractFromTsoa(projectRoot);

  const endpoints = dedupeEndpoints([
    ...(fastApiResult?.endpoints ?? []),
    ...(tsoaResult?.endpoints ?? []),
  ]);
  if (endpoints.length === 0) {
    return null;
  }

  return {
    source: 'introspection',
    endpoints,
    sourceFiles: uniqueStrings([
      ...(fastApiResult?.sourceFiles ?? []),
      ...(tsoaResult?.sourceFiles ?? []),
    ]).sort(),
  };
}

// ============================================================
// Express AST fallback
// ============================================================

function isExpressRouterFactoryCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) {
    return false;
  }
  const expr = node.getExpression();
  if (Node.isIdentifier(expr)) {
    return expr.getText() === 'Router';
  }
  if (Node.isPropertyAccessExpression(expr)) {
    return expr.getExpression().getText() === 'express' && expr.getName() === 'Router';
  }
  return false;
}

function isExpressAppFactoryCall(node: Node): boolean {
  return Node.isCallExpression(node) && Node.isIdentifier(node.getExpression()) && node.getExpression().getText() === 'express';
}

function extractLiteralPath(node: Node | undefined): string | null {
  if (!node) {
    return null;
  }
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.getLiteralText();
  }
  return null;
}

function extractCallableName(node: Node): string | null {
  if (Node.isIdentifier(node)) {
    return node.getText();
  }
  if (Node.isPropertyAccessExpression(node)) {
    return node.getName();
  }
  if (Node.isCallExpression(node)) {
    return extractCallableName(node.getExpression());
  }
  return null;
}

function extractMiddlewareNames(nodes: Node[]): string[] {
  const names: string[] = [];
  for (const node of nodes) {
    if (Node.isArrayLiteralExpression(node)) {
      names.push(...extractMiddlewareNames(node.getElements()));
      continue;
    }
    const name = extractCallableName(node);
    if (name) {
      names.push(name);
    }
  }
  return uniqueStrings(names);
}

function buildExportMap(sourceFile: import('ts-morph').SourceFile, routers: Map<string, ExpressRouterDef>): {
  defaultExport?: string;
  namedExports: Map<string, string>;
} {
  let defaultExport: string | undefined;
  const namedExports = new Map<string, string>();

  for (const statement of sourceFile.getStatements()) {
    if (Node.isVariableStatement(statement) && statement.hasExportKeyword()) {
      for (const declaration of statement.getDeclarations()) {
        const name = declaration.getName();
        if (routers.has(name)) {
          namedExports.set(name, name);
        }
      }
    }
  }

  for (const exportDecl of sourceFile.getExportDeclarations()) {
    for (const specifier of exportDecl.getNamedExports()) {
      const localName = specifier.getNameNode().getText();
      const exportName = specifier.getAliasNode()?.getText() ?? localName;
      if (routers.has(localName)) {
        namedExports.set(exportName, localName);
      }
    }
  }

  for (const exportAssignment of sourceFile.getExportAssignments()) {
    const expr = exportAssignment.getExpression();
    if (Node.isIdentifier(expr) && routers.has(expr.getText())) {
      defaultExport = expr.getText();
    }
  }

  return { defaultExport, namedExports };
}

function parseExpressRouteChain(
  expr: Node,
  routers: Map<string, ExpressRouterDef>,
  relativePath: string,
): { routerName: string; routes: ExpressRouteDecl[] } | null {
  if (!Node.isCallExpression(expr)) {
    return null;
  }

  const routes: ExpressRouteDecl[] = [];
  let current = expr;

  while (Node.isCallExpression(current)) {
    const currentExpr = current.getExpression();
    if (!Node.isPropertyAccessExpression(currentExpr)) {
      return null;
    }

    const methodName = currentExpr.getName();
    const targetExpr = currentExpr.getExpression();
    if (!HTTP_METHOD_SET.has(methodName.toLowerCase())) {
      return null;
    }

    routes.unshift({
      method: methodName.toUpperCase(),
      path: '',
      middlewares: extractMiddlewareNames(current.getArguments()),
      sourceFile: relativePath,
    });

    if (!Node.isCallExpression(targetExpr)) {
      return null;
    }
    current = targetExpr;

    const routeExpr = current.getExpression();
    if (!Node.isPropertyAccessExpression(routeExpr) || routeExpr.getName() !== 'route') {
      continue;
    }

    const routerTarget = routeExpr.getExpression();
    if (!Node.isIdentifier(routerTarget) || !routers.has(routerTarget.getText())) {
      return null;
    }

    const routePath = extractLiteralPath(current.getArguments()[0]);
    if (!routePath) {
      return null;
    }

    return {
      routerName: routerTarget.getText(),
      routes: routes.map((route) => ({ ...route, path: routePath })),
    };
  }

  return null;
}

function analyzeExpressFile(projectRoot: string, sourceFile: import('ts-morph').SourceFile): ExpressFileAnalysis {
  const filePath = sourceFile.getFilePath();
  const relativePath = getRelativePath(projectRoot, filePath);
  const routers = new Map<string, ExpressRouterDef>();
  const imports = new Map<string, RouterImportBinding>();

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    const resolved = resolveModulePath(filePath, moduleSpecifier, TS_SOURCE_EXTENSIONS);
    if (!resolved) {
      continue;
    }

    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport) {
      imports.set(defaultImport.getText(), {
        targetFile: resolved,
        exportName: 'default',
      });
    }

    for (const namedImport of importDecl.getNamedImports()) {
      const localName = namedImport.getAliasNode()?.getText() ?? namedImport.getName();
      imports.set(localName, {
        targetFile: resolved,
        exportName: namedImport.getName(),
      });
    }
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer) {
      continue;
    }

    const localName = declaration.getName();
    let kind: 'app' | 'router' | null = null;
    if (isExpressRouterFactoryCall(initializer)) {
      kind = 'router';
    } else if (isExpressAppFactoryCall(initializer)) {
      kind = 'app';
    }

    if (kind) {
      routers.set(localName, {
        id: `${filePath}#${localName}`,
        filePath,
        localName,
        kind,
        routes: [],
        mounts: [],
      });
    }
  }

  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) {
      continue;
    }

    const expr = statement.getExpression();
    const chain = parseExpressRouteChain(expr, routers, relativePath);
    if (chain) {
      const router = routers.get(chain.routerName)!;
      router.routes.push(...chain.routes);
      continue;
    }

    if (!Node.isCallExpression(expr)) {
      continue;
    }

    const callExpr = expr.getExpression();
    if (!Node.isPropertyAccessExpression(callExpr)) {
      continue;
    }

    const target = callExpr.getExpression();
    if (!Node.isIdentifier(target) || !routers.has(target.getText())) {
      continue;
    }

    const router = routers.get(target.getText())!;
    const methodName = callExpr.getName();

    if (methodName === 'use') {
      const args = expr.getArguments();
      let prefix = '';
      let restArgs = args;

      const firstArgPath = extractLiteralPath(args[0]);
      if (firstArgPath !== null) {
        prefix = firstArgPath;
        restArgs = args.slice(1);
      }

      const routerTargets = restArgs.filter((arg) =>
        Node.isIdentifier(arg) &&
        (routers.has(arg.getText()) || imports.has(arg.getText())),
      );
      if (routerTargets.length === 0) {
        continue;
      }

      const middlewareNames = extractMiddlewareNames(
        restArgs.filter((arg) => !routerTargets.includes(arg)),
      );

      for (const routerTarget of routerTargets) {
        router.mounts.push({
          prefix,
          middlewares: middlewareNames,
          targetLocalName: routerTarget.getText(),
        });
      }
      continue;
    }

    if (!HTTP_METHOD_SET.has(methodName.toLowerCase())) {
      continue;
    }

    const routePath = extractLiteralPath(expr.getArguments()[0]);
    if (!routePath) {
      continue;
    }

    router.routes.push({
      method: methodName.toUpperCase(),
      path: routePath,
      middlewares: extractMiddlewareNames(expr.getArguments().slice(1)),
      sourceFile: relativePath,
    });
  }

  const exports = buildExportMap(sourceFile, routers);
  return {
    filePath,
    routers,
    defaultExport: exports.defaultExport,
    namedExports: exports.namedExports,
    imports,
  };
}

function resolveExpressRouters(
  analyses: ExpressFileAnalysis[],
): Map<string, ResolvedExpressRouterDef> {
  const resolved = new Map<string, ResolvedExpressRouterDef>();
  const byFile = new Map<string, ExpressFileAnalysis>(analyses.map((analysis) => [analysis.filePath, analysis]));

  for (const analysis of analyses) {
    for (const router of analysis.routers.values()) {
      const mounts: ResolvedExpressMount[] = [];
      for (const mount of router.mounts) {
        let targetId: string | undefined;

        if (analysis.routers.has(mount.targetLocalName)) {
          targetId = analysis.routers.get(mount.targetLocalName)!.id;
        } else {
          const binding = analysis.imports.get(mount.targetLocalName);
          const importedAnalysis = binding ? byFile.get(binding.targetFile) : undefined;
          if (binding && importedAnalysis) {
            const localName = binding.exportName === 'default'
              ? importedAnalysis.defaultExport
              : importedAnalysis.namedExports.get(binding.exportName);
            if (localName && importedAnalysis.routers.has(localName)) {
              targetId = importedAnalysis.routers.get(localName)!.id;
            }
          }
        }

        if (targetId) {
          mounts.push({
            prefix: mount.prefix,
            middlewares: mount.middlewares,
            targetId,
          });
        }
      }

      resolved.set(router.id, {
        ...router,
        mounts,
      });
    }
  }

  return resolved;
}

function extractFromExpressAst(projectRoot: string): ExtractionResult | null {
  const files = collectProjectFiles(projectRoot, { extensions: TS_SOURCE_EXTENSIONS });
  if (files.length === 0) {
    return null;
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
    },
  });

  for (const filePath of files) {
    try {
      project.addSourceFileAtPath(filePath);
    } catch {
      // ignore parse failure
    }
  }

  const analyses = project.getSourceFiles()
    .map((sourceFile) => analyzeExpressFile(projectRoot, sourceFile))
    .filter((analysis) =>
      analysis.routers.size > 0 ||
      analysis.imports.size > 0,
    );

  const routers = resolveExpressRouters(analyses);
  if (routers.size === 0) {
    return null;
  }

  const parentCounts = new Map<string, number>();
  for (const router of routers.values()) {
    parentCounts.set(router.id, parentCounts.get(router.id) ?? 0);
    for (const mount of router.mounts) {
      parentCounts.set(mount.targetId, (parentCounts.get(mount.targetId) ?? 0) + 1);
    }
  }

  const roots = [...routers.values()].filter((router) =>
    router.kind === 'app' || (parentCounts.get(router.id) ?? 0) === 0,
  );

  const endpoints: ApiEndpoint[] = [];
  const sourceFiles = new Set<string>();
  const visited = new Set<string>();

  function walk(routerId: string, prefix: string, inheritedMiddlewares: string[]): void {
    const router = routers.get(routerId);
    if (!router) {
      return;
    }

    for (const route of router.routes) {
      const fullPath = joinUrlPaths(prefix, route.path);
      const auth = collectAuthHints([...inheritedMiddlewares, ...route.middlewares]);
      const tags = deriveTags(fullPath, route.sourceFile);
      sourceFiles.add(route.sourceFile);

      endpoints.push({
        method: route.method,
        path: fullPath,
        parameters: extractPathParameters(fullPath),
        responses: [{
          statusCode: '200',
          type: 'unknown',
        }],
        responseType: 'unknown',
        auth,
        tags,
        source: 'ast',
        sourceFile: route.sourceFile,
      });
    }

    for (const mount of router.mounts) {
      const visitKey = `${routerId}->${mount.targetId}:${mount.prefix}`;
      if (visited.has(visitKey)) {
        continue;
      }
      visited.add(visitKey);
      walk(
        mount.targetId,
        joinUrlPaths(prefix, mount.prefix),
        [...inheritedMiddlewares, ...mount.middlewares],
      );
    }
  }

  const rootRouters = roots.length > 0 ? roots : [...routers.values()];
  for (const root of rootRouters) {
    walk(root.id, '', []);
  }

  const deduped = dedupeEndpoints(endpoints);
  if (deduped.length === 0) {
    return null;
  }

  return {
    source: 'ast',
    endpoints: deduped,
    sourceFiles: [...sourceFiles].sort(),
  };
}

// ============================================================
// Generator 实现
// ============================================================

export class ApiSurfaceGenerator
  implements DocumentGenerator<ApiSurfaceInput, ApiSurfaceOutput>
{
  readonly id = 'api-surface' as const;
  readonly name = 'API Surface Reference 生成器' as const;
  readonly description = '按 schema -> introspection -> ast 优先级生成 API Surface Reference';

  async isApplicable(context: ProjectContext): Promise<boolean> {
    if (collectProjectFiles(context.projectRoot, {
      extensions: ['.json', '.yaml', '.yml'],
      fileNamePattern: OPENAPI_FILE_PATTERN,
    }).length > 0) {
      return true;
    }

    const sourceFiles = collectProjectFiles(context.projectRoot, {
      extensions: [...TS_SOURCE_EXTENSIONS, ...PYTHON_EXTENSIONS],
    });

    for (const filePath of sourceFiles) {
      const content = tryReadFile(filePath);
      if (!content) {
        continue;
      }

      if (/\bFastAPI\s*\(|\bAPIRouter\s*\(|@Route\s*\(|\bexpress\.Router\s*\(|\bRouter\s*\(|\.route\s*\(/.test(content)) {
        return true;
      }
    }

    return false;
  }

  async extract(context: ProjectContext): Promise<ApiSurfaceInput> {
    const projectName = detectProjectName(context.projectRoot);

    const schemaResult = extractFromSchema(context.projectRoot);
    if (schemaResult) {
      return {
        projectName,
        source: schemaResult.source,
        endpoints: schemaResult.endpoints,
        sourceFiles: schemaResult.sourceFiles,
      };
    }

    const introspectionResult = extractFromFrameworkIntrospection(context.projectRoot);
    if (introspectionResult) {
      return {
        projectName,
        source: introspectionResult.source,
        endpoints: introspectionResult.endpoints,
        sourceFiles: introspectionResult.sourceFiles,
      };
    }

    const astResult = extractFromExpressAst(context.projectRoot);
    if (astResult) {
      return {
        projectName,
        source: astResult.source,
        endpoints: astResult.endpoints,
        sourceFiles: astResult.sourceFiles,
      };
    }

    return {
      projectName,
      source: 'ast',
      endpoints: [],
      sourceFiles: [],
    };
  }

  async generate(
    input: ApiSurfaceInput,
    _options?: GenerateOptions,
  ): Promise<ApiSurfaceOutput> {
    const endpoints = dedupeEndpoints(input.endpoints);
    const byMethod: Record<string, number> = {};
    for (const endpoint of endpoints) {
      byMethod[endpoint.method] = (byMethod[endpoint.method] ?? 0) + 1;
    }

    const tags = uniqueStrings(endpoints.flatMap((endpoint) => endpoint.tags)).sort();
    const totalParameters = endpoints.reduce((sum, endpoint) => sum + endpoint.parameters.length, 0);

    return {
      title: `API Surface Reference: ${input.projectName}`,
      generatedAt: new Date().toISOString().split('T')[0]!,
      projectName: input.projectName,
      source: input.source,
      endpoints,
      totalEndpoints: endpoints.length,
      totalParameters,
      sourceFiles: uniqueStrings(input.sourceFiles).sort(),
      byMethod,
      tags,
    };
  }

  render(output: ApiSurfaceOutput): string {
    const template = loadTemplate('api-surface.hbs', import.meta.url);
    return template(output);
  }
}
