/**
 * Express AST 分析
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Node } from 'ts-morph';
import type {
  ExpressFileAnalysis,
  ExpressMountDecl,
  ExpressRouteDecl,
  ExpressRouterDef,
  RouterImportBinding,
} from './types.js';
import {
  getRelativePath,
  HTTP_METHOD_SET,
  TS_SOURCE_EXTENSIONS,
  uniqueStrings,
} from './utils.js';

// ============================================================
// 模块解析（Express 专用）
// ============================================================

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

// ============================================================
// Express 解析函数
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

export function analyzeExpressFile(projectRoot: string, sourceFile: import('ts-morph').SourceFile): ExpressFileAnalysis {
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
