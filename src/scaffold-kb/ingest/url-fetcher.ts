/**
 * F192 T014 — SSRF 安全 URL 抓取（FR-010，唯一联网点）
 *
 * 用 node:http/https + 自定义 `lookup`：DNS 解析后校验 IP，连接用校验后的 IP
 * （node 直接用 lookup 结果连，无 rebinding 重解析窗口，C-5）。
 * 协议白名单 + 内网/loopback/link-local/ULA/mapped 封锁 + 手写逐跳 redirect（限跳数 +
 * 跨协议拒绝）+ 连接/读超时 + 流式字节上限 + content-type 校验。
 *
 * isBlockedIp / makeSsrfLookup 为纯/可注入函数，SSRF 核心逻辑可确定性单测。
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { lookup as nodeDnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

export interface SafeFetchOptions {
  /** 单次请求 idle 超时（连接/读取静默） */
  timeoutMs?: number;
  /** 总 wall-clock 超时（覆盖 DNS+连接+读取+全部 redirect，防慢速攻击） */
  totalTimeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** 注入 DNS lookup（测试用），缺省 node:dns.lookup */
  dnsLookup?: typeof nodeDnsLookup;
}

export interface SafeFetchResult {
  finalUrl: string;
  contentType: string;
  markdown: string;
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const DEFAULTS = { timeoutMs: 10_000, totalTimeoutMs: 30_000, maxBytes: 5_000_000, maxRedirects: 5 };
const ALLOWED_MIME = new Set(['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown']);

/** 判断 IP 是否在封锁段（loopback/私网/link-local/ULA/未指定/IPv4-mapped IPv6） */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return true; // 非法 IP 一律封锁（保守）
  if (kind === 4) return isBlockedV4(ip);
  return isBlockedV6(ip);
}

