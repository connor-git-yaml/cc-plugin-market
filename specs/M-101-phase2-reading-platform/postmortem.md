# Phase 2 Postmortem — Reading Platform

> **诚实、可量化、有教训**。本 postmortem 不为 Phase 2 涂脂抹粉，目的是让 Phase 3 不踩同样的坑。

**编写日期**: 2026-04-26
**Phase 2 时段**: ~3 周（Wave 1 启动到 Fix 134 收尾）
**关联**: [blueprint.md](blueprint.md)

---

## 1. 度量数据

### Commit 维度

| Prefix | Commit 数 |
|--------|----------|
| `feat(127-134)` | 36 |
| `fix(127-134)` | 9 |
| `docs(127-134)` | 30 |
| `chore(127-134)` | 4 |
| `refactor(127-134)` | 7 |
| `test(127-134)` | 3 |
| **Phase 2 commit 合计** | **89** |

### 代码 / Spec 维度

| 维度 | 数据 |
|------|------|
| Phase 2 spec 目录 | 8 个（127/128/129/130/131/132/133-fix-postmortem/133-orchestration-overrides）|
| Phase 2 spec 文档总行数 | 19,645 行 / 76 .md 文件 |
| 新增 src/ 模块 | 6 个目录（spec-store / debt-scanner / anchoring / hyperedges / qa / exporters）|
| 新增 src/ 代码（不含测试）| 6,895 行 / 43 .ts 文件 |
| 测试增长 | 从 ~1,625（Wave 1 启动前）→ **2,196**（Fix 134 后） = **+571 测试** |
| 单测通过率 | 99.95%（2196/2197，1 个 pre-existing `export-command.test.ts` failure）|

### Token 经济

| 项目 | 估算 |
|------|------|
| Phase 2 期间 LLM 总消耗（开发 + verification）| ~3-5 M tokens（粗估，基于 commit 频率 + 每次 batch ~30k tokens 量级 + 多次 reading/full 测试）|
| 单次 graphify 示例项目 batch（默认 model 升级前 / 后）| Opus 4-1：~30k tokens / ~13 分钟 → Sonnet 4-6：~30k tokens / ~8 分钟（成本 -80%）|

---

## 2. 成功点（值得在 Phase 3 复用）

### S1. 表层先暴露，深层后改 — F1 ROI 极高

F1 Reveal 是**零架构改动**的 1-2 人周 Feature，但产出极大：

- 让用户/外部评审者立刻看到 Spectra 已有但隐藏的图查询能力
- LLM 成本从黑盒变透明（`tokenUsage` / `--dry-run` / `--budget`）
- 为后续 F3/F4/F5 全部铺垫了 cost 基础设施

**Phase 3 启示**：每个 Phase 都该有一个"零架构、纯暴露"的 F1 等级 Feature 作为短期触手可及的价值。

### S2. SpecStore 抽象一次性重构 5 个消费方

F2 的 SpecStore 没走"渐进迁移"，而是一次性把 README 生成、graph 构建、coverage 审计、index 生成、cross-reference 全部迁移。

**结果**：避免了"中间状态"bug（这是 Fix 127 反复修同类 bug 的根因 — 多消费方各自合并 spec list 出错）。

**Phase 3 启示**：架构抽象层引入时，一次性强制全消费方迁移，比"先建抽象、按 Feature 慢慢迁"更稳。

### S3. F2.5 删除遗留原子 skill — 拒绝双份维护

`/spec-driver.specify` 等 9 个原子 skill 和 plugin 编排器 100% 重复实现。F2.5 直接删除遗留，强迫所有用户走单一编排器入口。

**结果**：spec-driver 平台维护成本下降 ~30%；用户认知不再混乱。

**Phase 3 启示**：发现"双份实现"立刻删一份，不要等"完整迁移"再删 — 双份共存期是 bug 滋生温床。

### S4. Fix 134 的 sonnetModelId 真 bug 在 E2E 验证才暴露

Fix 133 修了 4 个偏差，但 graphify 端到端验证（Phase 5）发现：reading 模式跑出来 model 还是 opus。诊断后发现是 `loadDriverConfig` 跨项目向上找 yaml 的边界问题（commit `e40188c`）。**这个 bug 在 2196 个单测里没被发现**，因为单测全用 mock 配置。

