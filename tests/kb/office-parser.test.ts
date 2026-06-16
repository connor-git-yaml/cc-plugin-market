/**
 * F192 T015 / SC-007 — office 解析攻击矩阵 + docx/pptx/md 抽取
 * 用 fflate zipSync 构造 docx/pptx fixture + 攻击用例（确定性，不依赖外部文件）。
 */

import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  parseOfficeFile,
  isSafeEntryName,
  extractOoxmlText,
  detectOfficeFormat,
  OfficeParseError,
} from '../../src/scaffold-kb/ingest/office-parser.js';

function makeDocx(documentXml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(documentXml),
  });
}
function makePptx(slideXml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'ppt/slides/slide1.xml': strToU8(slideXml),
  });
}

const DOCX_BODY = '<w:document><w:body><w:p><w:r><w:t>调用 createChart 创建</w:t></w:r><w:r><w:t> 实例 &amp; 配置</w:t></w:r></w:p></w:body></w:document>';

describe('isSafeEntryName / detectOfficeFormat', () => {
  it('path traversal / 绝对路径 / 盘符 → 不安全', () => {
    expect(isSafeEntryName('../evil.xml')).toBe(false);
    expect(isSafeEntryName('/etc/passwd')).toBe(false);
    expect(isSafeEntryName('C:\\x')).toBe(false);
    expect(isSafeEntryName('word/document.xml')).toBe(true);
  });
  it('扩展名识别', () => {
    expect(detectOfficeFormat('a.DOCX')).toBe('docx');
    expect(detectOfficeFormat('a.pdf')).toBe('pdf');
    expect(detectOfficeFormat('a.txt')).toBeNull();
  });
});

describe('extractOoxmlText', () => {
  it('抽 <w:t> 文本 + 实体解码', () => {
    const t = extractOoxmlText(DOCX_BODY, 'w:t');
    expect(t).toBe('调用 createChart 创建 实例 & 配置');
  });
  it('XXE：含 DOCTYPE/ENTITY → 拒绝', () => {
    expect(() => extractOoxmlText('<!DOCTYPE foo><w:t>x</w:t>', 'w:t')).toThrow(OfficeParseError);
    expect(() => extractOoxmlText('<!ENTITY xxe SYSTEM "file:///etc/passwd"><w:t>x</w:t>', 'w:t')).toThrow(OfficeParseError);
  });
});

describe('parseOfficeFile', () => {
  it('docx → 抽正文', async () => {
    const r = await parseOfficeFile(makeDocx(DOCX_BODY), 'docx');
    expect(r.text).toContain('createChart');
    expect(r.text).toContain('& 配置'); // 实体解码
  });

  it('pptx → 抽幻灯片文本', async () => {
    const r = await parseOfficeFile(makePptx('<p:sld><a:t>幻灯片标题 setOption</a:t></p:sld>'), 'pptx');
    expect(r.text).toContain('setOption');
  });

  it('md → 直接解码', async () => {
    const r = await parseOfficeFile(strToU8('# 标题\n\n正文'), 'md');
    expect(r.text).toContain('标题');
  });

  it('XXE docx（document.xml 含 DOCTYPE）→ OfficeParseError', async () => {
    await expect(parseOfficeFile(makeDocx('<!DOCTYPE x><w:document><w:t>x</w:t></w:document>'), 'docx')).rejects.toBeInstanceOf(OfficeParseError);
  });

  it('zip bomb（entry 超 maxEntryBytes）→ 拒绝', async () => {
    const big = makeDocx('<w:document><w:t>' + 'A'.repeat(5000) + '</w:t></w:document>');
    await expect(parseOfficeFile(big, 'docx', { maxEntryBytes: 100 })).rejects.toBeInstanceOf(OfficeParseError);
  });

  it('损坏/非 zip 字节 → OfficeParseError（不崩）', async () => {
    await expect(parseOfficeFile(strToU8('not a zip at all'), 'docx')).rejects.toBeInstanceOf(OfficeParseError);
  });

  it('docx 缺 word/document.xml → OfficeParseError', async () => {
    const noDoc = zipSync({ 'other.xml': strToU8('<x/>') });
    await expect(parseOfficeFile(noDoc, 'docx')).rejects.toBeInstanceOf(OfficeParseError);
  });

  it('超大文件 → OfficeParseError', async () => {
    await expect(parseOfficeFile(makeDocx(DOCX_BODY), 'docx', { maxFileBytes: 10 })).rejects.toBeInstanceOf(OfficeParseError);
  });

  it('PDF 含 /Launch 主动内容 → 拒绝（不执行）', async () => {
    const pdf = strToU8('%PDF-1.4\n1 0 obj<< /Type /Action /S /Launch /F (calc.exe) >>endobj\n%%EOF');
    await expect(parseOfficeFile(pdf, 'pdf')).rejects.toBeInstanceOf(OfficeParseError);
  });

  it('PDF /OpenAction + /JavaScript → 拒绝', async () => {
    const pdf = strToU8('%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n%%EOF');
    await expect(parseOfficeFile(pdf, 'pdf')).rejects.toBeInstanceOf(OfficeParseError);
  });

  it('损坏 PDF（无文本层/非法）→ OfficeParseError', async () => {
    await expect(parseOfficeFile(strToU8('not a pdf'), 'pdf')).rejects.toBeInstanceOf(OfficeParseError);
  });
});
