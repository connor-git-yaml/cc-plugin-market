/**
 * FastAPI 路由/装饰器分析
 */
import type {
  ApiEndpoint,
  ApiParameter,
  ApiParameterLocation,
  ExtractionResult,
  FastApiFileAnalysis,
  FastApiMountDecl,
  FastApiRouterDef,
  ResolvedFastApiMount,
  ResolvedFastApiRouterDef,
  RouterImportBinding,
} from './types.js';
import {
  collectProjectFiles,
  extractBalancedContent,
  extractDependencyNames,
  extractStringArray,
  getNamedArgumentValue,
  getPositionalArguments,
  getRelativePath,
  joinUrlPaths,
  PYTHON_EXTENSIONS,
  resolvePythonModulePath,
  splitTopLevel,
  stripWrappingQuotes,
  tryReadFile,
  uniqueStrings,
} from './utils.js';
import { collectAuthHints, dedupeEndpoints, normalizeTypeText } from './endpoint-utils.js';

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

export function extractFromFastApi(projectRoot: string): ExtractionResult | null {
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
