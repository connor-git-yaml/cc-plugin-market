/**
 * OpenAPI / AsyncAPI 提取器（Feature 107）
 * 独立实现，不修改 api-surface/openapi-extractor.ts
 * 输出：ExtractionResult（包含 api / api-schema / event 节点）
 *
 * 实现的功能：
 * - JSON/YAML 格式 OpenAPI 3.x/Swagger 2.x 解析
 * - AsyncAPI 2.x channel/message → event 节点
 * - $ref 循环检测（visited set + 5 层绝对深度上限 + 占位节点）
 * - 置信度均为 EXTRACTED（确定性提取）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../panoramic/utils/logger.js';
import type { ExtractionResult, ExtractedNode, ExtractedEdge } from './extraction-types.js';
import { EMPTY_EXTRACTION_RESULT } from './extraction-types.js';

const logger = createLogger('extraction-openapi');

// ============================================================
// $ref 循环检测常量
// ============================================================

/** $ref 解析绝对层数上限（超过则插入占位节点） */
const REF_MAX_DEPTH = 5;

// ============================================================
// 轻量 YAML 解析（仅覆盖 OpenAPI spec 的 key-value + $ref 场景）
// ============================================================

/**
 * 极简 YAML 解析器，仅支持 OpenAPI/AsyncAPI spec 所需的子集：
 * - key: value（字符串、数字、布尔）
 * - key: （嵌套对象，通过缩进识别）
 * - $ref: "#/..."
 *
 * 不支持 YAML 锚点、别名、多文档等高级特性。
 * 对于无法解析的内容返回 null。
 */
function parseSimpleYaml(content: string): unknown {
  const lines = content.split('\n');
  // 使用迭代式栈解析缩进层次
  return parseYamlBlock(lines, 0, -1).value;
}

interface ParseBlock {
  value: unknown;
  nextLine: number;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseYamlValue(raw: string): unknown {
  const s = raw.trim();
  if (s === 'true' || s === 'yes') return true;
  if (s === 'false' || s === 'no') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  const num = Number(s);
  if (!isNaN(num) && s !== '') return num;
  return unquote(s);
}

function parseYamlBlock(lines: string[], startLine: number, parentIndent: number): ParseBlock {
  const result: Record<string, unknown> = {};
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i]!;

    // 跳过注释和空行
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#') || trimmed === '') {
      i++;
      continue;
    }

    // 计算当前缩进
    const indent = line.length - trimmed.length;

    // 当前行缩进不超过父级，返回
    if (indent <= parentIndent) {
      break;
    }

    // 解析 key: value 或 key:
    const colonIdx = trimmed.indexOf(': ');
    const colonEnd = trimmed.endsWith(':') ? trimmed.length - 1 : -1;

    if (colonIdx !== -1) {
      const key = unquote(trimmed.slice(0, colonIdx).trim());
      const valueStr = trimmed.slice(colonIdx + 2).trim();

      if (valueStr === '' || valueStr.startsWith('#')) {
        // key: （子对象或数组，由下一行决定）
        const nextNonEmpty = lines.slice(i + 1).findIndex((l) => l.trimStart() !== '' && !l.trimStart().startsWith('#'));
        const nextLine = nextNonEmpty === -1 ? lines.length : i + 1 + nextNonEmpty;
        const nextTrimmed = nextLine < lines.length ? lines[nextLine]!.trimStart() : '';
        if (nextTrimmed.startsWith('- ')) {
          // 数组 block
          const arr = parseYamlArray(lines, i + 1, indent);
          result[key] = arr.value;
          i = arr.nextLine;
        } else {
          const sub = parseYamlBlock(lines, i + 1, indent);
          result[key] = sub.value;
          i = sub.nextLine;
        }
      } else {
        result[key] = parseYamlValue(valueStr);
        i++;
      }
    } else if (colonEnd !== -1) {
      const key = unquote(trimmed.slice(0, colonEnd).trim());
      const sub = parseYamlBlock(lines, i + 1, indent);
      result[key] = sub.value;
      i = sub.nextLine;
    } else {
      // 非 key: value 行，跳过
      i++;
    }
  }

  return { value: result, nextLine: i };
}

/**
 * 解析 YAML 列表块（`- item` 格式）
 */
function parseYamlArray(lines: string[], startLine: number, parentIndent: number): ParseBlock {
  const result: unknown[] = [];
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#') || trimmed === '') { i++; continue; }

    const indent = line.length - trimmed.length;
    if (indent <= parentIndent) break;

    if (trimmed.startsWith('- ')) {
      result.push(parseYamlValue(trimmed.slice(2).trim()));
      i++;
    } else {
      break;
    }
  }

  return { value: result, nextLine: i };
}

// ============================================================
// 辅助：类型检查
// ============================================================

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ============================================================
// $ref 解析（内部，带循环检测）
// ============================================================

/**
 * 解析 JSON Pointer 格式的 $ref（如 #/components/schemas/User）
 */
