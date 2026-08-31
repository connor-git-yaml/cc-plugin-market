/**
 * Feature 240 / T016 — Codex hooks 事件名两层门禁（FR-002 / SC-002）
 *
 * 两层门禁的**作用域**是本用例集的核心（plan §6.4，闭合审查结论 C4）：
 * - **schema 层**看全文件的事件名合法性，但对**第三方**条目的未知事件名只判 `warning`；
 *   判 `fail` 只发生在**我方 owned 条目**所在事件名非法时。
 * - **产品层**只看 `isOwnedEntry` 为真的条目所覆盖的事件集合，恰等于 4 项。
 *
 * 🔴 反向不变量：绝不能因为用户自己的 `PermissionRequest` / 未知事件条目而判 fail ——
 * 那等于用我方门禁逼用户删自己的数据，与 FR-011 的非破坏性合并直接冲突。
 *
 * 运行：npx vitest run tests/unit/codex-hooks-event-gate.test.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs', import.meta.url).href
);
const generator = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-generator.mjs', import.meta.url).href
);
const installer = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs', import.meta.url).href
);

const CANONICAL_HOOKS_JSON = path.join(repoRoot, 'plugins', 'spec-driver', 'hooks', 'hooks.json');
const PLUGIN_ROOT = path.join(repoRoot, 'plugins', 'spec-driver');

type Finding = { level: string; layer: string; code: string; event?: string };

/**
 * 造一个我方条目。
 * 🔴 归属锚点要求的是**完整相对后缀**（`spec-driver/…/hooks/<脚本>` 或
 * `spec-driver/…/scripts/postinstall.sh`），不是"路径里有 spec-driver + basename 对得上"。
 * 所以 `suffix` 必须写全父目录，不能只给文件名。
 */
function ownedGroup(suffix: string, root = '/opt/plugins/spec-driver'): unknown {
  return {
    matcher: '',
    hooks: [{ type: 'command', command: `bash ${root}/${suffix}` }],
  };
}

/** 造一个第三方条目（既无归属脚本名，也无 spec-driver 目录分量） */
function foreignGroup(command = 'bash /opt/other/my-own-hook.sh'): unknown {
  return { matcher: '', hooks: [{ type: 'command', command }] };
}

/** 我方 4 事件全覆盖的最小合法文档 */
function ownedFourEventDoc(): Record<string, unknown> {
  return {
    hooks: {
      SessionStart: [ownedGroup('scripts/postinstall.sh')],
      PreToolUse: [ownedGroup('hooks/pre-tool-use-guard.sh')],
      // F270 P5：PostToolUse 下现有两条 handler（prettier + 账本采集器），与 Stop 下两条同构
      PostToolUse: [
        ownedGroup('hooks/post-tool-use-format.sh'),
        ownedGroup('hooks/post-tool-use-ledger.sh'),
      ],
      Stop: [
        ownedGroup('hooks/stop-task-check.sh'),
        ownedGroup('hooks/stop-fix-compliance-check.sh'),
      ],
    },
  };
}

function codes(findings: Finding[]): string[] {
  return findings.map((f) => f.code);
}

describe('CODEX 事件常量', () => {
  it('schema 层为 11 个事件，产品层为 4 个事件且是前者子集', () => {
    // F264：`SessionEnd` 依 0.149.0 口径补入（10→11）。本机 0.144.6 实测**不接受**它，
    // 见 codex-hooks-schema.mjs 的版本相关性说明——补入只放宽第三方条目的告警面，
    // 产品集下面仍钉死 4 项不变。
    expect(schema.CODEX_EVENT_SCHEMA_SET).toHaveLength(11);
    expect([...schema.CODEX_EVENT_SCHEMA_SET].sort()).toEqual(
      [
        'PostCompact',
        'PostToolUse',
        'PreCompact',
        'PreToolUse',
        'PermissionRequest',
        'SessionStart',
        'SessionEnd',
        'Stop',
        'SubagentStart',
        'SubagentStop',
        'UserPromptSubmit',
      ].sort(),
    );
    expect([...schema.CODEX_EVENT_PRODUCT_SET]).toEqual([
      'SessionStart',
      'PreToolUse',
      'PostToolUse',
      'Stop',
    ]);
    for (const event of schema.CODEX_EVENT_PRODUCT_SET) {
      expect(schema.CODEX_EVENT_SCHEMA_SET).toContain(event);
    }
    // Codex 全集中不存在 Worktree 系列（Claude adapter 独有）
    expect(schema.CODEX_EVENT_SCHEMA_SET).not.toContain('WorktreeCreate');
    expect(schema.CODEX_EVENT_SCHEMA_SET).not.toContain('WorktreeRemove');
  });
});

