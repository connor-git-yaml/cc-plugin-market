---
feature: 238-codex-wrapper-completeness
title: Spec Driver Codex Wrapper 完整性 — 任务分解
status: draft
created: 2026-08-02
spec: spec.md
plan: plan.md
---

# Tasks: Spec Driver Codex Wrapper 完整性

任务 ID 规则：`T<slice>.<seq>`，`<slice>` 对应 plan §7 的 5 个里程碑片（1~5），`6` 为收尾组。每条任务标注对应 plan §4 的 T 编号（如 `plan T1.1`）便于交叉核对，两套编号体系不同源，请勿混用。

---

## Slice 1 — Workstream 1：Wrapper 完整性 + 测试基础设施解耦（US-1 / FR-101~106）

> **不可与 Slice 3 并行**：二者都会触发 `codex-skills.sh` 改动与 wrapper 重生产物链（plan C6），必须串行执行，Slice 3 在 Slice 1 完全合并后再开始。
> Slice 1 内部可与 Slice 2（纯函数 helper，零接线）并行开发。

- [x] T1.1 [characterization/重构] `tests/unit/codex-plugin-consistency-core.test.ts` 新增共享 helper `synthesizeGap(fixtureRoot, skillId, waiverEntries)`：(a) 字符串手术从拷贝的 `wrapper-source-of-truth.yaml` 删除某一条 entry（如 `spec-driver-doc`）制造合成缺口；(b) **`rmSync` 摘除 fixture 内对应 `skills-codex/<id>` 目录**，防止目录仍在但 entry 缺失的状态不一致污染 `skill-count`/`skills-reference` 检查；(c) 按参数写入合成 waiver。用该 helper 重构五类用例：删除 waiver→`canonical-vs-codex-gap` fail 且指名合成 gap id / waiver 覆盖→pass 且 `evidence.waived` 含 `{skillId, waiverId}` / 陈旧 waiver（覆盖另一 id）→warning / 重复 waiver id→warning / `waivers[0].missingSkillIds` YAML shape 断言改为对合成 waiver 做数组 shape 校验（不再断言字面量 `'spec-driver-refactor'`）。`buildHappyFixture()` 的 `SPEC_DRIVER_CODEX_IDS` 追加至 9 项，`SPEC_DRIVER_CANONICAL_IDS` 去掉"+1"构造直接等于前者。（**标签修正（Tasks 审查轮"其他"）**：本任务验收要求全绿，不是驱动后续实现的红测试，标签由"[红-先行重构]"改为"[characterization/重构]"，避免与真正的红测试任务混淆）
  涉及文件：`tests/unit/codex-plugin-consistency-core.test.ts`
  验收命令：`npx vitest run tests/unit/codex-plugin-consistency-core.test.ts`（重构后应仍全绿，因为此时还未删除真实 waiver）
  关联：FR-103/104，plan T1.2/T1.3，Review C4
  [P，可与 T1.2/Slice 2 并行]

- [x] T1.2 [红-先行重构] `tests/integration/release-contract-sync.test.ts` 第 310-340 行"陈旧 waiver → warning-only exit 0"用例改用 `synthesizeGap` 等价版本（拷贝的是整棵 `plugins/spec-driver/skills-codex/` 真实目录，`rmSync` 摘除对应目录已内建在 helper 步骤中），不再依赖字符串 `original.replace('      - "spec-driver-refactor"', ...)`
  涉及文件：`tests/integration/release-contract-sync.test.ts`
  验收命令：`npx vitest run tests/integration/release-contract-sync.test.ts`
  关联：FR-103，plan T1.4，Review C4
  [P，可与 T1.1/Slice 2 并行]

- [x] T1.3 [红] `tests/integration/spec-driver-codex-skills.test.ts`：`SPEC_DRIVER_SKILLS` 数组追加 `'spec-driver-refactor'`（9 项），`.toHaveLength(8)` → `.toHaveLength(9)`；新增断言：生成的 `spec-driver-refactor` wrapper 正文含 `$spec-driver-refactor`，且**不含**字面量 `/spec-driver:spec-driver-refactor`；**（Tasks 审查轮 W11 新增）** 新增断言：`install` → `remove` 后 `.codex/skills/spec-driver-refactor/` 目录消失（补齐 remove 路径覆盖，此前仅覆盖其余 8 个 wrapper 的 remove 断言）；新增断言：该 wrapper 的 frontmatter 字段与 SHA-256 校验行为与其余 8 个 wrapper 一致（复用既有 wrapper frontmatter/SHA 校验 helper，不写平行断言逻辑）
  涉及文件：`tests/integration/spec-driver-codex-skills.test.ts`
  验收命令：`npx vitest run tests/integration/spec-driver-codex-skills.test.ts`（预期此时失败——SKILLS 数组尚未新增该项）
  关联：FR-105，plan T1.1（红列），Tasks 审查轮 W11

- [x] T1.4 [绿实现] `plugins/spec-driver/scripts/codex-skills.sh`：`SKILLS` 数组末尾追加 `"spec-driver-refactor"`；`install_all()` 追加一行显式 `write_wrapper "spec-driver-refactor" "spec-driver-refactor"`（`install_all()` 是逐行显式调用非遍历数组）；**`remove_all()` 不额外改动**（它遍历 `SKILLS` 数组做 `rm -rf`，追加后自动覆盖新 skill 移除，加调用反而会在 remove 路径意外生成 wrapper）
  涉及文件：`plugins/spec-driver/scripts/codex-skills.sh`
  依赖：T1.3（先红后绿）
  关联：FR-101，plan T1.1（实现列），plan §3.1 Review W1

- [x] T1.5 [绿实现] `plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs`：`rewriteCodexRuntimeText()` 的 per-skill slash 替换表（当前 7 条 `/spec-driver:spec-driver-{feature,implement,story,fix,resume,sync,doc}`）补第 8 条 `/spec-driver:spec-driver-refactor` → `$spec-driver-refactor`
  涉及文件：`plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs`
  依赖：T1.3（先红后绿），与 T1.4 一起使 T1.3 转绿
  验收命令：`npm run codex:spec-driver:install && npx vitest run tests/integration/spec-driver-codex-skills.test.ts`
  关联：FR-101/205（第8条槽位新增，非 FR-205 文案改写本身——文案改写在 Slice 3），plan §3.1 Review W1

- [x] T1.6 `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`：`codexWrappers.entries` 追加第 9 条，`id: spec-driver-refactor`，`source`/`target` 路径遵循既有命名规约
  涉及文件：`plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`
  关联：FR-102
  [P，可与 T1.3/1.4/1.5 并行——不同文件、无代码依赖]