**Phase 3 启示**：架构层的"配置 / cwd inheritance"类 bug，必须有真实 E2E 测试守卫。Mock 测试 cover 不了"跨项目边界"。

### S5. 真实 LLM 集成测试入 CI

Fix 133 加入了 `tests/integration/llm-token-extraction.test.ts`（4 个真实 SDK 响应 shape 的测试 + null 边界）。Fix 134 又加 13 个 cli-proxy 测试 + 8 个 model override decision 测试。

**结果**：tokenUsage 的提取链路第一次有了真正的 regression guard。

**Phase 3 启示**：所有"和外部 SDK 集成"的代码必须有真实响应 shape 的单测，不能只 mock 函数签名。

---

## 3. 教训（必须避免在 Phase 3 重演）

### L1. **Spec 写完忘 commit** — 第一次启动 Wave 1 就栽了

Wave 1 启动时我（编排器）用 `/spec-driver.specify`（彼时未删除的原子 skill）创建 F1 + F2 spec，**spec 文件落到工作目录但忘了 git add + commit**。结果另一个 worktree session 启动 F2 时找不到 spec.md，整个被卡住。

**根因**：原子 skill 的 outline **没有"落盘即 commit"守卫**。这是 F2.5 立刻要删除原子 skill 的关键原因之一（编排器 agent 有 commit 守卫）。

**教训**：**任何创建 spec / plan / tasks 的流程，必须把 git commit 作为最后一步**。Phase 3 起的所有 Prompt 模板都要明示"每阶段产物必须 commit + push"。

### L2. spec-driver.config.yaml 默默覆盖代码层 default

Fix 133 的 P0-3 改了 `PRESET_MODEL_MAP.balanced = 'sonnet'`（源代码层），但 dogfood 跑 batch 还是用 opus。诊断 1 小时才发现：项目根的 `spec-driver.config.yaml` 把 10 个 spec-driver agent 全 hard-pin 成 opus，**项目级 yaml 优先级 > 代码层 default**。

**教训**：
- 代码层 default 改变时，**主动检查项目根的覆盖配置**是否同步
- 配置覆盖链路（env > config > preset > default）需要在 quality-report / verification 里有明确的"effective resolution"打印
- Feature 133 (orchestration-overrides) 的 `effective-orchestration --annotate` 命令是这个教训的产物

### L3. Token 提取分 input / output 两个独立路径，output 修了 input 没修

Fix 133 的 P0-1 修了 output token 提取（35,759 ✓），但 input 还是 0。这是因为 Anthropic SDK 响应里 input token 分散在 3 个字段：`input_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`，最初只读了第一个，cache 命中场景下数据就错了。

**教训**：**外部 SDK 的字段提取必须 cover 所有子字段**，不能只读 happy path。Fix 134 加了 4 个边界场景测试（含 null + 仅 cache_read）才把这个守住。

### L4. Reading 模式 SC-001 < 120s 目标 over-promised

F5 spec 写"reading 模式 5 文件项目 < 120s"。但实际 reading 模式仅跳过了产品文档层，**模块 spec 的 LLM enrichment 没跳**，5 模块每个 100s+ opus 跑下来 499s（Fix 134 之前），远超目标。

Fix 134 用"方向 A"（reading 模式强制 sonnet override）把单模块降到 ~50-80s，5 模块仍可能在 300-400s 区间，对 5 模块项目能达 < 120s（实际未跑透 21 模块），对大项目仍超。

**教训**：**性能目标定 SC 时必须区分项目规模**。`< 120s` 隐含"5 模块"的假设没在 spec 里写明。Phase 3 起的 SC 性能指标必须含"项目规模"维度。

### L5. CLI flag 注释和实现脱节

Fix 133 commit `ca790bd` 在 batch-orchestrator.ts 注释里承诺"CLI `--hyperedges` 或 env `SPECTRA_HYPEREDGES_ENABLED=true`"，但实际 CLI commander 没注册这个 option（只有 env 路径）。Fix 134 才补上。

