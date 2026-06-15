/**
 * F192 T003 — 无 LLM 的确定性 API 实体抽取（heuristic fallback，EC-002）
 *
 * 纯函数、零外部依赖、可重复。规则保守（宁可漏抽不可编造，FR-003）：
 * - 围栏代码块 + 内联里的函数/方法签名 `name(params)`
 * - 错误码模式（E\d+ / ALL_CAPS_ERROR）
 * - 段落级 deprecated 标记（@deprecated / 已废弃 / deprecated since X）
 *
 * 反过拟合（FR-018）：规则 MUST NOT 匹配任何 eval manifest 的具体 API 名字面量。
 */

import type { ApiEntity, ExtractionSection } from './types.js';
import { makeEntityId } from './entity-util.js';

const HEURISTIC_CONFIDENCE = 0.5;

// 函数/方法签名：可选前缀(export/async/function/def/fn/func/public...) + 名称 + (参数)
const SIG_RE =
  /(?:export\s+|public\s+|async\s+|function\s+|def\s+|fn\s+|func\s+)*([A-Za-z_$][\w$.]{1,})\s*\(([^)]{0,400})\)/g;
// 错误码：E + ≥2 位数字，或 全大写下划线 + _ERROR/_CODE/_EXCEPTION
const ERRCODE_RE = /\b(E\d{2,}|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:ERROR|CODE|EXCEPTION))\b/g;
// deprecated 标记 + 可选 since 版本
const DEPRECATED_RE = /@deprecated|已废弃|deprecated\s+since\s+([\w.\-]+)|废弃于\s*([\w.\-]+)/i;

// 噪声名（语言关键字 / 控制流），不作为 API 名
const NOISE_NAMES = new Set([
  'if', 'for', 'while', 'switch', 'return', 'function', 'class', 'catch', 'await',
  'async', 'def', 'fn', 'func', 'import', 'export', 'const', 'let', 'var', 'new',
  'typeof', 'instanceof', 'in', 'of', 'do', 'else', 'try', 'throw', 'with', 'super',
]);

function isNoiseName(name: string): boolean {
  if (name.length < 2) return true;
  const last = name.includes('.') ? (name.split('.').pop() ?? name) : name;
  return NOISE_NAMES.has(last.toLowerCase());
}

/** 解析 `a, b: number, c = 1` → params（name + 可选 type） */
function parseParams(paramStr: string): ApiEntity['params'] {
  const trimmed = paramStr.trim();
  if (!trimmed) return [];
  return trimmed
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      // 支持 `name: type` / `name=default` / `type name`(go/java 粗略)
      const colon = p.split(':');
      const rawName = (colon[0] ?? p).split('=')[0]?.trim() ?? p;
      const name = rawName.replace(/^\.\.\./, '').replace(/\?$/, '').trim();
      const type = colon.length > 1 ? colon.slice(1).join(':').trim() : null;
      const entry: NonNullable<ApiEntity['params']>[number] = { name };
      if (type) entry.type = type;
      return entry;
    })
    .filter((e) => e.name.length > 0 && /^[A-Za-z_$]/.test(e.name));
}

function parseDeprecated(text: string): NonNullable<ApiEntity['deprecated']> {
  const m = DEPRECATED_RE.exec(text);
  if (!m) return { isDeprecated: false };
  const since = m[1] ?? m[2] ?? null;
  return since ? { isDeprecated: true, since } : { isDeprecated: true };
}

/** 对单个 section 做确定性抽取，返回去重后的实体列表 */
export function extractHeuristic(section: ExtractionSection): ApiEntity[] {
  const out: ApiEntity[] = [];
  const seen = new Set<string>();
  const primaryChunk = section.chunkIds[0] ?? '';
  const dep = parseDeprecated(section.text);

  const push = (
    name: string,
    kind: ApiEntity['kind'],
    signature: string | null,
    params: ApiEntity['params'],
  ): void => {
    const id = makeEntityId(name, kind);
    if (seen.has(id)) return;
    seen.add(id);
    const e: ApiEntity = {
      id,
      name,
      qualifiedName: name,
      kind,
      signature,
      sourceDocId: section.docId,
      sourceChunkId: primaryChunk,
      sourceChunkIds: section.chunkIds,
      sourceAnchor: section.anchor,
      lang: section.lang,
      confidence: HEURISTIC_CONFIDENCE,
      extractionMethod: 'heuristic',
    };
    if (params !== undefined) e.params = params;
    if (dep.isDeprecated) e.deprecated = dep;
    out.push(e);
  };

  // 1. 错误码
  for (const m of section.text.matchAll(ERRCODE_RE)) {
    const code = m[1];
    if (code) push(code, 'error_code', null, undefined);
  }
  // 2. 函数/方法签名
  for (const m of section.text.matchAll(SIG_RE)) {
    const name = m[1];
    const paramStr = m[2] ?? '';
    if (!name || isNoiseName(name)) continue;
    push(name, 'function', `${name}(${paramStr.trim()})`, parseParams(paramStr));
  }
  return out;
}
