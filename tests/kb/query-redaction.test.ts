/**
 * F241 T030 — 查询串 redaction 第一层（FR-012 / SC-009）
 *
 * 六类结构性规则各 ≥2 正例 + 1 反例；另断言规则表长度与 spec 文档表一致（防规则悄悄减少）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { redactQuery, REDACTION_RULES, REDACTION_PLACEHOLDER_TOKENS } from '../../src/scaffold-kb/query-redaction.js';
import { normalizeUnicode, tokenize } from '../../src/scaffold-kb/tokenizer.js';

/** 断言：输出不含原文敏感片段，且打上了预期 tag */
function expectRedacted(raw: string, secret: string, tag: string): { redacted: string; tags: string[] } {
  const out = redactQuery(raw);
  expect(out.redacted).not.toContain(secret);
  expect(out.tags).toContain(tag);
  return out;
}

describe('redactQuery — 规则表完整性（FR-012 防悄悄减少）', () => {
  it('规则表恰 6 条，id 集合与 spec FR-012 文档表一致', () => {
    expect(REDACTION_RULES.length).toBe(6);
    // spec 文档表的六类（文档按可读性排序，此处按 id 排序比对集合，不约束应用顺序）
    expect([...REDACTION_RULES.map((r) => r.id)].sort()).toEqual([
      'DIGITS',
      'EMAIL',
      'HIGH_ENTROPY',
      'HOME',
      'TOKEN',
      'URL_WITH_CRED',
    ]);
  });

  it('应用顺序的两处依赖被钉死（改序即回归）', () => {
    const order = REDACTION_RULES.map((r) => r.id);
    // URL_WITH_CRED 早于 EMAIL：user:pass@host 含 @，否则被 EMAIL 吃掉一半
    expect(order.indexOf('URL_WITH_CRED')).toBeLessThan(order.indexOf('EMAIL'));
    // TOKEN / HOME 早于 HIGH_ENTROPY：base64 字符集含 '/'，否则长路径被整体判为高熵串
    expect(order.indexOf('TOKEN')).toBeLessThan(order.indexOf('HIGH_ENTROPY'));
    expect(order.indexOf('HOME')).toBeLessThan(order.indexOf('HIGH_ENTROPY'));
  });

  it('每条规则都有唯一 placeholder，恒为 <id> 形态', () => {
    const placeholders = REDACTION_RULES.map((r) => r.placeholder);
    expect(new Set(placeholders).size).toBe(placeholders.length);
    for (const r of REDACTION_RULES) {
      expect(r.placeholder).toBe(`<${r.id}>`);
    }
  });

  it('占位 token 集合覆盖 placeholder 的**切词后**形态（EC-21 的实际过滤依据）', () => {
    // tokenizer 把 `_` 当分隔符并额外产出拼接形：<HIGH_ENTROPY> → HIGH / ENTROPY / HIGHENTROPY
    for (const t of ['EMAIL', 'TOKEN', 'HOME', 'DIGITS', 'HIGH', 'ENTROPY', 'HIGHENTROPY', 'URL', 'WITH', 'CRED', 'URLWITHCRED']) {
      expect(REDACTION_PLACEHOLDER_TOKENS.has(t)).toBe(true);
    }
    // 大小写敏感：用户查询里的小写同名词不会被误剔
    expect(REDACTION_PLACEHOLDER_TOKENS.has('token')).toBe(false);
    expect(REDACTION_PLACEHOLDER_TOKENS.has('home')).toBe(false);
  });
});

describe('redactQuery — email（<EMAIL>）', () => {
  it('正例 1：普通地址被整体替换', () => {
    const out = expectRedacted('联系 alice@example.com 排查', 'alice@example.com', 'EMAIL');
    expect(out.redacted).toContain('<EMAIL>');
  });
  it('正例 2：带点/加号的地址被整体替换', () => {
    expectRedacted('bug report from bob.smith+kb@corp.co.uk', 'bob.smith+kb@corp.co.uk', 'EMAIL');
  });
  it('反例：无地址形态的 @ 不触发', () => {
    const out = redactQuery('@decorator 用法');
    expect(out.tags).not.toContain('EMAIL');
    expect(out.redacted).toContain('@decorator');
  });
});