- [x] T1.7 `contracts/codex-plugin-consistency.yaml`：删除 `waivers` 数组中 `spec-driver-refactor-codex-wrapper-gap` 整条；新增/确认断言 `waivers` 为空数组或字段不存在
  涉及文件：`contracts/codex-plugin-consistency.yaml`
  依赖：T1.1/T1.2（测试基础设施须先解耦真实缺口依赖，再移除 waiver，否则先行 remove 会让 T1.1/T1.2 重构前的旧用例直接红）、T1.4/T1.5/T1.6（9/9 wrapper 齐备）
  验收命令：`! grep -q "spec-driver-refactor-codex-wrapper-gap" contracts/codex-plugin-consistency.yaml`（**Tasks 审查轮 W7 修正**：由 `grep -c ...`（预期字符串 `0`）改为 `! grep -q ...`，grep 未命中时自身 exit 1、取反后整体 exit 0，符合 shell "失败即非零退出"的验收惯用范式，避免误把字符串 `0` 当作命令输出比对的隐性心智负担）
  关联：FR-103/104，plan T1.3 步骤5

- [x] T1.8 `tests/integration/repo-maintenance-sync-check.test.ts`：本地 `SPEC_DRIVER_SKILLS` 数组（第 137-146 行，独立于 T1.3 那份）同步追加 `'spec-driver-refactor'`
  涉及文件：`tests/integration/repo-maintenance-sync-check.test.ts`
  关联：FR-106
  [P，可与 T1.6 并行]

- [x] T1.9【Slice 1 验收检查点】跑 plan §7 Slice 1 验证命令组，确认 9/9 wrapper 完整、无 waiver、无 stale-waiver 告警
  验收命令：
  ```bash
  npm run codex:spec-driver:install
  npm run repo:sync
  npx vitest run tests/integration/spec-driver-codex-skills.test.ts tests/integration/repo-maintenance-sync-check.test.ts tests/unit/codex-plugin-consistency-core.test.ts tests/integration/release-contract-sync.test.ts
  npm run repo:check
  ```
  依赖：T1.1~T1.8 全部完成
  关联：SC-001/005

---

## Slice 2 — Workstream 2a：Capability 探测 helper（纯函数，可与 Slice 1 并行）

> 不接线到 `codex-skills.sh`，独立可验证；与 Slice 1 无编辑面重叠，可并行开发。

- [ ] T2.1 [红] `tests/unit/spec-driver/detect-codex-capability.test.ts`（新）：`parseFeaturesListOutput('multi_agent   stable   true\n...')` → `{capability:'native', reason:null}`
  涉及文件：`tests/unit/spec-driver/detect-codex-capability.test.ts`
  关联：FR-203，plan T2.1

- [ ] T2.2 [红] 同文件：覆盖七类 reason 的 fixture 组（**Tasks 审查轮"其他"修正**：原"7 组 fixture"表述与实际列举的六个非 native fixture 不对齐——native 已由 T2.1 单独覆盖，本任务与 T2.1 合计覆盖 FR-203 定义的全部七类 reason，故改称"覆盖七类 reason 的 fixture 组"，不再声称本任务单独包含 7 组）：`no-feature-row`（无首 token 精确等于 `multi_agent` 的行）/ `malformed-effective`（行末非空 token 非 `true`/`false`）/ `effective-false`（行末非空 token 为 `false`）/ `multi_agent_mode`、`multi_agent_v2` 干扰行不被误判（首 token 精确匹配非前缀/子串）/ `multi_agent under development true`（stage 列多词变体，验证"取行末最后一个非空 token"而非固定列位裁切）
  涉及文件：`tests/unit/spec-driver/detect-codex-capability.test.ts`
  关联：FR-203/209，plan T2.2（含 W5 修订）

- [ ] T2.3 [红] 同文件：`vi.mock('node:child_process')` 模拟 `execFileSync` 抛 `{code:'ENOENT'}` → `binary-missing`；抛 `{killed:true, signal:'SIGTERM'}` → `timeout`；stderr 含 `unrecognized subcommand` → `unsupported-command`；其余非零退出 → `command-failed`
  涉及文件：`tests/unit/spec-driver/detect-codex-capability.test.ts`
  关联：FR-201/202/203，plan T2.3

- [ ] T2.3b [红]（**Tasks 审查轮 W3 新增**）同文件：`vi.mock('node:child_process')` 模拟 `detectCodexVersion()` 内部 `execFileSync('codex', ['--version'])` 调用 → 正常输出解析为版本字符串；调用失败（ENOENT/非零退出）→ 返回 `null`（不抛异常，不阻断 sidecar 写入）
  涉及文件：`tests/unit/spec-driver/detect-codex-capability.test.ts`
  关联：FR-207/208，plan T2.4（W3 拆分）

- [ ] T2.3c [红]（**Tasks 审查轮 W3 新增**）同文件：`renderCapabilityMarkdown(result)` 输出 schema 断言——含 capability 行、ISO 8601 时间戳行、`codex --version` 结果行三要素；`degraded` 结果额外含 reason 字段
  涉及文件：`tests/unit/spec-driver/detect-codex-capability.test.ts`
  关联：FR-206/207，plan T2.4（W3 拆分）

- [ ] T2.4 [绿实现]（**Tasks 审查轮 W3 修订：仅保留实现，红测试拆至 T2.3b/T2.3c**）`plugins/spec-driver/scripts/lib/detect-codex-capability.mjs`（新）：导出 `parseFeaturesListOutput(stdout)`（首 token 精确匹配 + 取行末非空 token 解析规则）、`detectCodexCapability(opts?)`（`execFileSync` 5s 超时 + try/catch 四类边界分支）、`detectCodexVersion(opts?)`、`renderCapabilityMarkdown(result)`（拼出 sidecar 完整 Markdown：capability/reason 三要素 + ISO 8601 时间戳 + `codex --version`）；CLI 直跑入口支持默认单行 JSON 与 `--markdown` 两种输出模式
  涉及文件：`plugins/spec-driver/scripts/lib/detect-codex-capability.mjs`
  依赖：T2.1/T2.2/T2.3/T2.3b/T2.3c（先红后绿）
  验收命令：`npx vitest run tests/unit/spec-driver/detect-codex-capability.test.ts`
  关联：FR-201/202/203/207/208/209，plan §0 Q3 裁决

- [ ] T2.5【Slice 2 验收检查点】
  验收命令：`npx vitest run tests/unit/spec-driver/detect-codex-capability.test.ts`
  依赖：T2.1~T2.4 全部完成
  关联：SC-003（unit 层）

---

## Slice 3 — Workstream 2b：Sidecar 接线 + Capability-neutral 文案（US-2 / FR-201~209/301）

> **不可与 Slice 1 并行**（plan C6：都改 `codex-skills.sh`，产物链耦合）；必须在 Slice 1 合并后开始，依赖 Slice 2 的 `detect-codex-capability.mjs`。

- [x] T3.1 [红] `tests/integration/spec-driver-codex-skills.test.ts` 新增块：**受控 PATH（完全替换非追加）**——tempDir/bin 内含 fake `codex`（返回 `multi_agent  stable  true`）+ 脚本实际调用面所需系统命令（`node`/`bash`/`dirname`/`mkdir`/`cat` 等，implement 阶段按 `codex-skills.sh` 与 `detect-codex-capability.mjs` 实际调用面逐一核实列全）symlink，`env.PATH` 整体替换（非 `PATH:'<tempDir>/bin:'+process.env.PATH` 追加式，防止装机真实 `codex` 抢先命中导致假失败）→ `install` 后 `.codex/spec-driver-capability.md` 含 `Subagent Capability: native`，`.codex/skills/*/SKILL.md` 不含该行（capability-neutral）
  涉及文件：`tests/integration/spec-driver-codex-skills.test.ts`
  关联：FR-201/204/206，plan T2.4（含 W4 修订）

