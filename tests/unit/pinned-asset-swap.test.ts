/**
 * F249 T045：`swapPinnedAssets` 备份/回滚写盘的失败注入单测（plan R4 防守项 6 / Q5）。
 *
 * 为什么这条测试不可省：两份 pinned 资产**必须彼此一致**（再生脚本的前置一致性校验会比较
 * 二者的 `fixtureInputHash`/`fingerprint`）。"第一份写成功、第二份写失败"若不回滚，会留下一新
 * 一旧的资产对，下次运行直接被前置校验判为"疑似被手工绕过编辑"而阻塞——一次偶发 I/O 失败
 * 演变成必须人工介入的死锁。而这个失败模式在真实磁盘上几乎无法自然复现，只能靠注入。
 *
 * 注入方式选择：mock 只拦"目标是第二份资产的那次 rename"，其余全部委托真实 `node:fs`。
 * 用调用计数（"第 2 次 rename 失败"）会连带打中**回滚自身**的 rename，测出来的就不是回滚行为
 * 而是"回滚也失败"这个另一码事的场景。
 *
 * C-003 修复后本文件覆盖三段语义，缺一不可：
 * ① 提交点**之前**失败 → 回滚到调用前状态（原有四条用例）
 * ② 提交点**之后**（`.bak` 清理）失败 → **不回滚**，正式文件保持新内容 + warning
 * ③ 回滚**自身**失败 → 错误显式标注 `incomplete` 且首因不被二次异常吞掉
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  swapPinnedAssets,
  type PinnedAssetFsLike,
} from '../../scripts/regen-collector-fingerprint-fixtures.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

interface Fixture {
  dir: string;
  firstPath: string;
  secondPath: string;
  firstOriginal: string;
  secondOriginal: string;
}

function makeFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-swap-'));
  tmpDirs.push(dir);
  const firstPath = path.join(dir, 'expected-graph-only-graph.json');
  const secondPath = path.join(dir, 'expected-module-graph.json');
  const firstOriginal = '{"fixtureInputHash":"old-a","graph":{"marker":"A-ORIGINAL"}}\n';
  const secondOriginal = '{"fixtureInputHash":"old-b","moduleGraph":{"marker":"B-ORIGINAL"}}\n';
  fs.writeFileSync(firstPath, firstOriginal, 'utf-8');
  fs.writeFileSync(secondPath, secondOriginal, 'utf-8');
  return { dir, firstPath, secondPath, firstOriginal, secondOriginal };
}

function sha256File(target: string): string {
  return createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

/** 真实 fs 委托 + 「`rmSync` 目标命中 `failingTarget` 时抛错」注入（提交点之后的失败面）。 */
function makeRmFailingFs(failingTarget: string): { impl: PinnedAssetFsLike; rmTargets: string[] } {
  const rmTargets: string[] = [];
  const impl: PinnedAssetFsLike = {
    existsSync: (target) => fs.existsSync(target),
    copyFileSync: (source, destination) => fs.copyFileSync(source, destination),
    writeFileSync: (target, data, encoding) => fs.writeFileSync(target, data, encoding),
    renameSync: (from, to) => fs.renameSync(from, to),
    rmSync: (target, options) => {
      rmTargets.push(target);
      if (target === failingTarget) {
        throw new Error('EPERM: simulated .bak cleanup failure');
      }
      fs.rmSync(target, options);
    },
  };
  return { impl, rmTargets };
}

/** 真实 fs 委托 + 「rename 到 `failingTarget` 时抛错」注入。 */
function makeRenameFailingFs(failingTarget: string): { impl: PinnedAssetFsLike; renameTargets: string[] } {
  const renameTargets: string[] = [];
  const impl: PinnedAssetFsLike = {
    existsSync: (target) => fs.existsSync(target),
    copyFileSync: (source, destination) => fs.copyFileSync(source, destination),
    writeFileSync: (target, data, encoding) => fs.writeFileSync(target, data, encoding),
    renameSync: (from, to) => {
      renameTargets.push(to);
      if (to === failingTarget) {
        throw new Error('EIO: simulated rename failure');
      }
      fs.renameSync(from, to);
    },
    rmSync: (target, options) => fs.rmSync(target, options),
  };
  return { impl, renameTargets };
}

function residualArtifacts(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.includes('.tmp-') || name.endsWith('.bak'))
    .sort();
}