function resolveRef(doc: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return null;
  const segments = ref.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = doc;
  for (const seg of segments) {
    if (!isObj(cur)) return null;
    cur = cur[seg];
  }
  return cur ?? null;
}

/**
 * 递归解引用 $ref，带深度限制和已访问集合（循环检测）
 */
function dereferenceWithDepth(
  doc: unknown,
  value: unknown,
  visited: Set<string>,
  depth: number,
): unknown {
  if (depth > REF_MAX_DEPTH) {
    return { _truncated: true, reason: '[ref-truncated]' };
  }
  if (!isObj(value) || typeof value.$ref !== 'string') {
    return value;
  }
  const ref = value.$ref;
  if (visited.has(ref)) {
    return { _truncated: true, reason: `[ref-cycle: ${ref}]` };
  }
  const resolved = resolveRef(doc, ref);
  if (!resolved) return value;
  visited.add(ref);
  const result = dereferenceWithDepth(doc, resolved, visited, depth + 1);
  visited.delete(ref);
  return result;
}

// ============================================================
// 节点 ID 生成（遵循 data-model.md 规则）
// ============================================================

function makeApiNodeId(method: string, pathStr: string, sourceFile: string): string {
  return `api:${method.toUpperCase()}:${pathStr}:${sourceFile}`;
}

function makeSchemaNodeId(schemaName: string, sourceFile: string): string {
  return `schema:${schemaName}:${sourceFile}`;
}

function makeEventNodeId(channelName: string, sourceFile: string): string {
  return `event:${channelName}:${sourceFile}`;
}

// ============================================================
// OpenAPI 解析核心逻辑
// ============================================================

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

/**
 * 解析 OpenAPI 3.x / Swagger 2.x 文档，生成节点和边
 */
function parseOpenApiDoc(doc: unknown, relativeSourceFile: string): Pick<ExtractionResult, 'nodes' | 'edges'> {
  const nodes: ExtractedNode[] = [];
  const edges: ExtractedEdge[] = [];

  if (!isObj(doc)) return { nodes, edges };

  // 解析 components.schemas → api-schema 节点
  const schemas: string[] = [];
  if (isObj(doc.components) && isObj(doc.components.schemas)) {
    for (const schemaName of Object.keys(doc.components.schemas)) {
      const nodeId = makeSchemaNodeId(schemaName, relativeSourceFile);
      schemas.push(nodeId);
      nodes.push({
        id: nodeId,
        label: schemaName,
        kind: 'api-schema',
        source_file: relativeSourceFile,
        confidence: 'EXTRACTED',
        metadata: { sourceType: 'openapi-schema' },
      });
    }
  }

  // Swagger 2.x definitions → api-schema 节点
  if (isObj(doc.definitions)) {
    for (const schemaName of Object.keys(doc.definitions)) {
      const nodeId = makeSchemaNodeId(schemaName, relativeSourceFile);
      if (!schemas.includes(nodeId)) {
        schemas.push(nodeId);
        nodes.push({
          id: nodeId,
          label: schemaName,
          kind: 'api-schema',
          source_file: relativeSourceFile,
          confidence: 'EXTRACTED',
          metadata: { sourceType: 'swagger-definition' },
        });
      }
    }
  }

  // 解析 paths → api 节点
  if (isObj(doc.paths)) {
    for (const [pathStr, pathItem] of Object.entries(doc.paths)) {
      if (!isObj(pathItem)) continue;
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!isObj(operation)) continue;

        const nodeId = makeApiNodeId(method, pathStr, relativeSourceFile);
        const label = `${method.toUpperCase()} ${pathStr}`;
        nodes.push({
          id: nodeId,
          label,
          kind: 'api',
          source_file: relativeSourceFile,
          confidence: 'EXTRACTED',
          metadata: {
            method: method.toUpperCase(),
            path: pathStr,
            summary: typeof operation.summary === 'string' ? operation.summary : undefined,
            operationId: typeof operation.operationId === 'string' ? operation.operationId : undefined,
            tags: Array.isArray(operation.tags) ? operation.tags : [],
          },
        });

        // 建立 api → schema 的 uses-schema 边（扫描 $ref）
        const refsInOperation = extractRefs(operation);
        for (const ref of refsInOperation) {
          const schemaName = ref.split('/').pop();
          if (schemaName) {
            const schemaId = makeSchemaNodeId(schemaName, relativeSourceFile);
            if (schemas.includes(schemaId)) {
              edges.push({
                source: nodeId,
                target: schemaId,
                relation: 'uses-schema',
                confidence: 'EXTRACTED',
                weight: 1.0,
              });
            }
          }
        }
      }
    }
  }

  // schema defines 边：来源 api-schema 节点 → 目标（当前版本仅记录节点，不生成 schema-to-schema 边）
  return { nodes, edges };
}

