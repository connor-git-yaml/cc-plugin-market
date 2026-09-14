/**
 * β-W2（Feature 277 Phase A 对抗修订第二轮）—— 块 2 的 per-file 参数守卫。
 *
 * 块 2（`orchestrator-gate-mounting-guard`）唯一随文件而变的量是 marker **之外**
 * 紧邻上方的一行 `SD_MODE=<mode>`。`syncSection` 的漂移比对按 `indexOf(beginMarker)` /
 * `indexOf(endMarker)` 切片，只覆盖 marker **之间**的字节——那一行结构性地不在比对
 * 范围内，全仓（`scripts/` / `plugins/spec-driver/scripts/` / `tests/`）对 `SD_MODE`
 * 此前**零命中**，没有任何守护项断言过它的取值。
 *
 * 危害面：写成另一个**合法** mode（复制粘贴最常见的错）时，运行时守卫会去查那个
 * mode。`feature` 永远 `mounted=true`，于是 story 流程带着一个恒绿的守卫跑完，
 * 三条 CLI 命令全部 `exit=0`、字段齐全、FR-068 判据 1/2/3 全过，输出面无异常可见。
 * （`$SD_MODE` 为空或拼成非法值时才由第三条命令的 `exit=1` 兜住——α-I2。）
 *
 * 判据窄到只有一条：取值 == 该 SKILL 目录名去掉 `spec-driver-` 前缀。
 * 结论并进块 2 既有的 `agent-docs:shared-section:orchestrator-gate-mounting-guard`，
 * **不新增 check id**（新增会连带改动 SC-006 分母与 K14 的精确数组）。
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSdModeDeclaration, sectionConfigs, validateSharedAgentDocs } from '../../scripts/sync-agent-docs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const KEY = 'orchestrator-gate-mounting-guard';
const MARKER = `<!-- BEGIN SHARED SECTION: ${KEY} -->`;

const guard = checkSdModeDeclaration as (
  content: string, relPath: string, key: string,
) => string | null;

/** 合成一份 SKILL：BEGIN marker 之前放一行 SD_MODE 声明 */
function skill(declaration: string | null): string {
  return [
    '# SKILL',
    '',
    '```bash',
    ...(declaration === null ? [] : [declaration]),
    '```',
    '',
    MARKER,
    '守卫正文',
    `<!-- END SHARED SECTION: ${KEY} -->`,
    '',
  ].join('\n');
}

const STORY_PATH = 'plugins/spec-driver/skills/spec-driver-story/SKILL.md';

describe('块 2 的 SD_MODE per-file 参数守卫（β-W2）', () => {
  it('取值与目录名一致 ⇒ 通过', () => {
    expect(guard(skill('SD_MODE=story'), STORY_PATH, KEY)).toBeNull();
  });

  it('写成另一个**合法** mode ⇒ 判红（这是恒绿守卫的构造，三条命令全 exit=0）', () => {
    const violation = guard(skill('SD_MODE=feature'), STORY_PATH, KEY);
    expect(violation).not.toBeNull();
    expect(violation!).toMatch(/"feature"/);
    expect(violation!).toMatch(/期望 "story"/);
  });

  it('声明行整个缺席 ⇒ 判红（判不出⇒判失败，不按「没配就算对」放行）', () => {
    const violation = guard(skill(null), STORY_PATH, KEY);
    expect(violation).not.toBeNull();
    expect(violation!).toMatch(/没有 SD_MODE/);
  });

  it('取值为空 ⇒ 判红', () => {
    expect(guard(skill('SD_MODE='), STORY_PATH, KEY)).not.toBeNull();
  });

  it('只看 BEGIN marker **之前**的声明：写在块之后的那行不算数', () => {
    const content = skill(null).replace(`<!-- END SHARED SECTION: ${KEY} -->`,
      `<!-- END SHARED SECTION: ${KEY} -->\nSD_MODE=story`);
    expect(guard(content, STORY_PATH, KEY)).not.toBeNull();
  });

  it('多次声明时以**最近**的一次为准（后写的覆盖先写的，与 shell 语义一致）', () => {
    const content = skill(null).replace('```bash\n```', '```bash\nSD_MODE=feature\nSD_MODE=story\n```');
    expect(guard(content, STORY_PATH, KEY)).toBeNull();
    const reversed = skill(null).replace('```bash\n```', '```bash\nSD_MODE=story\nSD_MODE=feature\n```');
    expect(guard(reversed, STORY_PATH, KEY)).not.toBeNull();
  });

  it('marker 缺失时不重复报（该形态由 syncSection 的 throw 承担）', () => {
    expect(guard('# 没有 marker 的文件\nSD_MODE=feature\n', STORY_PATH, KEY)).toBeNull();
  });

  it('接线证据 · 块 2 的 entry 确实挂了 preludeGuard，且只有它挂（其余 15 个 entry 无 per-file 参数）', () => {
    const configs = sectionConfigs as Array<{ key: string; preludeGuard?: unknown }>;
    expect(configs.filter((c) => typeof c.preludeGuard === 'function').map((c) => c.key)).toEqual([KEY]);
  });

  it('本仓 5 份编排器 SKILL 的 SD_MODE 逐份正确（守护项对现状不误报）', () => {
    const result = validateSharedAgentDocs(REPO_ROOT) as {
      status: string; errors: string[];
      checks: Array<{ id: string; status: string }>;
    };
    expect(result.errors.filter((e) => e.includes('SD_MODE'))).toEqual([]);
    expect(result.checks.find((c) => c.id === `shared-section:${KEY}`)!.status).toBe('pass');
  });
});