- [x] T3.1b [红]（**Tasks 审查轮 W11 新增**）同文件：**FR-204 三份产物中性指针一致性机械断言**——对 `.codex/skills/<sample-id>/SKILL.md` 与 `plugins/spec-driver/skills-codex/<sample-id>/SKILL.md`（各抽一个样本 skill）逐一 grep，断言均含中性指针文案（`.codex/spec-driver-capability.md` 路径字面量），且均**不含**任何具体 capability 结果值字面量（如 `native`/`degraded`），机械验证三份产物（wrapper 正文两处分发镜像 + capability-neutral 指针文案）与探测结果彻底解耦
  涉及文件：`tests/integration/spec-driver-codex-skills.test.ts`
  关联：FR-204，plan §3.3、Tasks 审查轮 W11

- [x] T3.2 [红]（**Tasks 审查轮 C1 修订：调用计数按参数分类**）同文件：fake `codex` 脚本按参数分类记录调用（区分 `features list` 子命令与 `--version` 参数，各自独立计数或按参数追加带标签的日志行，不合并计数）；断言单次 `install` 后 `features list` 恰好被调用 1 次、`--version` 恰好被调用 1 次（分别机械验证 FR-201"单次探测+缓存"对两类子调用独立成立，避免合并计数掩盖任一子调用被重复触发的回归）
  涉及文件：`tests/integration/spec-driver-codex-skills.test.ts`
  关联：FR-201，plan T2.4b（W4 新增，Tasks 审查轮 C1 修订）

- [x] T3.3 [红] 同文件：受控 PATH **不含**任何 `codex` 可执行文件（区别于"追加式 PATH 里没有"）→ sidecar 含 `degraded(reason=binary-missing)`，`install` 整体 exit 0
  涉及文件：`tests/integration/spec-driver-codex-skills.test.ts`
  关联：FR-202/206，E1，plan T2.5

- [x] T3.4 [红] 同文件：fake `codex` 脚本 `exit 1` → sidecar 含 `degraded(reason=command-failed)`
  涉及文件：`tests/integration/spec-driver-codex-skills.test.ts`
  关联：FR-203/206，plan T2.6

- [x] T3.5 [红] 同文件：两次连续 install（第一次 fake codex 返回 true，第二次替换为返回 false）→ sidecar 内容随第二次刷新
  涉及文件：`tests/integration/spec-driver-codex-skills.test.ts`
  关联：FR-208，plan T2.7

- [x] T3.6 [红] 同文件：**sidecar schema 三要素完整性断言**——含 capability 行 + ISO 8601 时间戳行 + `codex --version` 结果行三要素齐全；且 `.codex/skills/*/SKILL.md`、`plugins/spec-driver/skills-codex/*/SKILL.md`、`npm pack` 产物列表均**不含** sidecar 文件（FR-207 隔离边界机械验证）（**与 T3.2 对齐**：本任务断言中 `codex --version` 结果行的取值来源即 T3.2 按参数分类计数体系中单独核算的 `--version` 调用，二者共用同一 fake `codex` 脚本的分类记录机制，不重复实现）
  涉及文件：`tests/integration/spec-driver-codex-skills.test.ts`
  关联：FR-206/207，plan T2.7b（W4 新增，**不可遗漏**）

- [x] T3.7 [红] `tests/unit/spec-driver/wrapper-sha256.test.ts` 第 68 行 `expect(body).toContain('Task tool（Codex 下按内联子代理执行）')` 改为断言新 capability-neutral 文案（见 plan §3.3 精确文案）
  涉及文件：`tests/unit/spec-driver/wrapper-sha256.test.ts`
  关联：FR-205，plan T2.8——**必须与 T3.9 在同一 commit 完成**，否则该测试挂红阻断后续提交

- [x] T3.7b [红]（**Tasks 审查轮 W10 新增**）`tests/integration/spec-driver-codex-skills.test.ts`：生成 wrapper 后断言 `write_codex_adapter()` 输出的"模型兼容"一行**不含**字面量 `gpt-5`（任何 `gpt-5*` 具体版本号）、**含**"由 Codex CLI"字样（最小机械断言，驱动 FR-301 文案改写，先于 T3.8 实现前置）
  涉及文件：`tests/integration/spec-driver-codex-skills.test.ts`
  关联：FR-301，plan §3.3

- [x] T3.8 [绿实现] `plugins/spec-driver/scripts/codex-skills.sh`：在 9 个 `write_wrapper` 调用之后、`install_all()` 结尾调用 `detect-codex-capability.mjs`（`--markdown` 模式重定向输出到 `$(dirname "$TARGET_DIR")/spec-driver-capability.md`）一次，失败仅 `echo` 警告不阻断 install；`write_codex_adapter()` 的"子代理执行"与"模型兼容"两行按 plan §3.3 精确文案改写（FR-204/301）
  涉及文件：`plugins/spec-driver/scripts/codex-skills.sh`
  依赖：T3.1~T3.7b（先红后绿）、Slice 2 完成（消费 `detect-codex-capability.mjs`）
  关联：FR-201/202/204/206/207/208/301，plan §3.2（含 W2/W3 修订）

- [x] T3.9 [绿实现] `plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs`：`rewriteCodexRuntimeText()` 替换列表第 8 条目标文案改写为 capability-neutral 指针短语（plan §3.3：`['Claude Code 的 Task tool', 'Task tool（Codex 下子代理执行能力以 .codex/spec-driver-capability.md 探测记录为准，缺失/degraded 时按内联/串行降级执行）']`）
  涉及文件：`plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs`
  依赖：T3.7（先红后绿）
  关联：FR-205，plan §3.3

- [x] T3.10 `.gitignore` 新增一行 `.codex/spec-driver-capability.md`
  涉及文件：`.gitignore`
  关联：FR-207
  [P，可与 T3.8/3.9 并行]

- [x] T3.11 `npm run repo:sync` 重新生成 tracked `plugins/spec-driver/skills-codex/`（C6 要求：`extract-wrapper-body.mjs` 改动后 tracked 旧 sha 与新 helper 重算结果不一致，裸 install 不会重写 tracked 目录，必须走 `repo:sync` 才能同步，否则 `codex-plugin-distribution-markers` 检查必红）
  依赖：T3.9 完成
  验收命令：`npm run repo:sync`
  关联：FR-101/106，plan §7 Slice 3 验证命令注释

- [x] T3.12【Slice 3 验收检查点】
  验收命令：
  ```bash
  npm run repo:sync
  npx vitest run tests/integration/spec-driver-codex-skills.test.ts tests/unit/spec-driver/wrapper-sha256.test.ts
  npm run repo:check
  ```
  依赖：T3.1~T3.11 全部完成
  关联：SC-003(a)(b)、SC-005

