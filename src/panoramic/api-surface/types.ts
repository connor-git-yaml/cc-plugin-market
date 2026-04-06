/**
 * API Surface 类型定义
 *
 * 公开类型 + 跨模块共享的内部类型。
 */

// ============================================================
// 公开类型
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

// ============================================================
// 共享内部类型
// ============================================================

export interface ExtractionResult {
  source: ApiSource;
  endpoints: ApiEndpoint[];
  sourceFiles: string[];
}

export interface FileCollectionOptions {
  extensions?: string[];
  fileNamePattern?: RegExp;
}

export interface RouterImportBinding {
  targetFile: string;
  exportName: string;
}

// ============================================================
// Express 内部类型
// ============================================================

export interface ExpressRouteDecl {
  method: string;
  path: string;
  middlewares: string[];
  sourceFile: string;
}

export interface ExpressMountDecl {
  prefix: string;
  middlewares: string[];
  targetLocalName: string;
}

export interface ExpressRouterDef {
  id: string;
  filePath: string;
  localName: string;
  kind: 'app' | 'router';
  routes: ExpressRouteDecl[];
  mounts: ExpressMountDecl[];
}

export interface ExpressFileAnalysis {
  filePath: string;
  routers: Map<string, ExpressRouterDef>;
  defaultExport?: string;
  namedExports: Map<string, string>;
  imports: Map<string, RouterImportBinding>;
}

export interface ResolvedExpressMount {
  prefix: string;
  middlewares: string[];
  targetId: string;
}

export type ResolvedExpressRouterDef = Omit<ExpressRouterDef, 'mounts'> & {
  mounts: ResolvedExpressMount[];
};

// ============================================================
// FastAPI 内部类型
// ============================================================

export interface FastApiRouteDecl {
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

export interface FastApiMountDecl {
  prefix: string;
  tags: string[];
  auth: string[];
  targetLocalName: string;
}

export interface FastApiRouterDef {
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

export interface FastApiFileAnalysis {
  filePath: string;
  routers: Map<string, FastApiRouterDef>;
  imports: Map<string, RouterImportBinding>;
}

export interface ResolvedFastApiMount {
  prefix: string;
  tags: string[];
  auth: string[];
  targetId: string;
}

export type ResolvedFastApiRouterDef = Omit<FastApiRouterDef, 'mounts'> & {
  mounts: ResolvedFastApiMount[];
};