describe('schema 层：事件名合法性（作用域 = 全文件，失败级别按归属分流）', () => {
  it.each(['pre_tool_use', 'PreToolUSE', 'NotAnEvent'])(
    '我方条目落在非法事件名 %s 上 → fail（owned-event-illegal）',
    (badEvent) => {
      const doc = ownedFourEventDoc();
      (doc['hooks'] as Record<string, unknown>)[badEvent] = [ownedGroup('hooks/stop-task-check.sh')];
      const report = schema.validateCodexHooksDocument(doc, { checkCommandShape: false });
      expect(report.ok).toBe(false);
      expect(report.status).toBe('fail');
      const owned = report.findings.filter((f: Finding) => f.code === 'owned-event-illegal');
      expect(owned).toHaveLength(1);
      expect(owned[0].event).toBe(badEvent);
      expect(owned[0].layer).toBe('schema');
    },
  );

  it('第三方条目落在未知事件名上 → warning，不判 fail', () => {
    const doc = ownedFourEventDoc();
    (doc['hooks'] as Record<string, unknown>)['NotAnEvent'] = [foreignGroup()];
    const report = schema.validateCodexHooksDocument(doc, { checkCommandShape: false });
    expect(report.ok).toBe(true);
    expect(report.status).toBe('warning');
    expect(codes(report.findings)).toContain('unknown-event-name');
    expect(codes(report.findings)).not.toContain('owned-event-illegal');
  });

  it('第三方条目落在合法但非我方 4 事件的 PermissionRequest 上 → 两层均 pass', () => {
    const doc = ownedFourEventDoc();
    (doc['hooks'] as Record<string, unknown>)['PermissionRequest'] = [foreignGroup()];
    const report = schema.validateCodexHooksDocument(doc, { checkCommandShape: false });
    expect(report.ok).toBe(true);
    expect(report.status).toBe('pass');
    expect(report.findings).toEqual([]);
    expect([...report.ownedEvents].sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'].sort(),
    );
  });
});

describe('产品层：作用域仅限我方 owned 条目', () => {
  it('我方条目出现在合法但越界的 PermissionRequest 上 → schema pass + 产品层 fail，且 code 与 schema 层可区分', () => {
    const doc = ownedFourEventDoc();
    (doc['hooks'] as Record<string, unknown>)['PermissionRequest'] = [
      ownedGroup('hooks/stop-task-check.sh'),
    ];
    const report = schema.validateCodexHooksDocument(doc, { checkCommandShape: false });
    expect(report.ok).toBe(false);
    expect(codes(report.findings)).toContain('product-event-out-of-scope');
    expect(codes(report.findings)).not.toContain('owned-event-illegal');
    const outOfScope = report.findings.find(
      (f: Finding) => f.code === 'product-event-out-of-scope',
    );
    expect(outOfScope.layer).toBe('product');
    expect(outOfScope.event).toBe('PermissionRequest');
  });

  it('我方条目缺少某个必需事件 → product-event-missing（与越界 code 不同）', () => {
    const doc = ownedFourEventDoc();
    delete (doc['hooks'] as Record<string, unknown>)['PostToolUse'];
    const report = schema.validateCodexHooksDocument(doc, { checkCommandShape: false });
    expect(report.ok).toBe(false);
    const missing = report.findings.filter((f: Finding) => f.code === 'product-event-missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].event).toBe('PostToolUse');
    expect(codes(report.findings)).not.toContain('product-event-out-of-scope');
  });

  it('checkCommandShape 打开时校验我方 command 的绝对路径 / 无插值 / type', () => {
    // 归属根本身仍是**我方形态**（路径含精确 spec-driver 目录分量）但插值未展开：
    // 这是 owned-command-interpolated 唯一可达的形态，也是生成器漏展开时的真实产物形状。
    // 🔴 不能用 `${CLAUDE_PLUGIN_ROOT}/hooks/x.sh` 造这条用例 —— 那种形态在校验全局共享文件的
    // 默认口径下**刻意不算我方**（认领 = 获得删除权，见 schema 模块 findScriptPath 注释），
    // 走的是下一条用例断言的 product-event-missing 分支。
    const relative = {
      hooks: {
        ...(ownedFourEventDoc()['hooks'] as Record<string, unknown>),
        Stop: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: 'bash ${CODEX_PLUGIN_ROOT}/spec-driver/hooks/stop-task-check.sh',
              },
            ],
          },
        ],
      },
    };
    const report = schema.validateCodexHooksDocument(relative, { checkCommandShape: true });
    expect(report.ok).toBe(false);
    expect(codes(report.findings)).toContain('owned-command-interpolated');
    expect(codes(report.findings)).toContain('owned-command-not-absolute');

    const badType = ownedFourEventDoc();
    (badType['hooks'] as Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>)[
      'PreToolUse'
    ][0].hooks[0]['type'] = 'prompt';
    const typeReport = schema.validateCodexHooksDocument(badType, { checkCommandShape: true });
    expect(codes(typeReport.findings)).toContain('owned-handler-type-invalid');
  });

  it('生成器漏展开 ${CLAUDE_PLUGIN_ROOT} 时仍 fail-loud —— 走 product-event-missing 分支而非静默放行', () => {
    // 归属判定不认领占位形态（否则等于给自己发删除他人数据的许可证），因此该缺陷不体现为
    // owned-command-interpolated，而是「我方条目一个都找不到」。两条路径都必须是 fail。
    const unexpanded = {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh' },
            ],
          },
        ],
      },
    };
    const report = schema.validateCodexHooksDocument(unexpanded, { checkCommandShape: true });
    expect(report.ok).toBe(false);
    expect(report.ownedEvents).toEqual([]);
    expect(codes(report.findings).filter((c) => c === 'product-event-missing')).toHaveLength(4);
  });
});

