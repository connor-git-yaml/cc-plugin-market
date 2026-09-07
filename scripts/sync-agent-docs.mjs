import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * 块 2 的 per-file 参数守卫（F277 Phase A 对抗审查 β-W2）。
 *
 * 该块唯一随文件而变的量是 marker **之外**紧邻上方的一行 `SD_MODE=<mode>`，
 * 而漂移比对只覆盖 marker **之间**的字节（`syncSection` 按 `indexOf` 切片），
 * 于是这一行结构性地落在所有守护之外。把 `spec-driver-story/SKILL.md` 的那行写成
 * `SD_MODE=feature`（复制粘贴最常见的一种错）后，守卫会去查 `feature`——而 `feature`
 * 永远 `mounted=true`——于是 story 流程带着一个**恒绿**的守卫跑完，输出面上毫无异常。
 * `$SD_MODE` 为空或拼成非法值时靠第三条命令 `exit=1` 兜住（α-I2），
 * **拼成另一个合法 mode 时三条命令全部 exit=0**，那条兜底不成立。
 *
 * 判据窄到只有一条：取值必须等于该 SKILL 目录名去掉 `spec-driver-` 前缀。
 *
 * **覆盖面的诚实口径**（第三轮对抗审查 N-2 更正）：本守卫只覆盖 `targets` 里这 **5 份
 * `skills/` 源**；`skills-codex/` 5 份与 `.codex/skills/` 5 份两批副本的 `SD_MODE` 行
 * **当前无守护**。`spec-driver-wrappers` 族比对的是「**源** SKILL 的 body sha256」与
 * 「wrapper 文本里内嵌的那个 sha 字符串」——它回答「源改了而 wrapper 没重生成吗」，
 * **不**回答「wrapper 自身的字节被人改过吗」；改副本正文而不动那行内嵌 sha，比对恒过
 * （实测：把 `skills-codex/spec-driver-story/SKILL.md` 与 `.codex/skills/spec-driver-story/SKILL.md`
 * 的 `SD_MODE=story` 改成 `feature`，`validateWrapperSources` 仍 `status = pass`）。
 * `codex-plugin-consistency` 族只比对 id 集合 / 数量 / manifest 引用，也不比对副本内容。
 * 后果：`.codex/skills/` 正是 Codex 侧实际加载的那一份，它的 `SD_MODE` 被写成另一个
 * 合法 mode 时，守卫会去查错 mode 并恒绿。扩 `targets` 到 15 份会与 wrapper 生成链
 * 形成双写方，需单独一卡处置，本轮**只把口径改诚实**，不假称已覆盖。
 *
 * @param {string} targetContent 目标文件全文
 * @param {string} targetRelPath 相对项目根的路径（用于派生期望值）
 * @param {string} key section key
 * @returns {string|null} 违规说明；null 表示通过
 */
export function checkSdModeDeclaration(targetContent, targetRelPath, key) {
  const beginMarker = `<!-- BEGIN SHARED SECTION: ${key} -->`;
  const markerAt = targetContent.indexOf(beginMarker);
  // marker 缺失由 syncSection 抛错处理，此处不重复报
  if (markerAt === -1) return null;

  const expected = basename(dirname(targetRelPath)).replace(/^spec-driver-/, '');
  const prelude = targetContent.slice(0, markerAt);
  const matches = [...prelude.matchAll(/^SD_MODE=(\S*)\s*$/gm)];
  if (matches.length === 0) {
    return `${targetRelPath}：块 "${key}" 的 BEGIN marker 之前没有 SD_MODE=<mode> 声明行`
      + `（该块的唯一 per-file 参数缺席 ⇒ 守卫会对空 mode 求值）`;
  }
  const actual = matches[matches.length - 1][1];
  if (actual !== expected) {
    return `${targetRelPath}：SD_MODE 声明为 "${actual}"，期望 "${expected}"`
      + `（写成另一个合法 mode 会让运行时守卫查错 mode 并恒绿，三条命令全部 exit=0，无异常可见）`;
  }
  return null;
}