---

## Slice 4 — Workstream 3 代码层：modelFlagMode 决策矩阵 + Delegated 语义（US-3 部分 / FR-304~307）

> 建议在 Slice 1-3 完成后开始（保持 review 粒度一致，非强制依赖），与 Slice 5 文案层可并行（编辑面不重叠）。

- [ ] T4.1 [红] `tests/unit/model-selection.test.ts`：tempDir 无 `spec-driver.config.yaml`、无 env → `resolveCodexExecutionConfig({cwd, env:{}})` → `modelFlagMode='delegate'`，`modelSource` 以 `'preset:'` 开头，`model` 以 `'delegated:'` 开头
  涉及文件：`tests/unit/model-selection.test.ts`
  关联：FR-304，plan T3.5

- [ ] T4.2 [红] 同文件：`preset: balanced`（无 `agents`/`model_compat`）→ 同上 delegate 结果
  涉及文件：`tests/unit/model-selection.test.ts`
  关联：FR-304，plan T3.6

- [ ] T4.3 [红] 同文件：`agents.<agentId>.model: sonnet` 显式配置 → `modelFlagMode='required'`，`modelSource` 以 `'driver-config-agent:'` 开头
  涉及文件：`tests/unit/model-selection.test.ts`
  关联：FR-304，plan T3.7

- [ ] T4.4 [红] 同文件 + `tests/unit/codex-proxy.test.ts`：`model_compat.aliases.codex.sonnet: gpt-5.6-sol`（preset 命中 sonnet tier，无 `agents.<id>.model` 显式覆盖）→ `modelFlagMode==='required'`，`modelSource` 以 `'model_compat.aliases.codex:'` 开头，**且 `resolved.model === 'gpt-5.6-sol'`**（回归哨兵：杜绝"标 required 却传内建默认"假绿）；配套端到端断言：`callLLMviaCodex()` 最终 spawn 的 `--model` 参数值精确等于 `'gpt-5.6-sol'`
  涉及文件：`tests/unit/model-selection.test.ts`、`tests/unit/codex-proxy.test.ts`
  关联：FR-304/309，plan T3.8（**C1 新增断言**）

- [ ] T4.5 [红] `tests/unit/model-selection.test.ts`：`model_compat.defaults.codex: gpt-5.6-sol`（无 aliases 命中）→ `required`，`modelSource='model_compat.defaults.codex'`
  涉及文件：`tests/unit/model-selection.test.ts`
  关联：FR-304，plan T3.9

- [ ] T4.6 [红] 同文件：`env.REVERSE_SPEC_MODEL` 设置 → `required`，`modelSource='env:REVERSE_SPEC_MODEL'`
  涉及文件：`tests/unit/model-selection.test.ts`
  关联：FR-304，plan T3.10

- [ ] T4.7 [红]（**Tasks 审查轮 W1 修订：改为合法调用形态**）`tests/unit/llm-client.test.ts`：构造真实 `AssembledContext`（**不引用不存在的 `providerRuntime` 字段**）+ `vi.mock` 使认证探测入口（`detectAuth()` 或等价函数）返回 `codex` → `callLLM({model: getCanonicalSonnetModelId('codex'), ...})`（依据 mock 后的 runtime 判定走 codex 分支，而非直接传入不存在的字段）→ mock spawn 捕获 args 含 `'--model'`，`result.model` **不**以 `'delegated:'` 开头（FR-306 互斥回归锁定，Fix 134 教训不重演；锁在 `callLLM()` 入口层而非 `codex-proxy.ts` 内部）
  涉及文件：`tests/unit/llm-client.test.ts`
  关联：FR-306，plan T3.11（**C2+I4 修订，Tasks 审查轮 W1**）

- [ ] T4.8 [红] `tests/unit/codex-proxy.test.ts`：`getDefaultCodexCLIProxyConfig({cwd: tempDirNoConfig, env:{}})` 取得 delegate 态默认配置（`model` 以 `'delegated:'` 开头）→ `callLLMviaCodex(prompt, {})`（不传 `model`，走默认解析路径）→ spawn args **不**含 `--model`，`result.model` 以 `'delegated:'` 开头
  涉及文件：`tests/unit/codex-proxy.test.ts`
  关联：FR-304/306，plan T3.12（**C2+I4 修订**）

- [ ] T4.9 [红] `tests/unit/llm-client.test.ts`：`getTimeoutForModel('delegated:gpt-5.4')` → `300_000`；`getTimeoutForModel('delegated:whatever-unknown-string')` → 仍 `300_000`（证明走显式前缀分支非关键字巧合）
  涉及文件：`tests/unit/llm-client.test.ts`
  关联：FR-305(b)/307，plan T3.13

- [ ] T4.10 [红] `tests/unit/codex-proxy.test.ts`：`getDefaultCodexCLIProxyConfig({cwd: tempDirNoConfig, env:{}})` → `timeout === 300_000`（delegate 场景端到端保守超时）
  涉及文件：`tests/unit/codex-proxy.test.ts`
  关联：FR-307，plan T3.14

- [ ] T4.12 [绿实现] `src/core/model-selection.ts`：新增 `export type CodexModelFlagMode = 'required' | 'delegate'`；新增私有原子 resolver `resolveCodexModelDecision(options): {model, modelFlagMode, modelSource}`（判定顺序：env `REVERSE_SPEC_MODEL` → `agents.<id>.model` 显式 → `model_compat.aliases.codex[tier]` 命中 → `model_compat.defaults.codex` 命中 → delegate 兜底 `model='delegated:<内部hint>'`；**必须显式优先查 aliases[tier]**，不得包装现状会漏读 aliases 的 `toCodexModelId()`——Review C1）；`ResolvedCodexExecutionConfig` 接口新增 `modelFlagMode`/`modelSource` 两个必填字段（纯加法，不破坏现有 `model: string` 契约）；`resolveCodexExecutionConfig()` 改为直接调用该 resolver 取三元组
  涉及文件：`src/core/model-selection.ts`
  依赖：T4.1~T4.6（先红后绿）
  关联：FR-304/306/307/309，plan §3.5、Review C1

- [ ] T4.12b [红]（**Tasks 审查轮 C2 回流新增：SC-007 生产链真实闭环**）`tests/unit/llm-client.test.ts` 新增生产链 E2E 用例：tempDir 内无 `spec-driver.config.yaml`、`env:{}` + `vi.mock` 使认证探测入口返回 `codex` + mock `node:child_process` spawn → 从 `callLLM()` 入口发起调用（**不显式传 `model`**，走完整默认解析路径）→ 断言全链路 delegate：mock spawn 捕获的 args **不**含 `--model`；`LLMResponse.model` 以 `'delegated:'` 开头。（修正原设计缺口：此前测试仅在 `codex-proxy.ts` 内部单元验证 delegate 分支与 `resolveCodexModelDecision()` 单元验证判定矩阵，二者之间"`callLLM()` 入口 → proxy 层实际传参判定"这一真实生产调用链从未被端到端锁定，Codex 对抗审查发现的 C2 矛盾——`callLLM()` 把含 `delegated:` 前缀的 `model` 字符串传给 proxy 后被旧判定逻辑`impliedRequired = config.model !== undefined` 错误升级为 required——正是因为缺了这条链路测试才在实现阶段才会被发现而非在红测试阶段被拦截）
  涉及文件：`tests/unit/llm-client.test.ts`
  依赖：T4.12（先有 `resolveCodexModelDecision()` 才能构造无配置场景的确定性 delegate 态）
  关联：FR-304/305/306，plan §3.5（Tasks 审查轮 C2 回流），SC-007

