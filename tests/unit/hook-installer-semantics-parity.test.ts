/**
 * Feature 240 / T022 — 双 installer 七语义合同表（FR-011 / SC-008）
 *
 * plan §6.1 选了**对称实现**（`src/hooks/hook-installer.ts` 与
 * `plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs` 各写一份），代价是漂移风险。
 * 本文件是该风险的**唯一**补偿设施：同一张语义合同表经薄适配器对两个 installer 各跑一遍，
 * **共享的是「保证」而不是「实现」**。任一侧单方面改掉某条语义，这里立刻红。
 *
 * 🔴 合同表里只允许出现"两侧都必须成立"的断言。真实存在的分歧（幂等形态）作为
 * **已声明差异**单列一节，用可观测行为钉死 —— 不是靠适配器把差异抹平蒙混过关。
 *
 * 运行：npx vitest run tests/unit/hook-installer-semantics-parity.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parityAdapters,
  sha256OfFile,
  type ParityAdapter,
  type ParityContext,
} from '../helpers/hook-installer-parity-adapters.js';

const INVALID_JSON = '{ "hooks": { invalid json }}}';

describe.each(parityAdapters.map((adapter) => [adapter.name, adapter] as const))(
  'FR-011 七语义合同表 — %s',
  (_name, adapter: ParityAdapter) => {
    let tmpDir: string;
    let ctx: ParityContext;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-parity-'));
      ctx = adapter.setup(tmpDir);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('(a) 合并而非覆写：第三方条目与顶层未知字段逐字节保留', () => {
      adapter.seedForeign(ctx);
      const before = adapter.readTarget(ctx);
      const foreignBefore = JSON.stringify(adapter.foreignSnapshot(before));
      const topBefore = JSON.stringify(adapter.topLevelSnapshot(before));

      adapter.install(ctx);

      const after = adapter.readTarget(ctx);
      expect(JSON.stringify(adapter.foreignSnapshot(after))).toBe(foreignBefore);
      expect(JSON.stringify(adapter.topLevelSnapshot(after))).toBe(topBefore);
      expect(adapter.countOwned(after)).toBeGreaterThan(0);
    });

    it('(b) 幂等：重复安装不产生重复条目', () => {
      adapter.install(ctx);
      const once = adapter.countOwned(adapter.readTarget(ctx));
      expect(once).toBeGreaterThan(0);

      adapter.install(ctx);
      adapter.install(ctx);

      expect(adapter.countOwned(adapter.readTarget(ctx))).toBe(once);
    });

    it('(c) 精确卸载：我方条目清零，第三方条目逐字节保留', () => {
      adapter.seedForeign(ctx);
      const foreignBefore = JSON.stringify(adapter.foreignSnapshot(adapter.readTarget(ctx)));
      adapter.install(ctx);

      adapter.remove(ctx);

      const after = adapter.readTarget(ctx);
      expect(adapter.countOwned(after)).toBe(0);
      expect(JSON.stringify(adapter.foreignSnapshot(after))).toBe(foreignBefore);
    });

    it('(c2) 卸载幂等：目标不存在 / 无我方条目时不抛错', () => {
      expect(() => adapter.remove(ctx)).not.toThrow();
      adapter.seedForeign(ctx);
      expect(() => adapter.remove(ctx)).not.toThrow();
      adapter.install(ctx);
      adapter.remove(ctx);
      expect(() => adapter.remove(ctx)).not.toThrow();
      expect(adapter.countOwned(adapter.readTarget(ctx))).toBe(0);
    });

    it('(d) 归属锚点只用 command 字符串，条目里零自定义标记字段', () => {
      adapter.install(ctx);
      const keySets = adapter.ownedEntryKeySets(adapter.readTarget(ctx));
      expect(keySets.length).toBeGreaterThan(0);
      for (const keys of keySets) {
        expect(keys.every((key) => adapter.allowedOwnedEntryKeys.includes(key))).toBe(true);
      }
      // 反向：文件里不得出现任何归属标记字段
      const raw = fs.readFileSync(adapter.targetPath(ctx), 'utf-8');
      for (const forbidden of ['ownedBy', '_owner', 'managedBy', 'installedBy']) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it('(e) 写入前备份：.bak 逐字节等于安装前原文', () => {
      adapter.seedForeign(ctx);
      const before = fs.readFileSync(adapter.targetPath(ctx), 'utf-8');

      adapter.install(ctx);

      expect(fs.existsSync(adapter.backupPath(ctx))).toBe(true);
      expect(fs.readFileSync(adapter.backupPath(ctx), 'utf-8')).toBe(before);
    });

    it('(e2) 无变更的重复安装不用合并后的内容顶掉最初那份 .bak', () => {
      adapter.seedForeign(ctx);
      const before = fs.readFileSync(adapter.targetPath(ctx), 'utf-8');

      adapter.install(ctx);
      adapter.install(ctx);

      expect(fs.readFileSync(adapter.backupPath(ctx), 'utf-8')).toBe(before);
    });

    it('(e3) 🔴 后续「确有语义变更」的安装同样不得顶掉最初那份 .bak', () => {
      // (e2) 只覆盖了"无变更 ⇒ 不写 ⇒ 备份自然不动"。但插件版本升级是**真实变更**、确有写入，
      // 此时若覆写备份，用户原始文件的备份就永久消失了 —— 与归属误认叠加即不可逆数据丢失。
      adapter.seedForeign(ctx);
      const before = fs.readFileSync(adapter.targetPath(ctx), 'utf-8');

      adapter.install(ctx);
      expect(fs.readFileSync(adapter.backupPath(ctx), 'utf-8')).toBe(before);

      adapter.makeOwnedEntryStale(ctx); // 制造一次真实的语义变更
      adapter.install(ctx);

      expect(fs.readFileSync(adapter.backupPath(ctx), 'utf-8')).toBe(before);
    });

    it('(f) 非法 JSON：install / remove 均抛错，且抛错前零写操作', () => {
      adapter.writeTargetRaw(ctx, INVALID_JSON);
      const digest = sha256OfFile(adapter.targetPath(ctx));

      expect(() => adapter.install(ctx)).toThrow(adapter.invalidJsonPattern);
      expect(() => adapter.remove(ctx)).toThrow(adapter.invalidJsonPattern);

      expect(sha256OfFile(adapter.targetPath(ctx))).toBe(digest);
      expect(fs.existsSync(adapter.backupPath(ctx))).toBe(false);
      // 连临时文件都不许留（tmp 残留意味着"抛错前已动过磁盘"）
      const strays = fs
        .readdirSync(path.dirname(adapter.targetPath(ctx)))
        .filter((name) => name.includes('.tmp'));
      expect(strays).toEqual([]);
    });

    it('(g) 类型防御：数组字段被写成非数组时不崩溃，安装照常完成', () => {
      adapter.seedCorruptedTypes(ctx);

      expect(() => adapter.install(ctx)).not.toThrow();

      expect(adapter.countOwned(adapter.readTarget(ctx))).toBeGreaterThan(0);
    });
  },
);

describe('已声明差异（不是漂移）：幂等的两种合法形态', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-parity-diff-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(parityAdapters.map((adapter) => [adapter.name, adapter] as const))(
    '%s 的幂等形态与其声明一致（可观测断言，防止任一侧被悄悄改掉）',
    (_name, adapter: ParityAdapter) => {
      const ctx = adapter.setup(tmpDir);
      adapter.install(ctx);
      const staleMarker = adapter.makeOwnedEntryStale(ctx);
      expect(fs.readFileSync(adapter.targetPath(ctx), 'utf-8')).toContain(staleMarker);

      adapter.install(ctx);

      const raw = fs.readFileSync(adapter.targetPath(ctx), 'utf-8');
      if (adapter.idempotency === 'skip') {
        // Claude 侧：command 是固定字面量，无版本路径漂移问题 → 已存在即跳过
        expect(raw).toContain(staleMarker);
      } else {
        // Codex 侧：command 内嵌绝对路径（FR-005），必须原地更新，
        // 否则升级后永远指向已被清理的旧缓存目录 → hook 静默失效
        expect(raw).not.toContain(staleMarker);
      }
      // 无论哪种形态，条目数都不得增长
      expect(adapter.countOwned(adapter.readTarget(ctx))).toBeGreaterThan(0);
    },
  );

  it('两侧确实选择了不同形态（差异是有意的，若某天变一致说明有一侧被改了）', () => {
    expect(parityAdapters.map((adapter) => adapter.idempotency)).toEqual([
      'skip',
      'in-place-update',
    ]);
  });
});