describe('🔴 C4 回归钉子：含第三方数据的最终文件不得因用户数据判 fail', () => {
  it('第三方 PermissionRequest + 未知事件名共存时：ok、owned 恰 4 项、文档未被改动', () => {
    const doc = ownedFourEventDoc();
    (doc['hooks'] as Record<string, unknown>)['PermissionRequest'] = [
      foreignGroup('bash /opt/vendor/permission.sh'),
    ];
    (doc['hooks'] as Record<string, unknown>)['SomeFutureEvent'] = [
      foreignGroup('bash /opt/vendor/future.sh'),
    ];
    const before = JSON.stringify(doc);

    const report = schema.validateCodexHooksDocument(doc, { checkCommandShape: false });

    expect(report.ok).toBe(true);
    expect(report.status).toBe('warning');
    expect([...report.ownedEvents].sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'].sort(),
    );
    expect(codes(report.findings)).toEqual(['unknown-event-name']);
    // 校验是纯函数：不得改动入参
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('canonicalSource 放宽只作用于 canonical，不外溢到全局共享文件', () => {
  it('默认（校验 $CODEX_HOME/hooks.json 的口径）下，${CLAUDE_PLUGIN_ROOT} 形态的条目不算我方', () => {
    const doc = {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              // 某个 Claude 插件误写进 Codex 全局文件的条目：不得被我方认领（认领 = 卸载时删他人数据）
              { type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh' },
            ],
          },
        ],
      },
    };
    expect(schema.collectOwnedEvents(doc)).toEqual([]);
    expect(schema.collectOwnedEvents(doc, { allowPlaceholderRoot: true })).toEqual(['SessionStart']);
  });
});

describe('三处校验对象各自成立', () => {
  it('(a) canonical source：owned 事件集合恰 4 项，Worktree 系列被识别为 Claude 独有而非未知第三方', () => {
    const canonical = JSON.parse(fs.readFileSync(CANONICAL_HOOKS_JSON, 'utf-8'));
    // canonical 用 ${CLAUDE_PLUGIN_ROOT} 插值：形状校验此时不适用（生成期才展开），
    // 归属判定需显式开 canonicalSource（占位记号代替 spec-driver 分量）
    const report = schema.validateCodexHooksDocument(canonical, {
      checkCommandShape: false,
      canonicalSource: true,
    });
    expect(report.ok).toBe(true);
    expect([...report.ownedEvents].sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'].sort(),
    );
    expect(codes(report.findings).sort()).toEqual(['claude-only-event', 'claude-only-event']);
  });

  it('(b) 生成结果：产品层 4 项 + 形状校验全过', () => {
    const canonical = JSON.parse(fs.readFileSync(CANONICAL_HOOKS_JSON, 'utf-8'));
    const generated = generator.generateCodexHooks({ canonical, pluginRoot: PLUGIN_ROOT });
    const report = schema.validateCodexHooksDocument(generated, { checkCommandShape: true });
    expect(report.ok).toBe(true);
    expect(report.status).toBe('pass');
    expect([...report.ownedEvents].sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'].sort(),
    );
  });

  it('(c) 安装后的最终 $CODEX_HOME/hooks.json（已合并第三方数据）：只按 owned 作用域判定', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-gate-'));
    try {
      const target = path.join(codexHome, 'hooks.json');
      fs.writeFileSync(
        target,
        JSON.stringify(
          {
            description: '用户自己的 hooks',
            hooks: {
              PermissionRequest: [foreignGroup('bash /opt/vendor/permission.sh')],
              SomeFutureEvent: [foreignGroup('bash /opt/vendor/future.sh')],
            },
          },
          null,
          2,
        ),
      );

      const canonical = JSON.parse(fs.readFileSync(CANONICAL_HOOKS_JSON, 'utf-8'));
      const entries = generator.generateCodexHooks({ canonical, pluginRoot: PLUGIN_ROOT });
      installer.installCodexHooks({ codexHome, entries });

      const merged = JSON.parse(fs.readFileSync(target, 'utf-8'));
      const report = schema.validateCodexHooksDocument(merged, { checkCommandShape: true });

      expect(report.ok).toBe(true);
      expect([...report.ownedEvents].sort()).toEqual(
        ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'].sort(),
      );
      // 第三方条目原样保留
      expect(merged.hooks.PermissionRequest).toEqual([
        foreignGroup('bash /opt/vendor/permission.sh'),
      ]);
      expect(merged.description).toBe('用户自己的 hooks');
    } finally {
      fs.rmSync(codexHome, { recursive: true, force: true });
    }
  });
});