function isBlockedV4(ip: string): boolean {
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 未指定
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 私网
  if (a === 172 && b >= 16 && b <= 31) return true; // 私网
  if (a === 192 && b === 168) return true; // 私网
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

/** 展开 IPv6 为 8 个 hextet（含内嵌 IPv4 转换）；非法返回 null */
function expandV6(ipRaw: string): number[] | null {
  let s = (ipRaw.toLowerCase().split('%')[0] ?? ipRaw).trim();
  // 内嵌 IPv4（::ffff:1.2.3.4 / ::1.2.3.4）→ 转两个 hextet
  const v4Match = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(s);
  if (v4Match) {
    const v4 = v4Match[2]!.split('.').map((n) => parseInt(n, 10));
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const g7 = (v4[0]! << 8) | v4[1]!;
    const g8 = (v4[2]! << 8) | v4[3]!;
    s = `${v4Match[1]}${g7.toString(16)}:${g8.toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (parts.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (parts.length === 2 && fill < 1)) return null;
  const groups = parts.length === 2 ? [...head, ...Array(fill).fill('0'), ...tail] : head;
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (g === '' ? 0 : parseInt(g, 16)));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

function isBlockedV6(ipRaw: string): boolean {
  const g = expandV6(ipRaw);
  if (!g) return true; // 解析失败保守封锁
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  // :: 未指定 / ::1 loopback
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true;
  // fe80::/10 link-local（首 hextet 0xfe80–0xfebf）
  if (g0 >= 0xfe80 && g0 <= 0xfebf) return true;
  // fc00::/7 ULA（首 hextet 0xfc00–0xfdff）
  if (g0 >= 0xfc00 && g0 <= 0xfdff) return true;
  // ::ffff:0:0/96 IPv4-mapped → 校验内嵌 v4
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isBlockedV4(`${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`);
  }
  // ::/96 IPv4-compatible（已废弃）非 ::/::1 → 校验内嵌 v4
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && (g6 !== 0 || g7 > 1)) {
    return isBlockedV4(`${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`);
  }
  return false;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string, family: number) => void;

/** 构造校验 IP 的 lookup（DNS 解析后封锁非法 IP，连接用校验结果，防 rebinding） */
export function makeSsrfLookup(dnsLookup: typeof nodeDnsLookup = nodeDnsLookup) {
  return function ssrfLookup(hostname: string, options: unknown, callback: LookupCallback): void {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        callback(err, '', 4);
        return;
      }
      const list = Array.isArray(addresses) ? addresses : [];
      const ok = list.find((a) => !isBlockedIp(a.address));
      if (!ok) {
        callback(new SsrfError(`目标 ${hostname} 解析到被封锁地址（内网/loopback/link-local）`), '', 4);
        return;
      }
      callback(null, ok.address, ok.family);
    });
  };
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** 单次请求（含协议白名单 + IP literal 校验 + lookup + 超时 + 流式字节上限 + 总 deadline signal）；不跟随 redirect */
function fetchRaw(
  url: string,
  opts: Required<Omit<SafeFetchOptions, 'dnsLookup'>> & { dnsLookup: typeof nodeDnsLookup },
  signal: AbortSignal,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new SsrfError(`非法 URL: ${url}`));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new SsrfError(`协议不在白名单（仅 http/https）: ${parsed.protocol}`));
      return;
    }
    // C-1：IP literal（十进制/十六进制/八进制已被 URL 规范化为 dotted；及 IPv6 字面量）
    // node http 对 IP literal **不触发 lookup**，必须在此显式校验，否则 SSRF 防线被完全绕过。
    const host = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    if (isIP(host) !== 0 && isBlockedIp(host)) {
      reject(new SsrfError(`目标 IP 在封锁段: ${host}`));
      return;
    }
    const requestFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requestFn(
      url,
      { lookup: makeSsrfLookup(opts.dnsLookup), timeout: opts.timeoutMs, method: 'GET', signal },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > opts.maxBytes) {
            req.destroy(new SsrfError(`响应体超过 ${opts.maxBytes} 字节上限`));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf-8') });
        });
      },
    );
    req.on('timeout', () => req.destroy(new SsrfError('请求超时')));
    req.on('error', (e) => reject(e));
    req.end();
  });
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

/** 从 HTML 抽主内容 → Markdown（readability + turndown；linkedom 不执行脚本） */
export function htmlToMarkdown(html: string, url: string): { title: string; markdown: string } {
  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]);
    const article = reader.parse();
    const contentHtml = article?.content ?? html;
    const title = article?.title ?? '';
    return { title, markdown: turndown.turndown(contentHtml) };
  } catch {
    // readability 失败 → 整页转换兜底
    return { title: '', markdown: turndown.turndown(html) };
  }
}

/** SSRF 安全抓取 URL → 主内容 Markdown（手写逐跳 redirect，每跳重校验） */
export async function safeFetchUrl(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = {
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    totalTimeoutMs: options.totalTimeoutMs ?? DEFAULTS.totalTimeoutMs,
    maxBytes: options.maxBytes ?? DEFAULTS.maxBytes,
    maxRedirects: options.maxRedirects ?? DEFAULTS.maxRedirects,
    dnsLookup: options.dnsLookup ?? nodeDnsLookup,
  };
  // 总 wall-clock deadline（覆盖全流程，防慢速攻击；W）
  const controller = new AbortController();
  const wallTimer = setTimeout(() => controller.abort(), opts.totalTimeoutMs);
  try {
    let current = url;
    let prevProtocol: string | null = null;
    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
      let proto: string;
      try {
        proto = new URL(current).protocol;
      } catch {
        throw new SsrfError(`非法 URL: ${current}`);
      }
      // 跨协议降级（https→http）拒绝
      if (prevProtocol === 'https:' && proto === 'http:') {
        throw new SsrfError('重定向跨协议降级（https→http）被拒绝');
      }
      prevProtocol = proto;
      const res = await fetchRaw(current, opts, controller.signal);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers['location'];
        const locStr = Array.isArray(loc) ? loc[0] : loc;
        if (!locStr) throw new SsrfError('重定向无 Location');
        if (hop === opts.maxRedirects) throw new SsrfError(`重定向超过最大跳数 ${opts.maxRedirects}`);
        current = new URL(locStr, current).toString(); // 解析相对/protocol-relative，下一跳重新校验
        continue;
      }
      if (res.status >= 400) throw new SsrfError(`HTTP ${res.status}`);
      // content-type 精确校验（主 MIME 精确匹配，拒绝空、拒绝子串绕过；W）
      const ctRaw = res.headers['content-type'];
      const ctFull = (Array.isArray(ctRaw) ? (ctRaw[0] ?? '') : (ctRaw ?? '')).toLowerCase();
      const mime = ctFull.split(';')[0]?.trim() ?? '';
      if (!ALLOWED_MIME.has(mime)) {
        throw new SsrfError(`content-type 不接受（仅 HTML/text，拒绝空）: ${ctFull || '(空)'}`);
      }
      const { markdown } = htmlToMarkdown(res.body, current);
      return { finalUrl: current, contentType: mime, markdown };
    }
    throw new SsrfError(`重定向超过最大跳数 ${opts.maxRedirects}`);
  } finally {
    clearTimeout(wallTimer);
  }
}