/** 递归提取对象中的所有 $ref 字符串 */
function extractRefs(obj: unknown, found: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > REF_MAX_DEPTH || !isObj(obj)) return found;
  if (typeof obj.$ref === 'string') {
    found.add(obj.$ref);
    return found;
  }
  for (const val of Object.values(obj)) {
    if (isObj(val)) extractRefs(val, found, depth + 1);
  }
  return found;
}

// ============================================================
// AsyncAPI 解析
// ============================================================

/**
 * 解析 AsyncAPI 2.x 文档，channels → event 节点
 */
function parseAsyncApiDoc(doc: unknown, relativeSourceFile: string): Pick<ExtractionResult, 'nodes' | 'edges'> {
  const nodes: ExtractedNode[] = [];
  const edges: ExtractedEdge[] = [];

  if (!isObj(doc) || !isObj(doc.channels)) return { nodes, edges };

  // 创建 service 节点（代表该文件本身）
  const serviceNodeId = `service:${relativeSourceFile}`;
  const serviceLabel = relativeSourceFile.split('/').pop()?.replace(/\.[^.]+$/, '') ?? relativeSourceFile;
  nodes.push({
    id: serviceNodeId,
    label: serviceLabel,
    kind: 'service',
    source_file: relativeSourceFile,
    confidence: 'EXTRACTED',
    metadata: { sourceTarget: relativeSourceFile },
  });

  for (const [channelName, channelItem] of Object.entries(doc.channels)) {
    if (!isObj(channelItem)) continue;

    const nodeId = makeEventNodeId(channelName, relativeSourceFile);
    nodes.push({
      id: nodeId,
      label: channelName,
      kind: 'event',
      source_file: relativeSourceFile,
      confidence: 'EXTRACTED',
      metadata: {
        channelName,
        hasPublish: isObj(channelItem.publish),
        hasSubscribe: isObj(channelItem.subscribe),
      },
    });

    // publish → publishes 边（service 节点已存在，不会悬空）
    if (isObj(channelItem.publish)) {
      edges.push({
        source: serviceNodeId,
        target: nodeId,
        relation: 'publishes',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });
    }

    // subscribe → subscribes 边
    if (isObj(channelItem.subscribe)) {
      edges.push({
        source: serviceNodeId,
        target: nodeId,
        relation: 'subscribes',
        confidence: 'EXTRACTED',
        weight: 1.0,
      });
    }
  }

  return { nodes, edges };
}

// ============================================================
// 判断是否为 AsyncAPI 文档
// ============================================================

function isAsyncApiDoc(doc: unknown): boolean {
  return isObj(doc) && typeof doc.asyncapi === 'string';
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 从单个 OpenAPI/AsyncAPI 文件提取节点和边
 *
 * @param filePath - 文件绝对路径
 * @param projectRoot - 项目根目录（用于计算相对路径）
 * @returns ExtractionResult（降级时返回 EMPTY_EXTRACTION_RESULT）
 */
export function extractOpenApi(filePath: string, projectRoot: string): ExtractionResult {
  if (!fs.existsSync(filePath)) {
    logger.debug(`OpenAPI 文件不存在，跳过: ${filePath}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    logger.warn(`读取 OpenAPI 文件失败: ${filePath} — ${String(err)}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  // 解析 JSON 或 YAML
  const ext = path.extname(filePath).toLowerCase();
  let doc: unknown;

  if (ext === '.json') {
    try {
      doc = JSON.parse(content);
    } catch (err) {
      logger.warn(`JSON 解析失败，跳过: ${filePath} — ${String(err)}`);
      return EMPTY_EXTRACTION_RESULT;
    }
  } else if (ext === '.yaml' || ext === '.yml') {
    try {
      doc = parseSimpleYaml(content);
    } catch (err) {
      logger.warn(`YAML 解析失败，跳过: ${filePath} — ${String(err)}`);
      return EMPTY_EXTRACTION_RESULT;
    }
  } else {
    logger.debug(`不支持的文件格式，跳过: ${filePath}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  if (!isObj(doc)) {
    logger.warn(`文件内容无效（非对象），跳过: ${filePath}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  // 计算相对路径（用于节点 ID）
  const relativeSourceFile = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  try {
    // AsyncAPI 文档单独处理
    if (isAsyncApiDoc(doc)) {
      const { nodes, edges } = parseAsyncApiDoc(doc, relativeSourceFile);
      if (nodes.length === 0 && edges.length === 0) {
        return EMPTY_EXTRACTION_RESULT;
      }
      return { nodes, edges };
    }

    // OpenAPI 文档处理
    const { nodes, edges } = parseOpenApiDoc(doc, relativeSourceFile);
    if (nodes.length === 0 && edges.length === 0) {
      return EMPTY_EXTRACTION_RESULT;
    }
    return { nodes, edges };
  } catch (err) {
    logger.warn(`OpenAPI 解析失败，跳过: ${filePath} — ${String(err)}`);
    return EMPTY_EXTRACTION_RESULT;
  }
}