- [ ] T4.13 [绿实现]（**Tasks 审查轮 C2 回流修订**）`src/core/llm-client.ts`：`LLMConfig` **不**新增 caller 可传入的 `modelFlagMode`/`modelSource` 字段；`callLLM()` 内 `providerRuntime==='codex'` 时若 `config?.model !== undefined`（无条件）→ `modelFlagMode='required'`，`modelSource='caller-override:callLLM'`，否则取 `resolveCodexExecutionConfig()` 产出值（已含 `delegated:` 前缀的 `model` 字符串）——**将该 model 字符串原样传给 codex-proxy 层即可**，不再需要额外内部信道字段传递 `modelFlagMode`（proxy 侧判定改为只认 model 字符串前缀，见 T4.14）；`callLLM()` codex 分支拿到 `modelFlagMode==='delegate'`（且 caller 未传 `model`）时写一行 stderr 诊断日志：`[llm-client] codex 模型选择委托给 CLI 自身 (source=<modelSource>, timeout-hint=<timeout>ms)`（**FR-305 日志落点由 `codex-proxy.ts` 移至此处**：`modelSource` 信息在 `llm-client.ts` 这一层完整，`codex-proxy.ts` 不再打印同类日志，避免双行输出）；`getTimeoutForModel()` 顶部新增 `if (lowerModel.startsWith('delegated:')) return 300_000;`（先于其余关键字判断）
  涉及文件：`src/core/llm-client.ts`
  依赖：T4.7、T4.9、T4.12、T4.12b（先红后绿）
  关联：FR-304（第5/6行）/305/306/307，plan §3.5、Tasks 审查轮 C2 回流

- [ ] T4.14 [绿实现]（**Tasks 审查轮 C2 回流修订：proxy 判定单一化为 model 字符串前缀**）`src/auth/codex-proxy.ts`：`CodexCLIProxyConfig` **不**新增 `modelFlagMode`/`modelSource` 可传入字段；`getDefaultCodexCLIProxyConfig(options?: {cwd?, env?})` 增加可选透传参数，内部把结果装入返回对象（`resolved.modelFlagMode`/`resolved.modelSource`，仅供日志/测试断言消费，**proxy 判定逻辑本身不读取这两个字段**）；`callLLMviaCodex()` 的 delegate 判定**只认一个信号**：`cfg.model` 字符串是否以 `'delegated:'` 开头（**删除**原 `impliedRequired = config.model !== undefined` 判定逻辑与相应短路赋值——该逻辑会把含 `delegated:` 前缀的 `model` 字符串错误升级为 required，是 Codex 对抗审查发现的致命矛盾根因）；拼接 args 时 `if (!cfg.model.startsWith('delegated:')) { args.push('--model', cfg.model); }`；**proxy 不再打印 delegate 诊断日志**（该职责已移至 T4.13 的 `llm-client.ts`）
  涉及文件：`src/auth/codex-proxy.ts`
  依赖：T4.4、T4.8、T4.10、T4.12（先红后绿；原 T4.11 已废止，日志断言合并入 T4.13，见收尾说明）
  验收命令（红测试两态，取代原 impliedRequired 相关断言）：`model:'delegated:x'` → spawn args 无 `--model`；`model:'gpt-x'` → spawn args 含 `--model`
  关联：FR-304/306，plan §3.5、Tasks 审查轮 C2 回流

- [ ] T4.15 `npm run build` 类型检查零错误（`ResolvedCodexExecutionConfig` 新增字段不破坏既有调用点类型）
  依赖：T4.12~T4.14
  验收命令：`npm run build`

- [ ] T4.16【Slice 4 验收检查点】
  验收命令：
  ```bash
  npx vitest run tests/unit/model-selection.test.ts tests/unit/codex-proxy.test.ts tests/unit/llm-client.test.ts
  npm run build
  ```
  依赖：T4.1~T4.15 全部完成
  关联：SC-007

> **（Tasks 审查轮 C2 回流说明）原 T4.11**（`codex-proxy.test.ts` 内 `vi.spyOn(console, 'error')` 断言 delegate 分支 stderr 诊断日志）**已废止**：FR-305 日志落点随 C2 判定单一化设计一并从 `codex-proxy.ts` 移至 `llm-client.ts`，其断言职责合并入 T4.13，避免在两处（proxy 与 client）各维护一份 delegate 判定与一份日志断言。

---

## Slice 5 — Workstream 3 文案层 + 门禁（US-3 收尾 / FR-301~303/308/310）

> 与 Slice 4 可并行，但**非整体声明**（见"依赖与并行说明"精确子组划分）。

- [ ] T5.1 [红] `tests/unit/model-literal-gate-core.test.ts`（新）：对含 `gpt-5.4`/`gpt-5.6-sol`/`gpt-5-mini` 的临时 fixture 跑 `validateModelLiteralGate` → `status='fail'`，`offenders` 精确定位到文件+行号；对 `gpt-50`/`gpt-5x`（非目标字面量）不误报
  涉及文件：`tests/unit/model-literal-gate-core.test.ts`
  关联：FR-310，plan T3.1

- [ ] T5.2 [绿实现] `scripts/lib/model-literal-gate-core.mjs`（新）：正则 `gpt-5(\.\d+)?(-[a-z0-9]+)*(?![0-9a-zA-Z])`（右边界 negative lookahead）+ FR-310 固定扫描清单目录遍历，返回 `{status, checks:[{id:'model-literal-scan', title, status, evidence}], warnings, errors}` 四字段合同；`scripts/check-model-literals.mjs`（新）独立 CLI 直跑入口（自身不落在扫描面内）
  涉及文件：`scripts/lib/model-literal-gate-core.mjs`（新）、`scripts/check-model-literals.mjs`（新）
  依赖：T5.1（先红后绿）
  验收命令：`npx vitest run tests/unit/model-literal-gate-core.test.ts`
  关联：FR-310，plan T3.1

- [ ] T5.3 对本仓库 FR-302/303 清理**完成前**的真实文件跑门禁 → 记录 `status='fail'` 的精确 offender 清单（文件+行号），作为后续逐条清理的事实源（不依赖 spec/plan 里的近似行号，行号随改动漂移，以本次扫描结果为准）
  验收命令：`node scripts/check-model-literals.mjs`（预期非零退出，留存输出）
  依赖：T5.2
  关联：FR-302/303，plan T3.2（W9 修正）

