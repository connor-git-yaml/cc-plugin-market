/**
 * F192 T014 / SC-007a — SSRF 安全核心（isBlockedIp / makeSsrfLookup）+ 协议白名单 + html→md
 * 纯/注入逻辑确定性单测，不打真实网络。
 */

import { describe, it, expect } from 'vitest';
import {
  isBlockedIp,
  makeSsrfLookup,
  htmlToMarkdown,
  safeFetchUrl,
  SsrfError,
} from '../../src/scaffold-kb/ingest/url-fetcher.js';
import type { lookup as nodeDnsLookup } from 'node:dns';

describe('isBlockedIp（SSRF 地址封锁）', () => {
  it('封锁 loopback / 私网 / link-local / ULA / 未指定 / CGNAT', () => {
    for (const ip of [
      '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255',
      '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1',
      '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip',
    ]) {
      expect(isBlockedIp(ip), `${ip} 应封锁`).toBe(true);
    }
  });

  it('放行公网 IP', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111']) {
      expect(isBlockedIp(ip), `${ip} 应放行`).toBe(false);
    }
  });

  it('172.x 边界：仅 16-31 私网', () => {
    expect(isBlockedIp('172.15.0.1')).toBe(false); // 公网
    expect(isBlockedIp('172.32.0.1')).toBe(false); // 公网
    expect(isBlockedIp('172.20.0.1')).toBe(true); // 私网
  });

  it('IPv6 mapped 十六进制压缩形（codex C-2）+ fe80::/10 全段（codex W）', () => {
    expect(isBlockedIp('::ffff:7f00:1')).toBe(true); // = 127.0.0.1
    expect(isBlockedIp('::ffff:0a00:1')).toBe(true); // = 10.0.0.1
    expect(isBlockedIp('fe90::1')).toBe(true); // fe80::/10
    expect(isBlockedIp('fea0::1')).toBe(true);
    expect(isBlockedIp('febf::1')).toBe(true);
    expect(isBlockedIp('fd12:3456:789a::1')).toBe(true); // ULA fc00::/7
  });
});

describe('safeFetchUrl — IP literal 绕过 lookup（codex C-1）', () => {
  it('十进制/十六进制/八进制/IPv6 literal 直指内网 → SsrfError（不发请求）', async () => {
    // new URL 规范化：2130706433 → 127.0.0.1
    for (const u of [
      'http://2130706433/admin', // 十进制 127.0.0.1
      'http://0x7f000001/', // 十六进制
      'http://127.0.0.1:8080/', // dotted
      'http://[::1]/', // IPv6 loopback
      'http://[::ffff:127.0.0.1]/', // mapped
      'http://[fd00::1]/', // ULA
    ]) {
      await expect(safeFetchUrl(u), `${u} 应拒`).rejects.toBeInstanceOf(SsrfError);
    }
  });
});

function fakeDns(addresses: Array<{ address: string; family: number }>): typeof nodeDnsLookup {
  return ((_host: string, _opts: unknown, cb: (e: Error | null, a: unknown, f?: number) => void) => {
    cb(null, addresses as unknown as string, undefined);
  }) as unknown as typeof nodeDnsLookup;
}

describe('makeSsrfLookup（DNS 解析后校验 IP，防 rebinding）', () => {
  it('解析到内网 → SsrfError', () => {
    const lookup = makeSsrfLookup(fakeDns([{ address: '10.0.0.5', family: 4 }]));
    lookup('evil.internal', {}, (err) => {
      expect(err).toBeInstanceOf(SsrfError);
    });
  });

  it('解析到公网 → 放行该 IP', () => {
    const lookup = makeSsrfLookup(fakeDns([{ address: '93.184.216.34', family: 4 }]));
    lookup('example.com', {}, (err, addr) => {
      expect(err).toBeNull();
      expect(addr).toBe('93.184.216.34');
    });
  });

  it('混合解析（公网+内网）→ 连接公网 IP（不碰内网）', () => {
    const lookup = makeSsrfLookup(fakeDns([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]));
    lookup('mixed.com', {}, (err, addr) => {
      expect(err).toBeNull();
      expect(addr).toBe('93.184.216.34');
    });
  });

  it('全部解析到内网 → SsrfError（无可用公网 IP）', () => {
    const lookup = makeSsrfLookup(fakeDns([{ address: '10.0.0.1', family: 4 }, { address: '192.168.0.1', family: 4 }]));
    lookup('all-internal.com', {}, (err) => {
      expect(err).toBeInstanceOf(SsrfError);
    });
  });
});

describe('safeFetchUrl 协议白名单', () => {
  it('非 http/https 协议 → SsrfError（不发请求）', async () => {
    await expect(safeFetchUrl('ftp://example.com/x')).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetchUrl('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfError);
  });

  it('非法 URL → SsrfError', async () => {
    await expect(safeFetchUrl('not a url')).rejects.toBeInstanceOf(SsrfError);
  });
});

describe('htmlToMarkdown', () => {
  it('抽主内容转 Markdown（标题 + 正文）', () => {
    const html = `<html><head><title>Doc T</title></head><body>
      <nav>导航垃圾</nav>
      <article><h1>API 指南</h1><p>调用 createChart 创建实例。</p></article>
    </body></html>`;
    const { markdown } = htmlToMarkdown(html, 'https://example.com/doc');
    expect(markdown).toContain('createChart');
  });

  it('坏 HTML 不崩，兜底转换', () => {
    const { markdown } = htmlToMarkdown('<p>纯文本片段', 'https://example.com/x');
    expect(typeof markdown).toBe('string');
  });
});