/**
 * F264 — 产品层 handler 级判据（事件级判据的必要补强）
 *
 * 立论：事件集合是 handler 集合的**有损投影**。`Stop` 下挂着两条脚本，只丢掉
 * `stop-fix-compliance-check.sh`（依从性判定器本体）时事件集合毫无变化 —— 旧的事件级判据
 * 对这个"最该被拦下的缺口"判 pass。本组用例用**变异**钉死这条守护力：把守护删掉，
 * 下面第一条用例必红。
 */
describe('F264 — 产品层 handler 级判据', () => {
  const canonicalOptions = { checkCommandShape: false, canonicalSource: true };
  const readCanonical = () => JSON.parse(fs.readFileSync(CANONICAL_HOOKS_JSON, 'utf-8'));
  const productCodes = (report: { findings: Finding[] }) =>
    report.findings.filter((f) => f.layer === 'product').map((f) => f.code);

  it('canonical hooks.json 本身通过 handler 级判据（无 product 层 finding）', () => {
    const report = schema.validateCodexHooksDocument(readCanonical(), canonicalOptions);
    expect(productCodes(report)).toEqual([]);
  });

  it('🔴 Stop 事件仍在、只缺 stop-fix-compliance handler → 事件级判 pass，handler 级必须判 fail', () => {
    const doc = readCanonical();
    doc.hooks.Stop = doc.hooks.Stop.filter(
      (group: unknown) => !JSON.stringify(group).includes('stop-fix-compliance'),
    );
    const report = schema.validateCodexHooksDocument(doc, canonicalOptions);

    // 事件级判据对该缺口完全无感：Stop 仍在 owned 事件集合里，也没有 product-event-missing
    expect(report.ownedEvents).toContain('Stop');
    expect(productCodes(report)).not.toContain('product-event-missing');
    // handler 级把它抓出来
    expect(report.ok).toBe(false);
    expect(
      report.findings.find((f) => f.code === 'product-handler-missing'),
    ).toMatchObject({ script: 'hooks/stop-fix-compliance-check.sh', event: 'Stop' });
  });

  it('owned 脚本挂到错误事件上 → product-handler-misplaced', () => {
    const doc = readCanonical();
    doc.hooks.PostToolUse.push(doc.hooks.PreToolUse[0]);
    doc.hooks.PreToolUse = [];
    const report = schema.validateCodexHooksDocument(doc, canonicalOptions);

    expect(report.ok).toBe(false);
    expect(
      report.findings.find((f) => f.code === 'product-handler-misplaced'),
    ).toMatchObject({
      script: 'hooks/pre-tool-use-guard.sh',
      event: 'PostToolUse',
      expectedEvent: 'PreToolUse',
    });
  });

  it('六条 owned 脚本逐条删除，每一条都必须被 handler 级判据抓到（无遗漏登记）', () => {
    const scripts = Object.keys(schema.OWNED_HOOK_EXPECTED_EVENT);
    expect(scripts).toHaveLength(6);
    for (const script of scripts) {
      const basename = script.split('/')[1];
      const doc = readCanonical();
      for (const event of Object.keys(doc.hooks)) {
        doc.hooks[event] = (doc.hooks[event] as unknown[]).filter(
          (group) => !JSON.stringify(group).includes(basename),
        );
      }
      const report = schema.validateCodexHooksDocument(doc, canonicalOptions);
      expect(
        report.findings.some((f) => f.code === 'product-handler-missing' && (f as { script?: string }).script === script),
        `删除 ${script} 后未被 handler 级判据抓到`,
      ).toBe(true);
    }
  });

  it('我方脚本挂到产品集之外的事件上 → 只由事件级判据报一次，不与 handler 级重复计数', () => {
    const doc = readCanonical();
    doc.hooks.SessionEnd = doc.hooks.SessionStart;
    delete doc.hooks.SessionStart;
    const report = schema.validateCodexHooksDocument(doc, canonicalOptions);

    expect(report.ok).toBe(false);
    // 事件越界由事件级报
    expect(productCodes(report)).toContain('product-event-out-of-scope');
    // 同一根因不再由 handler 级重复报一次 misplaced
    expect(
      report.findings.filter((f) => f.code === 'product-handler-misplaced'),
    ).toEqual([]);
    // 但"它从期望事件上消失了"仍必须被抓到（去重不等于漏报）
    expect(
      report.findings.find((f) => f.code === 'product-handler-missing'),
    ).toMatchObject({ script: 'scripts/postinstall.sh', event: 'SessionStart' });
  });

  it('第三方条目不参与 handler 级判据（不得因用户自己的 hook 判 fail）', () => {
    const doc = readCanonical();
    doc.hooks.PermissionRequest = [
      { matcher: '', hooks: [{ type: 'command', command: 'bash /opt/vendor/permission.sh' }] },
    ];
    const report = schema.validateCodexHooksDocument(doc, canonicalOptions);
    expect(productCodes(report)).toEqual([]);
  });

  it('ownedScriptSuffixKey 与 isOwnedEntry 取键口径一致（两处漂移会造成全盘假红）', () => {
    const owned = 'bash /x/spec-driver/hooks/stop-task-check.sh';
    expect(schema.isOwnedEntry(owned)).toBe(true);
    expect(schema.ownedScriptSuffixKey(owned)).toBe('hooks/stop-task-check.sh');
    // 非我方条目两侧同时判否
    const foreign = 'bash /opt/othertool/spec-driver/postinstall.sh';
    expect(schema.isOwnedEntry(foreign)).toBe(false);
    expect(schema.ownedScriptSuffixKey(foreign)).toBeNull();
  });
});

