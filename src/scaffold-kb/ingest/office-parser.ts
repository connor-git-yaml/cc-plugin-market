/**
 * F192 T015 — 办公文档文本抽取（FR-011 攻击矩阵）
 *
 * docx/pptx：fflate 解压（仅取需要的 OOXML entry，过滤 path traversal + declared/实际
 *   size 上限防 zip bomb）→ regex 抽 <w:t>/<a:t>（零 XML 解析器攻击面）+ DOCTYPE/ENTITY
 *   预拒（XXE）+ 手动实体解码。不读 .rels → 天然忽略 external relationships。
 * pdf：unpdf text-layer 抽取（serverless pdfjs，无 canvas、不渲染、不执行动作）+ 字节上限
 *   + /Launch、/OpenAction+/JavaScript 主动内容预扫描拒绝。
 * md：直接 UTF-8 解码。
 * 加密/损坏/超大 → OfficeParseError（安全拒绝，不崩）。
 */

import { Unzip, UnzipInflate } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';

export type OfficeFormat = 'docx' | 'pptx' | 'pdf' | 'md';

export interface OfficeParseOptions {
  maxFileBytes?: number;
  maxEntryBytes?: number;
  /** 全部抽取 entry 的累计解压字节上限（zip bomb 防护） */
  maxTotalBytes?: number;
}

const DEFAULTS = { maxFileBytes: 50_000_000, maxEntryBytes: 30_000_000, maxTotalBytes: 60_000_000 };

export class OfficeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficeParseError';
  }
}

/** zip entry 名安全：拒 `..`、绝对路径、盘符（path traversal） */
export function isSafeEntryName(name: string): boolean {
  if (name.includes('..')) return false;
  if (name.startsWith('/') || name.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  return true;
}

/** XXE 防护：解析前拒绝含 DOCTYPE/ENTITY 的 XML（不止禁实体替换） */
function rejectDtd(xml: string): void {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new OfficeParseError('OOXML 含 DOCTYPE/ENTITY（XXE 防护拒绝）');
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => NAMED_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)));
}
function safeCodePoint(n: number): string {
  try {
    return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  } catch {
    return '';
  }
}

/** regex 抽取 OOXML `<tag>…</tag>` 文本（DTD 预拒 + 实体解码） */
export function extractOoxmlText(xml: string, tag: string): string {
  rejectDtd(xml);
  const re = new RegExp(`<${tag}\\b[^>]*>([^<]*)</${tag}>`, 'g');
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) parts.push(decodeXmlEntities(m[1] ?? ''));
  return parts.join('');
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * 流式解压取匹配 wantedRe 的 entry（C-1）：仅 start 需要的 entry（不解压其它）；
 * 逐 chunk 累加 entry 实际字节 + 全局累计字节，任一超限立即终止（streaming，不整包 materialize）。
 */
function unzipWanted(
  bytes: Uint8Array,
  wantedRe: RegExp,
  maxEntryBytes: number,
  maxTotalBytes: number,
): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  let fatal: Error | null = null;

  const unzipper = new Unzip((file) => {
    if (fatal) return;
    if (!isSafeEntryName(file.name) || !wantedRe.test(file.name)) return; // 不 start → 不解压
    // declared size 早拦（已知时）
    if (typeof file.originalSize === 'number' && file.originalSize > maxEntryBytes) {
      fatal = new OfficeParseError(`entry ${file.name} declared size 超 ${maxEntryBytes}（zip bomb）`);
      return;
    }
    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    file.ondata = (err, chunk, final) => {
      if (fatal) return;
      if (err) {
        fatal = new OfficeParseError(`解压 ${file.name} 失败: ${err.message}`);
        return;
      }
      entryBytes += chunk.length;
      totalBytes += chunk.length;
      if (entryBytes > maxEntryBytes || totalBytes > maxTotalBytes) {
        fatal = new OfficeParseError(`解压超字节上限（zip bomb 防护）: ${file.name}`);
        return;
      }
      chunks.push(chunk);
      if (final) result[file.name] = concatChunks(chunks, entryBytes);
    };
    file.start();
  });
  unzipper.register(UnzipInflate);
  try {
    unzipper.push(bytes, true);
  } catch (e) {
    throw new OfficeParseError(`zip 解析失败（损坏/加密/非法）: ${(e as Error).message}`);
  }
  if (fatal) throw fatal;
  return result;
}

function parseDocx(bytes: Uint8Array, maxEntryBytes: number, maxTotalBytes: number): string {
  const entries = unzipWanted(bytes, /^word\/document\.xml$/, maxEntryBytes, maxTotalBytes);
  const xml = entries['word/document.xml'];
  if (!xml) throw new OfficeParseError('docx 缺 word/document.xml（损坏或非 docx）');
  return extractOoxmlText(new TextDecoder().decode(xml), 'w:t');
}

function parsePptx(bytes: Uint8Array, maxEntryBytes: number, maxTotalBytes: number): string {
  const entries = unzipWanted(bytes, /^ppt\/slides\/slide\d+\.xml$/, maxEntryBytes, maxTotalBytes);
  const names = Object.keys(entries).sort();
  if (names.length === 0) throw new OfficeParseError('pptx 无幻灯片（损坏或非 pptx）');
  return names.map((k) => extractOoxmlText(new TextDecoder().decode(entries[k]!), 'a:t')).join('\n');
}

async function parsePdf(bytes: Uint8Array): Promise<string> {
  // 主动内容预扫描（不执行；text-only 抽取本就不触发动作，此为 defense-in-depth）。
  // 先解码 PDF name `#xx` 转义（防 /L#61unch 绕过），再匹配；扫描窗口放宽到 10MB。
  const raw = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 10_000_000)));
  const decoded = raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const hasJs = /\/JavaScript\b|\/JS\b/.test(decoded);
  if (/\/Launch\b/.test(decoded) || ((/\/OpenAction\b/.test(decoded) || /\/AA\b/.test(decoded)) && hasJs)) {
    throw new OfficeParseError('PDF 含主动内容（/Launch 或 OpenAction|AA + JavaScript）—— 拒绝');
  }
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const res = await extractText(pdf, { mergePages: true });
    return Array.isArray(res.text) ? res.text.join('\n') : String(res.text);
  } catch (e) {
    throw new OfficeParseError(`PDF 解析失败（加密/损坏/无文本层）: ${(e as Error).message}`);
  }
}

/** 抽取办公文档文本（按 format 分派，全程安全拒绝、不崩、不外联） */
export async function parseOfficeFile(
  bytes: Uint8Array,
  format: OfficeFormat,
  options: OfficeParseOptions = {},
): Promise<{ text: string; format: OfficeFormat }> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULTS.maxFileBytes;
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULTS.maxEntryBytes;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULTS.maxTotalBytes;
  if (bytes.length > maxFileBytes) {
    throw new OfficeParseError(`文件超 ${maxFileBytes} 字节上限`);
  }
  let text: string;
  switch (format) {
    case 'docx':
      text = parseDocx(bytes, maxEntryBytes, maxTotalBytes);
      break;
    case 'pptx':
      text = parsePptx(bytes, maxEntryBytes, maxTotalBytes);
      break;
    case 'pdf':
      text = await parsePdf(bytes);
      break;
    case 'md':
      text = new TextDecoder().decode(bytes);
      break;
  }
  return { text, format };
}

/** 从文件扩展名推断 format（caller 用）；未知返回 null */
export function detectOfficeFormat(filename: string): OfficeFormat | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'docx' || ext === 'pptx' || ext === 'pdf' || ext === 'md') return ext;
  return null;
}