- [ ] T5.4 `README.md`（仓库根）：`Codex (gpt-5.4 + thinking levels)` 一行简介文案改写为 `Codex (tier-mapped via model_compat.aliases.codex + thinking levels)`
  涉及文件：`README.md`
  依赖：T5.3（按其输出的精确锚点定位）
  关联：FR-302
  [P，可与 T5.5/5.6/5.7/5.8 并行——不同文件]

- [ ] T5.5 `plugins/spec-driver/README.md`：`opus: gpt-5.4` 等 YAML 示例段改为占位符 `<YOUR_CODEX_MODEL_ID>` + 注释指向 `model_compat.aliases.codex`/`~/.codex/config.toml`；模型兼容说明段落改为 tier 语义描述
  涉及文件：`plugins/spec-driver/README.md`
  依赖：T5.3
  关联：FR-302
  [P]

- [ ] T5.6 `docs/configuration.md`：同 T5.5 处理策略（YAML 示例段 + 中英文说明段落）
  涉及文件：`docs/configuration.md`
  依赖：T5.3
  关联：FR-302
  [P]

- [ ] T5.7 `plugins/spec-driver/templates/spec-driver.config-template.yaml`：**`model_compat.aliases.codex`（`opus`/`sonnet`/`haiku` 三键）与 `defaults.codex` 段整段注释化**（`#` 前缀逐行，非仅改字面量），占位符 `<YOUR_CODEX_MODEL_ID>` 只出现在注释行内；**不得**把占位符留在活动 YAML（会被 `parseSimpleYaml` 当合法字符串值读入，导致 `readRuntimeAliases`/`readRuntimeDefault` 命中不存在模型 ID，误判 `required`，与 FR-304 delegate 语义矛盾）
  涉及文件：`plugins/spec-driver/templates/spec-driver.config-template.yaml`
  依赖：T5.3
  关联：FR-302，plan §3.4 W7 修正（**不可遗漏**）
  [P]

- [ ] T5.8 `plugins/spec-driver/skills/{implement,story,resume}/SKILL.md`（canonical 源，仅这三份，**不得**手工分别改镜像）：清理"默认将 opus/sonnet/haiku 映射到 gpt-5.4"一类文案，改写为 plan §3.3 对照示例（"归一化到 `model_compat.defaults.codex`（或更细粒度的 `model_compat.aliases.codex`）配置的模型；未显式配置时由 Codex CLI 自身决定当前默认模型"）
  涉及文件：`plugins/spec-driver/skills/implement/SKILL.md`、`plugins/spec-driver/skills/story/SKILL.md`、`plugins/spec-driver/skills/resume/SKILL.md`
  依赖：T5.3
  关联：FR-303，plan §3.3
  [P]

- [ ] T5.9 [红]（**Tasks 审查轮 W2：执行顺序标注**——本任务作为 TDD 红测试，应先于 T5.7 的模板注释化实现被**编写**（红），T5.7 完成后才能转绿；文档物理位置保持不变，仅标注真实的红→绿执行时序，不重编号）`tests/unit/model-selection.test.ts`：拷贝 `spec-driver.config-template.yaml` **默认态（注释化后未取消注释）**到 tempDir 作为 `spec-driver.config.yaml` → `resolveCodexExecutionConfig({cwd: tempDir, env:{}})` → `modelFlagMode==='delegate'`，`model` 以 `'delegated:'` 开头（证明模板默认态不会意外触发 required）
  涉及文件：`tests/unit/model-selection.test.ts`
  依赖：T5.7（模板必须已注释化）、Slice 4 的 `resolveCodexModelDecision()` 已实现（T4.12）
  关联：FR-302，plan T3.16（W7 新增，**不可遗漏**）

- [ ] T5.10 `npm run repo:sync` 重生 `.codex/skills` 与 `skills-codex` 镜像，同步 T5.8 的 FR-303 改动到两份分发镜像（**硬依赖 Slice 3 已完成**：`repo:sync` 会一并重写 tracked `skills-codex/`，若 Slice 3 的 wrapper 产物链改动尚未合并，本任务提前执行会用旧 wrapper 源覆盖，产生虚假的"已同步"状态）
  依赖：T5.8、Slice 3 完成（T3.12）
  验收命令：`npm run repo:sync`
  关联：FR-303 双写约束

- [ ] T5.11 重跑门禁扫描器确认全部文案清理生效
  验收命令：`node scripts/check-model-literals.mjs`（预期 exit 0）
  依赖：T5.4~T5.7、T5.10
  关联：SC-004，plan T3.3

- [ ] T5.12 [绿实现] `scripts/lib/repo-maintenance-core.mjs`：接入第 14 检查族（`model-literal-gate:model-literal-scan`），消费 T5.2 的门禁核心模块
  涉及文件：`scripts/lib/repo-maintenance-core.mjs`
  依赖：T5.2
  关联：FR-310

- [ ] T5.13 [红/更新]（**Tasks 审查轮 W2：执行顺序标注**——本任务作为断言"新增项"的红/更新测试，应先于 T5.12 的接线实现被编写，T5.12 完成后转绿；文档物理位置保持不变，仅标注真实红→绿时序）`tests/integration/spec-drift-repo-check-regression.test.ts`：断言 (d) 新增项精确匹配 `['spec-drift:anchors-status', 'model-literal-gate:model-literal-scan']`（按 `aggregateValidation` 调用序）；`tests/fixtures/.../repo-check-baseline.json` **保持不变，不追加 `model-literal-gate` 条目**（该基线固化"13 族接入 spec-drift 之前"的历史快照，两项相对基线都应是"新增项"，若写入 baseline 会让断言 (d) 测不出第 14 族是否真正接线成功）
  涉及文件：`tests/integration/spec-drift-repo-check-regression.test.ts`
  依赖：T5.12
  关联：FR-310，plan T3.4（Review C5，**不可遗漏**：baseline 不动 + added 双 id 断言）

- [ ] T5.14【Slice 5 验收检查点】
  验收命令：
  ```bash
  npm run repo:sync
  node scripts/check-model-literals.mjs
  npx vitest run tests/unit/model-literal-gate-core.test.ts tests/integration/spec-drift-repo-check-regression.test.ts
  npm run repo:check
  ```
  依赖：T5.1~T5.13 全部完成
  关联：SC-004

---

## 收尾组（Final — 跨 Slice 收口）

- [ ] T6.1 **FR-308 follow-up 记录（不实现，仅记录）**（**Tasks 审查轮 W9 修正**：证据位置固定，不再泛指"团队待办渠道"）：`DEFAULT_CODEX_MODEL` 常量兜底值"惰性读取本机 `~/.codex/config.toml` 的 `model` 字段"已在 plan 阶段裁决延后（W6），本任务在 feature 收尾时新建 `specs/238-codex-wrapper-completeness/follow-ups.md`，写入该决策的可追踪 follow-up 条目，退出条件严格按 spec FR-308 原文（逐字摘录）："惰性读取本机 `~/.codex/config.toml` 的 `model` 字段，读取失败时退回现有硬编码兜底值，复用 `model-selection.ts` 已有的 `try/catch` 容错模式"，不由本任务自行降低标准。不修改任何源码
  验收命令：`test -f specs/238-codex-wrapper-completeness/follow-ups.md && grep -q "FR-308" specs/238-codex-wrapper-completeness/follow-ups.md`
  关联：FR-308，plan §3.5"FR-308 延后决策记录"、Review W6，Tasks 审查轮 W9

