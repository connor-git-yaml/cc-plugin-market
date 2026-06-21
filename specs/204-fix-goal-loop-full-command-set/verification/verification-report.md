# F204 验证报告 — goal_loop full 轮命令集完整性修复 [Phase4/4]

**状态**: ✅ READY FOR DELIVERY（GATE_VERIFY 通过）
**特性**: 堵 CRITICAL-8 reward-hacking 漏洞（full 轮权威门禁不校验命令集完整性）
**基线**: F203（`9bb2ea3`）→ 实现 commit `205a639`（Phase3/4）
**验证执行**: 主编排器（Opus）亲自实跑 + spec-review/quality-review 子代理独立审查 + 3 轮 Codex 对抗审查

---

## Layer 1: Spec-Code 对齐（验收标准 AC-1~AC-7）

由 spec-review 子代理独立核验，**7/7 AC 达成（100%）**，每条均有具体测试证据（文件:行）：

| AC | 场景 | 状态 | 证据 |
|----|------|------|------|
| AC-1 | report-full-pass.json + 默认 `[]` → REACHED_GOAL 不变（141 baseline） | ✅ | `goal-loop-core.test.mjs` decideStop F204 块；core `required.size===0` 短路结构保证零回归 |
| AC-2 | full 缺 lint kind → INCOMPLETE_FULL_VERIFY（不 REACHED_GOAL） | ✅ | 集成用例 + 纯函数用例双覆盖 |
| AC-3 | full 含全部必需 kind → REACHED_GOAL | ✅ | `report-full-pass-with-kinds.json`（build/test/lint/check 全 PASS 带 kind） |
| AC-4 | `full_required_kinds=[]` → 跳过校验，行为同现状 | ✅ | echo-ok full + `[]` → REACHED_GOAL；纯函数 null/非数组防御亦覆盖 |
| **AC-5** | **echo-ok full + 配置要求 kinds → 不 REACHED_GOAL（CRITICAL-8 直证）** | ✅ | 精确复现漏洞 payload，前置断言 `evaluateMetric===true`（漏洞前提成立）再断言 `INCOMPLETE_FULL_VERIFY` |
| AC-6 | smoke + 任意 kind 配置 → 不受影响 | ✅ | smoke 走 escalate_full 分支，结构隔离 |
| AC-7 | config schema 三态（省略/合法/非法） | ✅ | `config-schema.test.mjs` 三用例 + effective-config 展示 |

**plan-code 对齐**: 默认 `[]` / decideStop 接入位置（evaluateMetric 为真后、REACHED_GOAL 前）/ INCOMPLETE_FULL_VERIFY 语义 / SKILL.md C-1/C-2/W-2 同步——全部一致。

## Layer 1.5: 验证证据（COMPLIANT — 实跑真实退出码）

主编排器**亲自实跑**（非子代理自报），真实命令 + 退出码：

| 命令 | 退出码 | 结果 |
|------|--------|------|
| `node --test goal-loop-core.test.mjs` | 0 | **163 pass / 0 fail**（F203 baseline 141 + 22 新 F204 用例） |
| `node --test config-schema.test.mjs` | 0 | **20 pass / 0 fail**（+6 schema/effective-config） |
| `npx vitest run` | 0 | **4912 pass / 0 fail**（425 文件；先 build 故无 e2e ordering 假阴性） |
| `npm run build` | 0 | tsc 零类型错误 |
| `npm run repo:check` | 0 | status=pass（含 `codex-wrapper-block-sync`，`.codex` 镜像零漂移） |
| `validate-config --show-effective` | 0 | dogfood `full_required_kinds` 解析为数组 `["build","test","lint","check"]`（非字符串，block-sequence 正确） |

## Layer 2: 通用插件约束

- **core 零硬编码命令名**：`validateFullCommandKinds` 只接受 `requiredKinds: string[]`（来自 config）；kind 枚举 `build|test|lint|check` 是语言无关抽象类别，非命令名。spec-review + quality-review 双确认。
- **向后兼容**：默认 `[]` → 校验短路跳过 → 现有无-kind fixture 与 11+ 引用用例零回归。

---

## 对抗审查总览（4 phase × Codex + 2 review 子代理）