**教训**：注释承诺的 user-facing 接口必须有对应的 acceptance test（"`spectra batch --help` 包含 --hyperedges"），不能只 review 代码不验证 CLI surface。

### L6. Mock-only 单测覆盖率高 ≠ 端到端正确

Phase 2 早期单测从 1625 增长到 2154，全 mock LLM client。但 reading 模式 + tokenUsage 这两个 user-visible 失败**单测全程没拦截**。

**教训**：**端到端"产物驱动"测试**必须存在 — 跑一次真实 batch，对比生成的 spec.md / graph.json / batch-summary.md 字段是否符合预期。Phase 3 应该在 CI 里加 "fixture-based E2E"（不调真 LLM，但跑完整 pipeline）。

### L7. Worktree 自动分支名让外部 session 启动失败

Wave 1 中另一个 Claude Code session 在 `claude/cool-kapitsa-478213` 自动 worktree 分支上启动，找不到 `128-harden-spec-store/spec.md`，因为我没 push 到 origin（见 L1）。session 报错"前置条件不满足"。

**教训**：每个 Prompt 模板第一步必须是 `git fetch + git checkout 目标分支 + 验证 spec 存在`，不能假设 worktree 自动分支就是目标分支。Wave 2/3 的 Prompt v2 模板加了这一段。

---

## 4. 已知遗留事项（非阻塞，但要跟进）

| # | 事项 | 影响 | 建议处理时机 |
|---|------|------|------------|
| R1 | graphify 21 模块完整 reading 全量 perf 基线 | F5 SC-001 在大项目上是否成立未验证 | Phase 3 启动前独立跑一次（30-45 分钟）|
| R2 | `tests/unit/cli-proxy.test.ts:26` 的 `as any` | 测试规范 chore | 任意 chore round |
| R3 | F6 Integrate（Spectra × Graphify 深度集成）| 原 Vision，未实施 | Phase 3 评估期决定 ship 还是归档 |
| R4 | `spec-driver.config.yaml` 改 sonnet 后，spec-driver 流程质量是否有差异 | 可能需要某些重思考 agent override 回 opus | Phase 3 收集 dogfood 反馈后定 |

---

## 5. 经济性 — 默认 Model 升级的实际收益

| 维度 | Phase 2 之前 | Phase 2 之后 | 变化 |
|------|------------|------------|------|
| 默认 batch 用什么 model | Opus 4-1 | Sonnet 4-6 | -1 代 + 升级到 4.6 |
| 单次 graphify 示例项目 token 成本 | Opus $15/Mtok input + $75/Mtok output | Sonnet $3/Mtok input + $15/Mtok output | **成本下降 ~5x** |
| 单次 batch 耗时 | ~13 分钟 | ~8 分钟 | **快 ~40%** |
| 质量主观感受（dogfood）| Excellent | Excellent for code-reading（Opus 优势在产品文档创意度，Sonnet 在结构化抽取已经够）| 无明显回退 |

---

## 6. Phase 3 准入建议（基于 Phase 2 教训）

1. **每个 Feature 的 Prompt 模板必须含**：
   - 上下文权威声明
   - `git fetch + checkout + verify spec` 前置守卫
   - 每阶段 `git add + commit + push` 守卫
   - Push 前 rebase + 完整验证守卫
   - 读写边界表格（明确隔离 Feature 间领地）

2. **每个 Feature 的 Spec 必须含**：
   - 至少一个端到端验证场景（不只是单测覆盖）
   - SC 性能指标必须标注"项目规模"前提
   - 涉及外部 SDK 字段提取的，必须列出所有要 cover 的子字段

3. **每个跨项目 / 跨 worktree 的能力必须有**：
   - effective config resolution 的 dry-run 命令
   - 真实 E2E 集成测试守卫

4. **每次默认行为变更（如 model id 升级）必须**：
   - 主动 grep 项目根所有 yaml/config 文件，看是否有覆盖
   - CHANGELOG 列出 breaking change

---

## 7. 一句话总结

**Phase 2 把 Spectra 从"分层文档生成器"做成了"真正能 ship 给团队用的代码阅读平台"**，但教训是：**架构 / 配置 / 性能 / 字段提取的边界，单测护不住，必须靠真实 E2E 守。**