/**
 * F264 — `SessionEnd` 补入 schema 全集的版本相关性
 *
 * 本机 codex-cli 0.144.6 实测**不接受** `SessionEnd`（静默丢弃，与 WorktreeCreate 同待遇）；
 * 补入依 0.149.0 口径。故这里只钉死两件事：(a) 它在 schema 全集里（第三方用它不再告警）；
 * (b) 它**绝不能**进产品集（我方条目挂上去 = 一条永不执行的 hook）。
 */
describe('F264 — SessionEnd 的作用域', () => {
  it('SessionEnd 在 schema 全集内，但不在产品集内', () => {
    expect(schema.CODEX_EVENT_SCHEMA_SET).toContain('SessionEnd');
    expect(schema.CODEX_EVENT_PRODUCT_SET).not.toContain('SessionEnd');
  });

  it('第三方的 SessionEnd 条目：不再是 unknown-event-name，但必须给出版本相关告警（不得静默）', () => {
    const doc = JSON.parse(fs.readFileSync(CANONICAL_HOOKS_JSON, 'utf-8'));
    doc.hooks.SessionEnd = [
      { matcher: '', hooks: [{ type: 'command', command: 'bash /opt/vendor/on-session-end.sh' }] },
    ];
    const report = schema.validateCodexHooksDocument(doc, {
      checkCommandShape: false,
      canonicalSource: true,
    });
    expect(
      report.findings.filter((f) => f.code === 'unknown-event-name' && f.event === 'SessionEnd'),
    ).toEqual([]);
    // 🔴 不能只是"少一条 warning"：0.144.6 上这条 hook 确实永不执行，用户有权知道。
    expect(
      report.findings.find((f) => f.code === 'version-dependent-event-name'),
    ).toMatchObject({ level: 'warning', event: 'SessionEnd' });
  });

  it('版本相关事件集只含 SessionEnd，且与产品集不相交', () => {
    expect([...schema.CODEX_EVENT_VERSION_DEPENDENT]).toEqual(['SessionEnd']);
    for (const event of schema.CODEX_EVENT_VERSION_DEPENDENT) {
      expect(schema.CODEX_EVENT_SCHEMA_SET).toContain(event);
      expect(schema.CODEX_EVENT_PRODUCT_SET).not.toContain(event);
    }
  });
});