describe('swapPinnedAssets — 第二次 rename 失败后的逆序回滚', () => {
  it('抛错，且已完成的第一份 rename 被回滚为调用前原始字节', async () => {
    const fixture = makeFixture();
    const { impl, renameTargets } = makeRenameFailingFs(fixture.secondPath);

    await expect(
      swapPinnedAssets(
        [
          { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
          { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
        ],
        impl,
      ),
    ).rejects.toThrow(/已回滚到调用前状态/);

    // 第一份确实先被覆盖过（否则"回滚"是空操作，测不到任何东西）
    expect(renameTargets).toContain(fixture.firstPath);
    expect(fs.readFileSync(fixture.firstPath, 'utf-8')).toBe(fixture.firstOriginal);
  });

  it('(b) 两份正式资产最终字节与调用前完全一致', async () => {
    const fixture = makeFixture();
    const before = {
      first: sha256File(fixture.firstPath),
      second: sha256File(fixture.secondPath),
    };
    const { impl } = makeRenameFailingFs(fixture.secondPath);

    await expect(
      swapPinnedAssets(
        [
          { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
          { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
        ],
        impl,
      ),
    ).rejects.toThrow();

    expect(sha256File(fixture.firstPath)).toBe(before.first);
    expect(sha256File(fixture.secondPath)).toBe(before.second);
    expect(fs.readFileSync(fixture.secondPath, 'utf-8')).toBe(fixture.secondOriginal);
  });

  it('(c) 不残留 .tmp-* / .bak 文件', async () => {
    const fixture = makeFixture();
    const { impl } = makeRenameFailingFs(fixture.secondPath);

    await expect(
      swapPinnedAssets(
        [
          { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
          { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
        ],
        impl,
      ),
    ).rejects.toThrow();

    expect(residualArtifacts(fixture.dir)).toEqual([]);
    expect(fs.readdirSync(fixture.dir).sort()).toEqual([
      'expected-graph-only-graph.json',
      'expected-module-graph.json',
    ]);
  });

  it('第一份 rename 就失败时，两份均保持原状（回滚无副作用）', async () => {
    const fixture = makeFixture();
    const { impl } = makeRenameFailingFs(fixture.firstPath);

    await expect(
      swapPinnedAssets(
        [
          { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
          { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
        ],
        impl,
      ),
    ).rejects.toThrow();

    expect(fs.readFileSync(fixture.firstPath, 'utf-8')).toBe(fixture.firstOriginal);
    expect(fs.readFileSync(fixture.secondPath, 'utf-8')).toBe(fixture.secondOriginal);
    expect(residualArtifacts(fixture.dir)).toEqual([]);
  });
});

describe('swapPinnedAssets — 提交点之后的失败（C-003：绝不回滚已写好的正式文件）', () => {
  it('.bak 清理失败 → 不抛错、两份正式文件保持新内容、以 warning 报告残留', async () => {
    const fixture = makeFixture();
    const { impl } = makeRmFailingFs(`${fixture.secondPath}.bak`);

    const outcome = await swapPinnedAssets(
      [
        { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
        { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
      ],
      impl,
    );

    // 提交点已过：新内容才是正确状态，为了删不掉一个 .bak 而回退资产内容是主次颠倒
    expect(fs.readFileSync(fixture.firstPath, 'utf-8')).toBe('{"marker":"A-NEW"}\n');
    expect(fs.readFileSync(fixture.secondPath, 'utf-8')).toBe('{"marker":"B-NEW"}\n');
    // 残留 .bak 必须被明确告知（既不静默、也不升级为失败）
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('备份文件清理失败');
    expect(outcome.warnings[0]).toContain(`${fixture.secondPath}.bak`);
    // 该 .bak 确实残留在盘上，且能被手工删除（不影响下次运行：前置校验只读两份正式资产）
    expect(fs.existsSync(`${fixture.secondPath}.bak`)).toBe(true);
    expect(fs.existsSync(`${fixture.firstPath}.bak`)).toBe(false);
  });

  it('第一份 .bak 清理失败不阻断第二份清理（逐项独立 try/catch，不半途而废）', async () => {
    const fixture = makeFixture();
    const { impl } = makeRmFailingFs(`${fixture.firstPath}.bak`);

    const outcome = await swapPinnedAssets(
      [
        { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
        { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
      ],
      impl,
    );

    expect(outcome.warnings).toHaveLength(1);
    expect(fs.existsSync(`${fixture.firstPath}.bak`)).toBe(true);
    expect(fs.existsSync(`${fixture.secondPath}.bak`)).toBe(false); // 后一份仍被清理
  });
});

describe('swapPinnedAssets — 提交点之前回滚自身失败（incomplete 如实报告）', () => {
  it('回滚 rename 失败 → 错误信息标注 incomplete 并列出失败项，不谎称"已回滚"', async () => {
    const fixture = makeFixture();
    // 注入：覆盖第二份时 rename 失败（触发回滚），且回滚第一份的 rename 也失败
    const impl: PinnedAssetFsLike = {
      existsSync: (target) => fs.existsSync(target),
      copyFileSync: (source, destination) => fs.copyFileSync(source, destination),
      writeFileSync: (target, data, encoding) => fs.writeFileSync(target, data, encoding),
      renameSync: (from, to) => {
        if (to === fixture.secondPath) throw new Error('EIO: simulated rename failure');
        // 回滚形态：从 `<first>.bak` 还原回 `<first>`
        if (from === `${fixture.firstPath}.bak`) throw new Error('EIO: simulated rollback failure');
        fs.renameSync(from, to);
      },
      rmSync: (target, options) => fs.rmSync(target, options),
    };

    await expect(
      swapPinnedAssets(
        [
          { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
          { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
        ],
        impl,
      ),
    ).rejects.toThrow(/incomplete/);

    // 首因与回滚失败项都必须出现在同一条错误里（不被二次异常吞掉）
    await expect(
      swapPinnedAssets(
        [
          { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
          { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
        ],
        impl,
      ),
    ).rejects.toThrow(/simulated rename failure[\s\S]*simulated rollback failure/);
  });

  it('备份缺失（.bak 被外部删除）导致回滚失败 → 同样 incomplete，且第二份仍为原内容', async () => {
    const fixture = makeFixture();
    const impl: PinnedAssetFsLike = {
      existsSync: (target) => fs.existsSync(target),
      copyFileSync: (source, destination) => fs.copyFileSync(source, destination),
      writeFileSync: (target, data, encoding) => fs.writeFileSync(target, data, encoding),
      renameSync: (from, to) => {
        if (to === fixture.secondPath) {
          // 触发失败前先把第一份的备份删掉，模拟"备份在回滚前已消失"
          fs.rmSync(`${fixture.firstPath}.bak`, { force: true });
          throw new Error('EIO: simulated rename failure');
        }
        fs.renameSync(from, to);
      },
      rmSync: (target, options) => fs.rmSync(target, options),
    };

    await expect(
      swapPinnedAssets(
        [
          { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
          { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
        ],
        impl,
      ),
    ).rejects.toThrow(/incomplete/);

    // 第一份还原不了（备份没了）→ 保持新内容；第二份从未被覆盖 → 仍是原内容。
    // 关键是这个"混合状态"被显式报告出来，而不是被一句"已回滚"掩盖。
    expect(fs.readFileSync(fixture.firstPath, 'utf-8')).toBe('{"marker":"A-NEW"}\n');
    expect(fs.readFileSync(fixture.secondPath, 'utf-8')).toBe(fixture.secondOriginal);
  });
});

describe('swapPinnedAssets — 成功路径（活性证明，排除"永远抛错"式退化）', () => {
  it('两份均写入新内容，且清理掉全部 .bak/.tmp-* 中间文件', async () => {
    const fixture = makeFixture();

    const outcome = await swapPinnedAssets([
      { path: fixture.firstPath, content: '{"marker":"A-NEW"}\n' },
      { path: fixture.secondPath, content: '{"marker":"B-NEW"}\n' },
    ]);

    expect(fs.readFileSync(fixture.firstPath, 'utf-8')).toBe('{"marker":"A-NEW"}\n');
    expect(fs.readFileSync(fixture.secondPath, 'utf-8')).toBe('{"marker":"B-NEW"}\n');
    expect(residualArtifacts(fixture.dir)).toEqual([]);
    expect(outcome.warnings).toEqual([]);
  });

  it('冷启动（目标文件原本不存在）也能写入，且失败时把新建文件删回不存在态', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-swap-init-'));
    tmpDirs.push(dir);
    const firstPath = path.join(dir, 'a.json');
    const secondPath = path.join(dir, 'b.json');

    // 冷启动成功路径
    await swapPinnedAssets([
      { path: firstPath, content: 'A\n' },
      { path: secondPath, content: 'B\n' },
    ]);
    expect(fs.readFileSync(firstPath, 'utf-8')).toBe('A\n');
    expect(fs.readFileSync(secondPath, 'utf-8')).toBe('B\n');

    // 再造一次"目标原本不存在 + 第二份 rename 失败"：第一份必须被删回不存在态，
    // 而不是留下一份没有对应 pinned 伙伴的孤儿资产
    fs.rmSync(firstPath);
    fs.rmSync(secondPath);
    const { impl } = makeRenameFailingFs(secondPath);
    await expect(
      swapPinnedAssets(
        [
          { path: firstPath, content: 'A2\n' },
          { path: secondPath, content: 'B2\n' },
        ],
        impl,
      ),
    ).rejects.toThrow();

    expect(fs.existsSync(firstPath)).toBe(false);
    expect(fs.existsSync(secondPath)).toBe(false);
    expect(residualArtifacts(dir)).toEqual([]);
  });
});