| 审查 | 结论 | 处置 |
|------|------|------|
| Codex Phase1（诊断） | 1C+3W+2I | 全采纳并入 fix-report（默认值锁定 / 根因深化 / kind 措辞 / 接缝改定 / 验收 AC） |
| Codex Phase2（规划） | 4C+6W+2I | 全采纳并入 plan/tasks（**C-1 SKILL 接线空转** / C-2 escalate 二次路由 / C-3 类型守卫 / C-4 fixture 排序 / W-1~6） |
| Codex Phase3（实现） | 1C(by-design)+3W+2I | CRITICAL=对抗误标 by-design 残留（无改动）；W-1 变异守卫测试 / W-2 golden-text 锁定 / W-3 kind trim 归一——3W 全修 |
| spec-review | 7/7 AC，0C/0W | 无 over-claim，诚实残留充分；3 INFO 全非问题（1 误报 + 2 良性增强） |
| quality-review | GOOD，0C/2W/4I | INFO-4（DEFAULT_CONFIG 显式 `[]`）采纳；其余 2W/3I 为风格偏好，记录见下 |

### quality-review 风格项处置（CLAUDE.local.md：风格偏好→记录）

- **采纳**：INFO-4 — `DEFAULT_CONFIG` 显式加 `full_required_kinds: []`（测试自证 + 与 BUILTIN_DEFAULTS 对齐）。
- **不采纳（记录分歧理由）**：WARNING-2（JSDoc 残留说明应移出函数）——安全敏感 guard 的诚实残留**有意保留在代码处**，防未来维护者过度信任；codex Phase3 当 CRITICAL 提示可见性、spec-review 明确称赞此设计；plan/verify.md 亦有同步声明，非单点。
- **记录不改（风格偏好，避免对已验证绿提交无谓 churn）**：WARNING-1（decideStop 注释措辞）、WARNING-3（`normKind` 命名）、INFO-1（kind 枚举提常量）、INFO-2/3（注释精简/追踪标签）。

---

## 诚实残留风险（不 over-claim）

`validateFullCommandKinds` 是**对报告自报 `kind` 类别的机器强制完整性校验**，非硬结构不变量：
- **能挡**：遗漏 / 截断（verify 子代理漏跑 lint、输出被截断少命令）——这是把散文 mandate 升级为机器校验真正新增的保护。
- **不能挡**：对抗性自我误标（把 `echo ok` 标 `kind:'test'`）——`kind` 由 verify 子代理自报，与 exit_code 同源。此残留与既有 `dist_not_built` 校验同层级、与 F201 FR-023 残口（"无法阻止 implement 篡改测试本身"）同构，由人工 GATE_VERIFY + Codex 对抗审查兜底。
- **结论**：**显著缩小 CRITICAL-8 敞口，不声称完全消除**。声明一致存在于代码注释 / verify.md / plan / fix-report 四处。

---

## GATE_VERIFY 决策

- **behavior**: GATE_VERIFY 在 fix 模式为 `always`（人工收口强门禁）。
- **决策**: ✅ **PASS — READY FOR DELIVERY**。全部 acceptance 真实达成（非纸面）；零回归；3 轮对抗审查 + 2 独立 review 全处置；唯一 CRITICAL 为 by-design 已诚实披露残留。
- **人工收口**: 交付到 master 需用户明确授权（见交付报告）。

## 工具使用反馈（Dogfooding）

- **Spec Driver fix 流程**: 顺畅。TDD 红→绿分解 + 每 phase Codex 对抗审查 + Codex 处置溯源表，使每步红/绿判据明确，逐阶段 commit 干净。最大价值是 **Codex Phase2 C-1**（SKILL 接线空转）在规划阶段就被揪出——若到实现/验证才发现，修复成本高得多。
- **摩擦点**: (1) plan 假设的 inline-flow YAML（`['a','b']`）与仓库 simple-yaml parser 不兼容，实测才暴露，已就地改 block-sequence 并文档化此 parser 限制——属 plan 未预见的能力边界。(2) build/vitest/repo:check 反复再生 `specs/src.spec.md` 等 self-dogfood 产物，每次需 `git checkout` 还原 + 显式路径 commit，符合既有约定但增加手动步骤。
- **Spectra MCP**: 本次未调用——改动集中单模块（goal-loop-core + config-schema），引用完整性 Grep 即可闭合（已验 `INCOMPLETE_FULL_VERIFY`/`validateFullCommandKinds`/`full_required_kinds` 无遗漏消费方）；影响面已由 fix-report/plan 的 Codex 审查充分形式化。无 MCP 可用性/准确性问题可报。