- [ ] T6.2 **全量验证矩阵**
  验收命令：
  ```bash
  npx vitest run
  npm run build
  npm run repo:check
  npm run release:check
  ```
  依赖：Slice 1~5 全部完成
  关联：SC-006

- [ ] T6.3 **SC-002 真实 E2E**（消耗一次 ChatGPT 订阅推理配额，禁止改用 `OPENAI_API_KEY` 付费 fallback）（**Tasks 审查轮 W8 修正**：命令占位符固定为本仓库根，非泛化占位符——T1.9 完成后 wrapper 已通过 `npm run codex:spec-driver:install` 安装到本仓库 `.codex/skills/`，无需另建外部项目）
  验收命令：
  ```bash
  codex --version
  codex exec --sandbox read-only --ephemeral --skip-git-repo-check --color never \
    -C . \
    "请确认你能发现名为 spec-driver-refactor 的 skill（通过 \$spec-driver-refactor 或等价方式），\
只需回答是否发现及其 frontmatter description 摘要，不要执行该 skill 的任何指令。"
  ```
  证据留存路径：`specs/238-codex-wrapper-completeness/verification/sc-002-codex-refactor-wrapper-e2e.md`（记录 `codex --version` 输出、完整执行命令、stdout 中确认发现 skill 的关键片段、执行时间戳）
  依赖：T1.9（Slice 1 完成，wrapper 已生成于本仓库 `.codex/skills/`）
  关联：SC-002

- [ ] T6.4 **SC-008 Claude 侧 diff 白名单人工复核**
  验收命令：
  ```bash
  npx vitest run --project unit --project integration
  git diff plugins/spec-driver/skills/*/SKILL.md
  ```
  人工确认 `git diff` 仅命中 Non-functional & Constraints 声明的白名单（模型版本字面量 → tier 语义表述，见 plan §3.3 对照示例），Claude alias 优先级、preset 优先级、phase/gate 定义、质量门文字等其余内容字节不变；`npx vitest run --project unit --project integration` 零新增失败
  依赖：T5.8（skill body 改动完成）
  关联：SC-008

- [ ] T6.5 **插件版本 SemVer 评估**（建议但非本 Feature 强制）：判断是否将版本从 `4.4.0` bump 到 `4.5.0`（新增 skill 覆盖 + 新 sidecar 能力 = 功能性增强）；若 implement 阶段判断该 bump 应归入独立发布收口 Feature，则在此明确记录为 follow-up，不在本 Feature 内顺手做
  依赖：Slice 1~5 全部完成
  关联：plan §6 Rollout 步骤3

- [ ] T6.6 **Dogfooding 反馈节**：交付报告末尾附"工具使用反馈"，至少覆盖四维度——(a) MCP 是否可用（连接失败/工具缺失/调用报错）、(b) 返回信息是否够用（字段缺失/上下文不全）、(c) 流程是否顺畅（Spec Driver gate/phase/产物是否卡住冗余）、(d) 结果是否准确（impact/graph/fuzzy match 等是否误导）；没遇到问题需显式写"无"，不得省略
  依赖：T6.2~T6.5 完成后统一撰写

---

## FR 覆盖映射表

| FR | Task ID |
|----|---------|
| FR-101 | T1.3, T1.4, T1.5 |
| FR-102 | T1.6 |
| FR-103 | T1.1, T1.2, T1.7 |
| FR-104 | T1.1, T1.7 |
| FR-105 | T1.3 |
| FR-106 | T1.4, T1.5, T1.8, T1.9, T3.11 |
| FR-201 | T2.4, T3.1, T3.2, T3.8 |
| FR-202 | T2.3, T2.4, T3.3, T3.8 |
| FR-203 | T2.1, T2.2, T2.3, T2.4, T3.4 |
| FR-204 | T3.1, T3.1b, T3.6, T3.8 |
| FR-205 | T3.7, T3.9 |
| FR-206 | T3.1, T3.3, T3.4, T3.6, T3.8 |
| FR-207 | T2.3b, T3.6, T3.10 |
| FR-208 | T3.5, T3.8 |
| FR-209 | T2.2, T2.4 |
| FR-301 | T3.7b, T3.8 |
| FR-302 | T5.3, T5.4, T5.5, T5.6, T5.7, T5.9, T5.11 |
| FR-303 | T5.8, T5.10, T6.4 |
| FR-304 | T4.1~T4.14 |
| FR-305 | T4.9, T4.10, T4.12b, T4.13 |
| FR-306 | T4.4, T4.7, T4.12, T4.13, T4.14 |
| FR-307 | T4.9, T4.10, T4.13 |
| FR-308 | T6.1（follow-up，不实现）|
| FR-309 | T4.4, T4.12, T4.14 |
| FR-310 | T5.1, T5.2, T5.11, T5.12, T5.13 |

## Success Criteria 覆盖映射表

| SC | Task ID |
|----|---------|
| SC-001 | T1.9 |
| SC-002 | T6.3 |
| SC-003 | T2.5, T3.12 |
| SC-004 | T5.14 |
| SC-005 | T1.9, T3.12 |
| SC-006 | T6.2 |
| SC-007 | T4.16, T4.12b |
| SC-008 | T6.4 |

---

## 依赖与并行说明

### Phase 依赖关系（串行硬约束）

- **Slice 1 → Slice 3**：不可并行（plan Review C6：同改 `codex-skills.sh`，wrapper 产物链耦合）。Slice 3 必须在 Slice 1 完全合并（T1.9 通过）后开始。
- **Slice 2 → Slice 3**：Slice 3 的 T3.8 依赖 Slice 2 产出的 `detect-codex-capability.mjs`。
- **Slice 1/2 → Slice 4/5**：非强制依赖，但 plan 建议在 Slice 1-3 完成后开始以保持 review 粒度一致；T5.9 硬依赖 Slice 4 的 `resolveCodexModelDecision()`（T4.12）已实现 + T5.7 模板注释化；T5.10 硬依赖 Slice 3 完成（T3.12）。
- **T6.3（SC-002 E2E）** 依赖 T1.9（wrapper 已生成，Slice 1 完成即可执行，无需等 Slice 4/5）。
- **T6.2/T6.4（全量验证/diff 复核）** 依赖 Slice 1~5 全部完成。

### 可并行组