describe('redactQuery — 带凭据的 URL（<URL_WITH_CRED>）', () => {
  it('正例 1：user:pass@ 形态', () => {
    const out = expectRedacted('curl https://root:hunter2@db.internal/x 报错', 'hunter2', 'URL_WITH_CRED');
    expect(out.redacted).toContain('<URL_WITH_CRED>');
  });
  it('正例 2：token= 查询参数形态', () => {
    expectRedacted('https://api.example.com/v1/list?token=abc123zz&x=1 返回 401', 'abc123zz', 'URL_WITH_CRED');
  });
  it('正例 3：secret= / key= 查询参数形态', () => {
    expectRedacted('https://api.example.com/v1?key=s3cretvalue 怎么调用', 's3cretvalue', 'URL_WITH_CRED');
  });
  it('反例：无凭据的普通 URL 不触发', () => {
    const out = redactQuery('https://example.com/docs/auth 怎么读');
    expect(out.tags).not.toContain('URL_WITH_CRED');
    expect(out.redacted).toContain('https://example.com/docs/auth');
  });
});

describe('redactQuery — 疑似 token（<TOKEN>）', () => {
  it('正例 1：sk- 前缀', () => {
    const out = expectRedacted('key sk-abc123DEF456 无效', 'sk-abc123DEF456', 'TOKEN');
    expect(out.redacted).toContain('<TOKEN>');
  });
  it('正例 2：ghp_ 前缀', () => {
    expectRedacted('用 ghp_16charsAtLeastXX 拉仓库失败', 'ghp_16charsAtLeastXX', 'TOKEN');
  });
  it('正例 3：Bearer 头', () => {
    expectRedacted('Authorization: Bearer eyJhbGciOi.J9payload', 'eyJhbGciOi.J9payload', 'TOKEN');
  });
  it('反例：词内出现 sk- 的普通词不触发（task-runner）', () => {
    const out = redactQuery('task-runner 怎么配置');
    expect(out.tags).not.toContain('TOKEN');
    expect(out.redacted).toContain('task-runner');
  });
});

describe('redactQuery — 高熵串（<HIGH_ENTROPY>）', () => {
  it('正例 1：64 位 hex', () => {
    const hex = 'a'.repeat(20) + '9f3c1d2e';
    const out = expectRedacted(`校验和 ${hex} 对不上`, hex, 'HIGH_ENTROPY');
    expect(out.redacted).toContain('<HIGH_ENTROPY>');
  });
  it('正例 2：base64 字符集长串', () => {
    const b64 = 'QUJDRGVmZ2hJSktMbW5vUFFS';
    expectRedacted(`payload ${b64} 解不开`, b64, 'HIGH_ENTROPY');
  });
  it('反例：长度不足 20 的短 hex 不触发', () => {
    const out = redactQuery('commit abcdef123 是哪个');
    expect(out.tags).not.toContain('HIGH_ENTROPY');
    expect(out.redacted).toContain('abcdef123');
  });
});

describe('redactQuery — 绝对路径 home 段（<HOME>）', () => {
  it('正例 1：macOS /Users/<name>', () => {
    const out = expectRedacted('/Users/connorlu/projects/kb 里报错', '/Users/connorlu', 'HOME');
    expect(out.redacted).toContain('<HOME>');
    expect(out.redacted).toContain('/projects/kb'); // 仅遮蔽 home 段，路径其余部分保留
  });
  it('正例 2：Linux /home/<name>', () => {
    expectRedacted('日志在 /home/deployer/var/log 下', '/home/deployer', 'HOME');
  });
  it('正例 3：Windows C:\\Users\\<name>', () => {
    expectRedacted('路径 C:\\Users\\Alice\\AppData 打不开', 'C:\\Users\\Alice', 'HOME');
  });
  it('反例：非 home 的绝对路径不触发', () => {
    const out = redactQuery('/var/log/app.log 在哪');
    expect(out.tags).not.toContain('HOME');
    expect(out.redacted).toContain('/var/log/app.log');
  });
});

describe('redactQuery — 连续数字串（<DIGITS>）', () => {
  it('正例 1：10 位数字', () => {
    const out = expectRedacted('工单 13800138000 的处理', '13800138000', 'DIGITS');
    expect(out.redacted).toContain('<DIGITS>');
  });
  it('正例 2：恰 8 位数字（边界）', () => {
    expectRedacted('订单 12345678 查不到', '12345678', 'DIGITS');
  });
  it('反例：7 位数字（边界下）不触发', () => {
    const out = redactQuery('错误 1234567 是什么');
    expect(out.tags).not.toContain('DIGITS');
    expect(out.redacted).toContain('1234567');
  });
});

describe('redactQuery — 组合与不变量', () => {
  it('多类共存时全部被遮蔽，tags 去重且只含命中类型', () => {
    const raw = 'alice@example.com 在 /Users/bob/w 用 sk-abcdef123456 查 13800138000';
    const out = redactQuery(raw);
    for (const secret of ['alice@example.com', '/Users/bob', 'sk-abcdef123456', '13800138000']) {
      expect(out.redacted).not.toContain(secret);
    }
    expect(new Set(out.tags).size).toBe(out.tags.length);
    expect(out.tags.sort()).toEqual(['DIGITS', 'EMAIL', 'HOME', 'TOKEN']);
  });

  it('无敏感内容时原串不变、tags 为空', () => {
    const raw = '如何配置 retry 超时';
    const out = redactQuery(raw);
    expect(out.redacted).toBe(raw);
    expect(out.tags).toEqual([]);
  });

  it('空串与纯空白安全返回', () => {
    expect(redactQuery('').redacted).toBe('');
    expect(redactQuery('   ').tags).toEqual([]);
  });
});

