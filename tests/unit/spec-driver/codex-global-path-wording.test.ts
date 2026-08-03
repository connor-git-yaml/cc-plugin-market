/**
 * Feature 240 / Codex 对抗审查 W3：全局 Codex 路径文案的**反向守卫**。
 *
 * W3 原始缺陷：`extract-wrapper-body.mjs:82` 的文案已按 FR-007(2) 加上
 * 「默认路径，实际以 CODEX_HOME 为准」限定，但**相邻的 canonical adapter 文案没改**，
 * 于是 9 个 wrapper 里同一个文件出现自相矛盾的两句话：
 *   - 第 25 行（adapter）：`~/.codex/spec-driver-capability.md` —— 无限定，自定义 CODEX_HOME 下误导
 *   - 第 35 行（正文替换）：同一路径 —— 带限定，正确
 * 单点修复挡不住这类"同源多写"的漂移，故改为**机械扫描**：产品面上每一次出现都必须带限定。
 *
 * 🔴 本测试是反向守卫（找违规），不是正向断言（数个数）：
 * 新增文件、新增 wrapper、新增文案都会自动纳入扫描面，无需同步维护清单。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * 需要扫描的产品面（用户实际会读到的文本）。
 * 不含 `specs/`：设计文档在讨论"改前 / 改后"文案本身，天然会出现未限定字面量。
 */
const PRODUCT_DIRS = ['.codex/skills', 'plugins/spec-driver/skills-codex'];
const PRODUCT_FILES = [
  'src/cli/index.ts', // init --global 帮助文本
  'src/scripts/postinstall.ts', // 全局安装说明
  'src/scripts/preuninstall.ts', // 全局卸载说明
  'plugins/spec-driver/scripts/codex-skills.sh', // usage + adapter canonical 文案
  'plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs', // wrapper 正文替换文案
];

/** 「以家目录为基的全局 Codex 路径」字面量——出现即须带 CODEX_HOME 限定 */
const GLOBAL_PATH_PATTERNS = [/~\/\.codex\/skills/, /~\/\.codex\/spec-driver-capability\.md/];

/** 限定说明的判定：同一处文案附近必须提到 CODEX_HOME */
const QUALIFIER = /CODEX_HOME/;

/**
 * 取"文案窗口"而非单行：`codex-skills.sh` 的 usage 是**折行**排版的
 * （`--global 目标目录改为 ~/.codex/skills` 与其后的限定说明分处两行），
 * 只看单行会把合规文案误判成违规。窗口取命中行的前后各一行。
 */
function windowAround(lines: string[], index: number): string {
  return lines.slice(Math.max(0, index - 1), index + 2).join('\n');
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const relDir of PRODUCT_DIRS) {
    const absDir = join(REPO_ROOT, relDir);
    if (!existsSync(absDir)) continue;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(absDir, entry.name, 'SKILL.md');
      if (existsSync(skillFile)) files.push(skillFile);
    }
  }
  for (const relFile of PRODUCT_FILES) {
    const absFile = join(REPO_ROOT, relFile);
    if (existsSync(absFile)) files.push(absFile);
  }
  return files;
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

describe('🔴 W3 — 全局 Codex 路径文案必须带 CODEX_HOME 限定（反向守卫）', () => {
  const files = collectFiles();

  it('扫描面非空（防止 glob 写错导致测试空转、永远绿）', () => {
    expect(files.length).toBeGreaterThanOrEqual(PRODUCT_FILES.length + 9);
  });

  it('产品面每一处全局 Codex 路径都带限定说明，零违规', () => {
    const violations: Violation[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, index) => {
        if (!GLOBAL_PATH_PATTERNS.some((p) => p.test(line))) return;
        if (QUALIFIER.test(windowAround(lines, index))) return;
        violations.push({
          file: file.replace(`${REPO_ROOT}/`, ''),
          line: index + 1,
          text: line.trim(),
        });
      });
    }

    expect(
      violations,
      `以下文案提到全局 Codex 路径却未说明"实际以 CODEX_HOME 为准"，` +
        `在自定义 CODEX_HOME 的机器上会误导用户去看错目录：\n` +
        violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join('\n'),
    ).toEqual([]);
  });

  it('🔴 守卫自身有效性：故意构造的未限定文案必须被判为违规', () => {
    // 防止 PATTERN / QUALIFIER 写歪导致上一条断言恒真（空转的门禁比没有门禁更糟）
    const bad = ['- 记录位于 `~/.codex/spec-driver-capability.md`', '- 安装到 ~/.codex/skills/'];
    for (const line of bad) {
      expect(GLOBAL_PATH_PATTERNS.some((p) => p.test(line))).toBe(true);
      expect(QUALIFIER.test(windowAround([line], 0))).toBe(false);
    }

    // 反向：带限定的文案不得被误判
    const good = '- 记录位于 `~/.codex/spec-driver-capability.md`（默认路径，实际以 `CODEX_HOME` 为准）';
    expect(GLOBAL_PATH_PATTERNS.some((p) => p.test(good))).toBe(true);
    expect(QUALIFIER.test(windowAround([good], 0))).toBe(true);
  });

  it('9 个 wrapper 的 adapter 文案与正文替换文案彼此不矛盾（同文件内不得一处带限定一处不带）', () => {
    const wrapperDirs = PRODUCT_DIRS.map((d) => join(REPO_ROOT, d)).filter((d) => existsSync(d));
    expect(wrapperDirs.length).toBe(2);

    for (const dir of wrapperDirs) {
      const skills = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
      expect(skills.length).toBe(9);

      for (const skill of skills) {
        const content = readFileSync(join(dir, skill.name, 'SKILL.md'), 'utf-8');
        const lines = content.split('\n');
        const hits = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => /~\/\.codex\/spec-driver-capability\.md/.test(line));

        // adapter 行恒存在；正文替换行只在引用过 Task tool 的 skill 里出现
        expect(hits.length, `${dir}/${skill.name} 未找到 capability 指针文案`).toBeGreaterThanOrEqual(1);
        for (const hit of hits) {
          expect(
            QUALIFIER.test(windowAround(lines, hit.index)),
            `${dir}/${skill.name}:${hit.index + 1} 缺 CODEX_HOME 限定 —— 与同文件其他处自相矛盾`,
          ).toBe(true);
        }
      }
    }
  });
});