1. **Slice 1 内部**：T1.1/T1.2（测试基础设施重构）与 T1.6/T1.8（纯 yaml/数组追加）可并行；T1.3→T1.4/T1.5 是红绿对，T1.7 依赖前两组汇合。
2. **Slice 1 与 Slice 2 整体并行**：两者编辑面完全不相交（`codex-skills.sh`/测试基础设施 vs. 新增独立 `.mjs` 文件）。
3. **Slice 4 与 Slice 5 精确子组并行（Tasks 审查轮 W6 修订：删除"整体并行"声明，改为精确子组）**：T5.4/T5.5/T5.6/T5.8 四份纯文档改写与 Slice 4 全部代码任务（T4.1~T4.16）无文件冲突，可并行；T5.9（模板默认态 delegate 测试）**硬依赖** T4.12（`resolveCodexModelDecision()` 已实现）与 T5.7（模板已注释化），**不可**与 Slice 4 未完成的 T4.12 并行；T5.10（`repo:sync` 重生镜像）**硬依赖** Slice 3 完成（T3.12），不得提前执行。
4. **Slice 5 内部**：T5.4/T5.5/T5.6/T5.7/T5.8 五个文案清理任务互不相交，可完全并行；T5.9/T5.13 按上述依赖各自等待对应实现任务转绿。
5. **Slice 4 内部**：T4.1~T4.10（红测试，原 T4.11 已废止——日志断言合并入 T4.13，见 Slice 4 收尾说明）之间大多可并行编写（不同断言分支，部分共享同一测试文件需注意合并冲突）；T4.12（`model-selection.ts` 绿实现）完成后先写 T4.12b（生产链 E2E 红测试，锁定 SC-007 真实闭环），再实现 T4.13（`llm-client.ts`）/T4.14（`codex-proxy.ts`），后两者依赖前者产出的 resolver，需按此顺序完成。

### 推荐实施策略

**Incremental（推荐）**：按 Slice 1 → Slice 3（串行，因 C6 耦合）→ [Slice 2 提前并行插入 Slice 1 之前或之中] → [Slice 4 / Slice 5 按上述精确子组并行] → 收尾组 的顺序推进。关键路径为 **Slice 1 → Slice 3 → Slice 4/5（取较长者）→ 收尾组**；Slice 2 可提前完成不影响关键路径长度（其产出仅是 Slice 3 的前置依赖，工作量小于 Slice 1）。MVP 范围建议为 **Slice 1（US-1，9/9 wrapper 完整性）**——这是用户能立即感知的核心缺口修复，可独立提交独立验收，US-2/US-3 是渐进增强。

---

## Review Log（Tasks 审查轮）

Codex 对抗审查（2 Critical / 11 Warning）逐条处置记录如下：

- **C1（T3.2 调用计数未按参数分类，可能掩盖 `features list` 与 `--version` 任一子调用被重复触发）** → 裁决：T3.2 改为 fake `codex` 按参数分类记录调用，单次 `install` 后 `features list` 与 `--version` 各自恰好 1 次；T3.6 三要素断言与该分类计数体系对齐说明，不重复实现。
- **C2（proxy `impliedRequired = config.model !== undefined` 与 delegate 前缀语义矛盾，生产链上 delegate 不可达）** → 裁决：proxy 判定单一化为"仅认 `model` 字符串是否以 `delegated:` 开头"，删除 `impliedRequired`/内部信道字段判定；不变量单一事实源收窄为 `resolveCodexModelDecision()` 独家产出的 `model` 前缀本身。FR-305 日志落点从 `codex-proxy.ts` 移至 `llm-client.ts`（`modelSource` 信息在该层完整，避免双行日志）。T4.14 重写为纯前缀判定；T4.13 重写为透传前缀串 + 日志断言迁入；原 T4.11（proxy 内日志断言）废止合并入 T4.13；新增 T4.12b 生产链 E2E 红测试锁定 SC-007 真实闭环，SC-007/FR-305 映射同步更新。plan.md §3.5 llm-client.ts/codex-proxy.ts 两行按新设计改写，并追加本条 Review Log。
- **W1（T4.7 引用不存在的 `providerRuntime` 字段，调用形态非法）** → 裁决：改为构造真实 `AssembledContext` + `vi.mock detectAuth` 返回 codex 的合法调用路径。
- **W2（T5.9/T5.13 红测试与其实现任务的先后顺序未清晰标注）** → 裁决：以"执行顺序"注释标注 T5.9 应先于 T5.7 编写、T5.13 应先于 T5.12 编写（TDD 红先行），不物理重排任务编号，避免引用漂移。
- **W3（T2.4 混合红测试与实现，未拆分 `detectCodexVersion` 与 `--markdown` renderer 的前置红测试）** → 裁决：新增 T2.3b（`detectCodexVersion` mock 子进程）、T2.3c（`--markdown` renderer 输出 schema 三要素），T2.4 仅保留实现，依赖列表相应扩展。
- **W4（FR 覆盖映射表遗漏若干任务）** → 裁决：FR-106 补 T1.4/T1.9；FR-204 补 T3.1b；FR-305 改为 T4.9/T4.10/T4.12b/T4.13；FR-306 补 T4.13/T4.14；FR-309 补 T4.12/T4.14；SC-007 补 T4.12b。
- **W5（T4.13/T4.14 依赖列表遗漏 T4.12）** → 裁决：两者依赖列表均补齐 T4.12。
- **W6（"Slice 4 与 Slice 5 整体并行"声明过粗，掩盖 T5.9/T5.10 的真实硬依赖）** → 裁决：删除整体并行表述，改为精确子组：T5.4/T5.5/T5.6/T5.8 与 Slice 4 全部代码任务可并行；T5.9 硬依赖 T4.12+T5.7；T5.10 硬依赖 Slice 3 完成（T3.12）。
- **W7（T1.7 验收命令用 `grep -c` 比对字符串 `0`，不符合 shell 惯用失败即非零退出范式）** → 裁决：改为 `! grep -q "..." ...`。
- **W8（T6.3 命令占位符 `<project-with-installed-wrapper>` 未固定，易被误解为需另建项目）** → 裁决：固定为 `-C .`（本仓库根，T1.9 完成后 wrapper 已安装于此）。
- **W9（T6.1 follow-up 记录位置未固定，"团队待办渠道"表述模糊不可验证）** → 裁决：固定为新建 `specs/238-codex-wrapper-completeness/follow-ups.md`，含 FR-308 原文退出条件，补验收命令 `test -f` + `grep -q "FR-308"`。
- **W10（FR-301 缺前置红测试，直接进入 T3.8 实现）** → 裁决：新增 T3.7b，断言 adapter"模型兼容"行不含 `gpt-5` 字面量且含"由 Codex CLI"字样，置于 T3.8 之前作为其依赖。
- **W11（T1.3 遗漏 remove 路径与 frontmatter/SHA 一致性断言；FR-204 三份产物中性指针缺机械断言）** → 裁决：T1.3 补充 remove 路径断言（install→remove→目录消失）与 frontmatter/SHA 一致性断言；新增 T3.1b 对 `.codex/skills/` 与 `skills-codex/` 各抽样本 grep 中性指针文案，验证三份产物解耦。
- **其他（T1.1 标签、T2.2 数量表述）** → T1.1"[红-先行重构]"改为"[characterization/重构]"（验收要求全绿，非驱动实现的红测试）；T2.2"7 组 fixture"改为"覆盖七类 reason 的 fixture 组"（与 T2.1 的 native 分支合计覆盖七类，本任务单独列举六个非 native fixture，原数量表述不对齐）。
