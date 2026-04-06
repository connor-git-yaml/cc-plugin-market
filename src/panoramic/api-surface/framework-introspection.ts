/**
 * tsoa / NestJS 框架自省 + 桥接函数
 */
import { Project, Node } from 'ts-morph';
import type { ApiEndpoint, ApiParameter, ApiParameterLocation, ExtractionResult } from './types.js';
import {
  collectProjectFiles,
  getRelativePath,
  joinUrlPaths,
  stripWrappingQuotes,
  TS_SOURCE_EXTENSIONS,
  TSOA_HTTP_DECORATORS,
  uniqueStrings,
} from './utils.js';
import { dedupeEndpoints, normalizeTypeText } from './endpoint-utils.js';
import { extractFromFastApi } from './fastapi-extractor.js';

// ============================================================
// tsoa 解析函数
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

// ============================================================
// 桥接函数：合并 FastAPI + tsoa 结果
// ============================================================

export function extractFromFrameworkIntrospection(projectRoot: string): ExtractionResult | null {
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