/**
 * F241 B2-1（M-3 A-C2 / B-W2 交集）——redaction 必须先 NFKC，且关键规则大小写不敏感。
 *
 * 攻击形态：全角数字躲过 `DIGITS`，随后被落盘侧 tokenizer 的 NFKC 还原成 ASCII 敏感数字。
 */
describe('redactQuery — 归一化前置与大小写不敏感（B2-1）', () => {
  it('全角数字先 NFKC 再匹配 → 命中 DIGITS，切词后不残留 ASCII 数字', () => {
    const out = redactQuery('１２３４５６７８');
    expect(out.tags).toContain('DIGITS');
    expect(out.redacted).toContain('<DIGITS>');
    // 关键：落盘侧切词还原后也不能出现敏感数字
    expect(tokenize(out.redacted).join(' ')).not.toContain('12345678');
  });

  it('全角与半角输入产生逐字相同的 redaction 结果（同一归一化链）', () => {
    expect(redactQuery('１２３４５６７８').redacted).toBe(redactQuery('12345678').redacted);
    expect(redactQuery('ａｌｉｃｅ@ｅｘａｍｐｌｅ.ｃｏｍ').tags).toContain('EMAIL');
  });

  it('URL 凭据参数名大写 TOKEN= 同样被遮蔽', () => {
    const out = expectRedacted('https://api.example.com/?TOKEN=hunter2 报 401', 'hunter2', 'URL_WITH_CRED');
    expect(out.redacted).toContain('<URL_WITH_CRED>');
  });

  it('小写 bearer scheme 同样被遮蔽', () => {
    expectRedacted('authorization: bearer abcDEF123_xyz', 'abcDEF123_xyz', 'TOKEN');
  });

  it('小写 Windows home 路径 c:\\users\\Alice 被遮蔽', () => {
    expectRedacted('路径 c:\\users\\Alice\\secret 打不开', 'Alice', 'HOME');
  });

  it('小写 /users/ 与 /home/ 段大小写变体被遮蔽', () => {
    expectRedacted('日志在 /users/bob/w 下', '/users/bob', 'HOME');
    expectRedacted('日志在 /HOME/deployer/log 下', '/HOME/deployer', 'HOME');
  });

  it('跨类混合（全角数字 + 大写 TOKEN= + 小写 bearer）全部命中', () => {
    const out = redactQuery('１２３４５６７８ https://a.example.com/?Api_Key=zz9 bearer abcDEF123');
    expect(out.tags.sort()).toEqual(['DIGITS', 'TOKEN', 'URL_WITH_CRED']);
    for (const secret of ['12345678', 'zz9', 'abcDEF123']) {
      expect(tokenize(out.redacted).join(' ')).not.toContain(secret);
    }
  });

  it('sk- / ghp_ 前缀保持大小写敏感（不放宽，避免误遮普通大写词）', () => {
    const out = redactQuery('常量 SK-ABCDEFGH12 是什么');
    expect(out.tags).not.toContain('TOKEN');
  });

  it('归一化只有一份实现：src/ 全树的 NFKC 调用点恰 1 处，且在 tokenizer.ts', () => {
    // 只看代码行，跳过注释（模块文档里会引用这个字面量说明"禁止在别处再写"）
    const isComment = (line: string): boolean => /^\s*(\/\/|\/?\*)/.test(line);
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) {
          readFileSync(p, 'utf-8').split('\n').forEach((line) => {
            if (!isComment(line) && /\.normalize\(\s*['"]NFKC['"]\s*\)/.test(line)) {
              hits.push(`${p.slice(process.cwd().length + 1)}: ${line.trim()}`);
            }
          });
        }
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(hits).toEqual(['src/scaffold-kb/tokenizer.ts: return text.normalize(\'NFKC\');']);
    // redaction 侧走导出的归一化函数，而不是自己再写一份
    expect(readFileSync(join(process.cwd(), 'src/scaffold-kb/query-redaction.ts'), 'utf-8')).toMatch(/normalizeUnicode/);
    // 行为同源：redaction 的归一化输出与 tokenizer 导出的归一化函数一致
    expect(redactQuery('ＡＰＩ 超时').redacted).toBe(normalizeUnicode('ＡＰＩ 超时'));
  });
});