export const sectionConfigs = [
  {
    key: 'branch-sync-policy',
    sourcePath: resolve(rootDir, 'docs/shared/agent-branch-sync-policy.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'mainline-focus',
    sourcePath: resolve(rootDir, 'docs/shared/agent-mainline-focus.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'context-layering',
    sourcePath: resolve(rootDir, 'docs/shared/agent-context-layering.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'release-contract',
    sourcePath: resolve(rootDir, 'docs/shared/agent-release-contract.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'repo-maintenance',
    sourcePath: resolve(rootDir, 'docs/shared/agent-repo-maintenance.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'behavior-rules',
    sourcePath: resolve(rootDir, 'docs/shared/agent-behavior-rules.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'code-quality',
    sourcePath: resolve(rootDir, 'docs/shared/agent-code-quality.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'orchestration-overrides',
    sourcePath: resolve(rootDir, 'docs/shared/agent-orchestration-overrides.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'eval-credentials-policy',
    sourcePath: resolve(rootDir, 'docs/shared/agent-eval-credentials-policy.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'dogfooding-policy',
    sourcePath: resolve(rootDir, 'docs/shared/agent-dogfooding-policy.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  // F277 · FR-068（块 2）：门禁挂载运行时守卫。
  //
  // 与上方 10 个 entry 的两处差异，都是有意为之：
  //   1. `sourcePath` 放 `plugins/spec-driver/templates/` 而非 `docs/shared/`——该块是
  //      spec-driver 插件内部的编排约束，只发给插件自己的 SKILL；放 `docs/shared/` 会让它
  //      混进「仓库级 agent 约定」那一层，并使仓根字节预算（worktree-local-state 族）
  //      的净增量不再为 0。
  //   2. `targets` 是 5 份编排器 SKILL 而非仓根两文件——这也是本引擎首次把注入面伸出
  //      `AGENTS.md` / `CLAUDE.md`。marker 缺失时 `syncSection` 会 `throw`，该 throw 由
  //      `repo-maintenance-core.mjs` 的 `validateSharedAgentDocsSafely` 收敛为本族 fail
  //      （fail-loud，不是放行），故新增 target 不会让整份 `repo:check` 报告丢失。
  //
  // ⚠️ 排序契约（K14）：本数组的**追加顺序**决定 `agent-docs:shared-section:*` 这批
  // check id 在 `repo:check` 输出中的先后，而 `tests/integration/spec-drift-repo-check-regression.test.ts`
  // 的 `expect(added).toEqual([...])` 按该顺序逐位比对。后续 Phase 的新 entry 一律
  // **append 到数组末尾**，不得插到已落地 entry 之前——插队会让该断言以「顺序不符」
  // 形式红，而那是排版问题不是接线问题，会污染信号。
  {
    key: 'orchestrator-gate-mounting-guard',
    sourcePath: resolve(rootDir, 'plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md'),
    // per-file 参数守卫（β-W2）：结论并进本 entry 既有的 check id，不新增 check id
    preludeGuard: checkSdModeDeclaration,
    targets: [
      'plugins/spec-driver/skills/spec-driver-feature/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-story/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-implement/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-fix/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-resume/SKILL.md',
    ],
  },
  // F277 · FR-014 / FR-036（块 1）：长文档产出的分节写作协议。
  //
  // `targets` 是 4 份**产出型**子代理，`agents/verify.md` **刻意不在其中**——协议对它
  // 不适用，该「不适用」由块 1 正文自己声明（并附 verify 独立性的诚实口径），
  // 而不是靠给它也注一份 marker 来表达。`agent-tools-core.mjs` 的第 8 条文本断言
  // 以本块为事实源逐字比对那段声明，故本 entry 的 `sourcePath` 与该文件的
  // `PROTOCOL_TEXT_SOURCE` 常量必须指向同一路径。
  {
    key: 'agent-output-discipline',
    sourcePath: resolve(rootDir, 'plugins/spec-driver/templates/agent-output-discipline.md'),
    targets: [
      'plugins/spec-driver/agents/implement.md',
      'plugins/spec-driver/agents/specify.md',
      'plugins/spec-driver/agents/plan.md',
      'plugins/spec-driver/agents/tasks.md',
    ],
  },
  // F277 · FR-005 / FR-060（块 3）：`GATE_TASKS` 的 MUST 裁剪接受口径。
  //
  // `targets` 是**实际挂载** `GATE_TASKS` 的 7 个 mode 的 SKILL（换算式 7 ÷ 8 = 87.5%，
  // 单位：mode）——`spec-driver-fix` **不在其中**，因为 `fix` 段只挂 `GATE_DESIGN` 与
  // `GATE_VERIFY`，`GATE_TASKS` 命中数为 0。按 `applicable_modes`（含 8 个 mode）取
  // targets 会多注一份永不被求值的散文：配置健康 ≠ 执行在场。`fix` 下发生 MUST 裁剪
  // 时的处置（一律记「未接受」、改走带编号移交卡）写在块 3 正文里，不靠注入表达。
  {
    key: 'gate-tasks-scope-cut-acceptance',
    sourcePath: resolve(rootDir, 'plugins/spec-driver/templates/gate-tasks-scope-cut-acceptance.md'),
    targets: [
      'plugins/spec-driver/skills/spec-driver-feature/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-story/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-implement/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-resume/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-sync/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-doc/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-refactor/SKILL.md',
    ],
  },
  // F277 · FR-020 ~ FR-023 / FR-036（块 4）：`GATE_DESIGN` 的对抗收敛循环判据。
  //
  // 走单一事实源而非「4 份 SKILL 各手写一遍」（裁定 D-③）：4 份同样的分类判据 +
  // 收敛判据 + 止损条款就是 4 份手写副本，与 FR-036「跨 SKILL 共享内容走 templates/
  // 单一事实源」正面冲突，且散文一旦漂移无任何守护——本表之外的段落不受漂移比对覆盖。
  //
  // `targets` 是**实际挂载** `GATE_DESIGN` 且 SKILL 内有对应段落的 4 份：
  //   - `resume` 不入——其 phase 序列实测只挂 `GATE_TASKS` / `GATE_VERIFY`；
  //   - `refactor` 不入——`GATE_DESIGN.applicable_modes` 实测不含它；
  //   - `sync` / `doc` 不入——二者在 `applicable_modes` 内，但 SKILL 全文无 `GATE_DESIGN`
  //     段亦无任何引用（实测 `grep -n GATE_DESIGN` 两条命令均零输出、exit=1），注 marker
  //     会造出一段没有宿主上下文的悬空散文。**「不适用」不等于「已覆盖」**：这两个 mode
  //     的条件格由编排器在门内按本块的分类判据执行，散文缺席按残余登记，不得口径为已覆盖。
  //
  // ⚠️ 本 entry 按上方排序契约（K14）append 到数组末尾，不得插到已落地 entry 之前。
  {
    key: 'gate-design-convergence-loop',
    sourcePath: resolve(rootDir, 'plugins/spec-driver/templates/gate-design-convergence-loop.md'),
    targets: [
      'plugins/spec-driver/skills/spec-driver-feature/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-story/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-implement/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-fix/SKILL.md',
    ],
  },
  // F277 · FR-005（块 5）：`GATE_VERIFY` 的矩阵冻结值重算（Phase B/D 对抗修订 ε-C1 / γ-C1）。
  //
  // 冻结值链的唯一外部锚是「编排器在 GATE_VERIFY 亲自重算」——但那句话此前只写在
  // `agents/verify.md` 的旁注和块 3 的 `## 冻结值字段格式` 小节里，**编排器一侧两端都没接线**：
  // 各 SKILL 的 verify 委派清单不注入冻结值，`#### 质量门（GATE_VERIFY）` 的三步里没有重算，
  // 日志行模板也没有字段位。没有字段位的要求等于没有要求——日志行模板是编排器唯一会照抄的
  // 东西，而 verify 自读自算自报的三值一致在产物上与「一步没做」完全同形。
  //
  // `targets` 是**全部 8 份**编排器 SKILL：`GATE_VERIFY` 在 8 个 mode 上全部挂载
  // （与块 3 的 `GATE_TASKS` 7 ÷ 8 不同，`fix` 也挂 `GATE_VERIFY`），故射程无例外。
  // `resume` / `sync` / `doc` 无独立的 `#### 质量门（GATE_VERIFY）` 段，marker 挂在块 3
  // 的 END 之后（块 3 末句正是「判定权在编排器于 GATE_VERIFY 的亲自重算」，宿主上下文连续）。
  //
  // **不挂 `preludeGuard`、不加 `SD_MODE` 行**：本块无任何 per-file 参数（重算命令与日志行
  // 对全部 mode 同文，mode 差异由块内的 `absent` 三种来源在散文层处理）。块 2 的守卫存在的
  // 理由是它内嵌 `$SD_MODE` 求值，本块没有该变量；给没有参数的块加 per-file 参数守卫，只会
  // 要求 `sync` / `doc` / `refactor` 三份 SKILL 补一行无消费方的 `SD_MODE`，否则守卫必红。
  //
  // ⚠️ 本 entry 按上方排序契约（K14）append 到数组末尾，不得插到已落地 entry 之前。
  {
    key: 'gate-verify-matrix-recompute',
    sourcePath: resolve(rootDir, 'plugins/spec-driver/templates/gate-verify-matrix-recompute.md'),
    targets: [
      'plugins/spec-driver/skills/spec-driver-feature/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-story/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-implement/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-fix/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-resume/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-sync/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-doc/SKILL.md',
      'plugins/spec-driver/skills/spec-driver-refactor/SKILL.md',
    ],
  },
];

export function syncSection(targetContent, key, sourceContent) {
  const beginMarker = `<!-- BEGIN SHARED SECTION: ${key} -->`;
  const endMarker = `<!-- END SHARED SECTION: ${key} -->`;
  const start = targetContent.indexOf(beginMarker);
  const end = targetContent.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Missing sync markers for section "${key}"`);
  }

  const before = targetContent.slice(0, start + beginMarker.length);
  const after = targetContent.slice(end);
  return `${before}\n${sourceContent.trim()}\n${after}`;
}

export function syncSharedAgentDocs(projectRoot = rootDir) {
  const resolvedRoot = resolve(projectRoot);
  const touchedPaths = [];

  for (const section of sectionConfigs) {
    const sourceContent = readFileSync(section.sourcePath, 'utf8').trim();

    for (const targetPath of section.targets.map((target) => resolve(resolvedRoot, target))) {
      const targetContent = readFileSync(targetPath, 'utf8');
      const nextContent = syncSection(targetContent, section.key, sourceContent);

      if (nextContent !== targetContent) {
        writeFileSync(targetPath, nextContent, 'utf8');
        touchedPaths.push(targetPath);
      }
    }
  }

  return {
    projectRoot: resolvedRoot,
    touchedPaths: touchedPaths.map((targetPath) => targetPath.slice(resolvedRoot.length + 1)),
  };
}

export function validateSharedAgentDocs(projectRoot = rootDir) {
  const resolvedRoot = resolve(projectRoot);
  const errors = [];
  const checks = [];

  for (const section of sectionConfigs) {
    const sourceContent = readFileSync(section.sourcePath, 'utf8').trim();
    const targetResults = [];

    for (const targetPath of section.targets.map((target) => resolve(resolvedRoot, target))) {
      const targetContent = readFileSync(targetPath, 'utf8');
      const relPath = targetPath.slice(resolvedRoot.length + 1);
      const syncedContent = syncSection(targetContent, section.key, sourceContent);
      const inSync = syncedContent === targetContent;
      // marker 之外的 per-file 参数：漂移比对结构性看不到它，故单列一条窄判据
      const preludeViolation = section.preludeGuard
        ? section.preludeGuard(targetContent, relPath, section.key)
        : null;

      targetResults.push({
        path: relPath,
        status: inSync && preludeViolation === null ? 'pass' : 'fail',
      });

      if (!inSync) {
        errors.push(`${section.key} 在 ${relPath} 中存在漂移，请先运行 npm run docs:sync:agents`);
      }
      if (preludeViolation !== null) {
        errors.push(`${section.key} 的 per-file 参数校验失败 —— ${preludeViolation}`);
      }
    }

    checks.push({
      id: `shared-section:${section.key}`,
      title: `Shared agent section: ${section.key}`,
      status: targetResults.every((item) => item.status === 'pass') ? 'pass' : 'fail',
      evidence: {
        sourcePath: section.sourcePath.slice(rootDir.length + 1),
        targets: targetResults,
      },
    });
  }

  return {
    status: errors.length > 0 ? 'fail' : 'pass',
    checks,
    errors,
  };
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  const result = syncSharedAgentDocs(rootDir);
  console.log(`Synced shared guidance sections into AGENTS.md and CLAUDE.md (${result.touchedPaths.length} updated)`);
}
