/**
 * ApiSurfaceGenerator — API Surface Reference 生成器
 *
 * 优先级固定为：
 * 1. 读取現有 OpenAPI / Swagger 产物
 * 2. 静态解析 FastAPI / tsoa 元数据
 * 3. Express AST fallback
 *
 * 实现 DocumentGenerator<ApiSurfaceInput, ApiSurfaceOutput> 接口。
 */
import { Project } from 'ts-morph';
import type { DocumentGenerator, ProjectContext, GenerateOptions } from '../interfaces.js';
import { loadTemplate } from '../utils/template-loader.js';
import type {
  ApiSurfaceInput,
  ApiSurfaceOutput,
  ExtractionResult,
  ExpressFileAnalysis,
  ResolvedExpressMount,
  ResolvedExpressRouterDef,
} from './types.js';
import {
  collectProjectFiles,
  detectProjectName,
  joinUrlPaths,
  OPENAPI_FILE_PATTERN,
  PYTHON_EXTENSIONS,
  tryReadFile,
  TS_SOURCE_EXTENSIONS,
  uniqueStrings,
} from './utils.js';
import { collectAuthHints, dedupeEndpoints, deriveTags, extractPathParameters } from './endpoint-utils.js';
import { extractFromSchema } from './openapi-extractor.js';
import { extractFromFrameworkIntrospection } from './framework-introspection.js';
import { analyzeExpressFile } from './express-extractor.js';

// ============================================================
// 子模块 re-export
// ============================================================

export type {
  ApiSource,
  ApiParameterLocation,
  ApiParameter,
  ApiResponse,
  ApiEndpoint,
  ApiSurfaceInput,
  ApiSurfaceOutput,
} from './types.js';

// ============================================================
// Express 高层提取（使用 express-extractor 的 analyzeExpressFile）
// ============================================================

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

  const endpoints: import('./types.js').ApiEndpoint[] = [];
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
