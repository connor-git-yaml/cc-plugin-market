# 产研汇总: Feature 133 — Per-Project Workflow Overrides（分层 orchestration）

**特性分支**: `claude/wonderful-chatterjee-22066e`（worktree）
**汇总日期**: 2026-04-26
**输入**: [product-research.md](product-research.md) + [tech-research.md](tech-research.md)
**执行者**: 主编排器（非子代理，inline 模式）

> 两份调研在核心决策（方案 B / Mode 整段替换 / Zod fallback / source-aware dry-run / `.specify/orchestration-overrides.yaml` 命名）上高度共识，分歧主要在"全局字段覆盖是否纳入 MVP"和"YAML anchor 限制"，需要在 specify 阶段处理。

---

## 1. 产品×技术交叉分析矩阵

| MVP 功能 | 产品优先级 | 技术可行性 | 实现复杂度 | 综合评分 | 建议 |
|---------|-----------|-----------|-----------|---------|------|
| `.specify/orchestration-overrides.yaml` 加载（resolver 模式） | P0 | 高（直接复用 project-profile-resolver 范本） | 低（~180 行新文件） | ⭐⭐⭐ | 纳入 MVP |
| Mode 整段重写（modes.<mode>.phases 整体替换） | P0 | 高（语义已锁定，无歧义） | 低（合并函数 modes 字段直接替换） | ⭐⭐⭐ | 纳入 MVP |
| Gate 行为字段级覆盖（behavior / severity / hard_gate_modes） | P0 | 高（对象字段合并，已有范本） | 低 | ⭐⭐⭐ | 纳入 MVP |
| Zod schema + safeParse + 失败回退 base + warning diagnostic | P0 | 高（zod ^3.24.1 已在 deps，createDiagnostic 已是统一形态） | 低 | ⭐⭐⭐ | 纳入 MVP |
| CLI `effective-orchestration --mode <mode>` + `--annotate` source map | P0 | 高（orchestrator-cli.mjs switch 追加 1 case） | 低（~30 行） | ⭐⭐⭐ | 纳入 MVP |
| 全局字段覆盖（parallel_scheduling.max_concurrent_tasks 等） | P1 | 高（与 gate 同款对象合并） | 低 | ⭐⭐⭐ | **纳入 MVP**（产品调研追加） |
| Schema 沉淀 contracts/ + 纳入 repo:check | P0 | 高（repo-maintenance-core 追加 3 行 aggregateValidation） | 低 | ⭐⭐⭐ | 纳入 MVP |
| 共享文档片段（docs/shared/agent-orchestration-overrides.md → AGENTS/CLAUDE） | P1 | 高（已有 docs:sync:agents 管道） | 低 | ⭐⭐⭐ | 纳入 MVP |
| 示例 overrides（fix 模式裁剪 + gate behavior 调整） | P0 | 高 | 低 | ⭐⭐⭐ | 纳入 MVP |
| Phase patch（按 id 局部 patch 单 phase） | P2 | 中（合并函数需特殊化处理） | 中 | ⭐ | **二期，schema 预留扩展点** |
| Mode `extends` 派生（modes.fix-strict 基于 fix 派生） | P2 | 中 | 中 | ⭐ | 二期，schema 预留 |
| 并行组覆盖（parallel_groups.* 内成员调整） | P2 | 中 | 中 | ⭐ | 二期 |
| Prompt 级覆盖（.specify/agents/<phase>.append.md） | P2 | 高 | 低 | ⭐ | **辅助方案 B，独立 Feature** |
| 子项目级 override（monorepo 子包独立） | P2 | 中（projectRoot 多值检索） | 中 | ⭐ | 二期 |

**评分说明**：⭐⭐⭐ 高优先 + 高可行 + 低复杂度 → 纳入 MVP；⭐⭐ 中等匹配 → 视资源；⭐ 推迟。

---

## 2. 可行性评估

### 技术可行性

整体可行性高。三个关键事实支撑这一判断：

1. **现成范本**：`project-profile-resolver.mjs` 是完整的"yaml + 校验 + fallback + diagnostic + fieldSources"范本，本 Feature 的 `lib/orchestration-resolver.mjs` 可以 1:1 镜像该模式
2. **零侵入接入**：所有 8 个 SKILL.md 都通过 `orchestrator-cli.mjs` 间接调用编排器，CLI 一处改造即可让全部模式自动感知 overrides；`Orchestrator` 构造函数签名 `(userConfig, mode, context)` 保持不变
3. **零新依赖**：`zod ^3.24.1` 已在 `package.json:57`，`simple-yaml.mjs` 已是仓库内 YAML 解析标准；deepMerge 仓库无现成工具，但语义复杂度（modes 替换 / gates 字段合并）反而支持手写 40-50 行专用函数而非引入 lodash

### 资源评估

- **预估工作量**：新增约 480 行（3 个新源文件 + 1 个测试文件 + 1 个合同文件），小改约 33 行（2 个现有文件），无需改动 10+ 个文件
- **关键技能需求**：Node.js ESM、zod schema 设计、单元测试（仓库现用 `node:test`，与 vitest 并存——见风险 R5）
- **外部依赖**：无新增

### 约束与限制

- 仓库已立 Project Context 边界（`EXCLUDED_EXECUTION_FIELDS` + `forbidden_changes`），执行策略不进 `.specify/project-context.yaml`，本 Feature 必须新增独立文件而非膨胀现有配置
- `simple-yaml.mjs` 不支持 YAML anchor / merge key（`<<:`），不提供行号——直接影响 overrides 文件作者的调试体验
- `validateOrchestrationYaml()`（`lib/orchestrator.mjs:188-210`）是手写校验，与新 Zod schema 形态不一致，需要在 spec.md 明确两者协作语义（base 走手写校验做快速失败，merged config 走 Zod 做精确校验）
- 仓库测试文件 `orchestrator.test.mjs` 用 `node:test` 而非仓库规范的 vitest，本 Feature 倾向跟随既有形态，避免在本 Feature 中重构整套测试基础设施

---

## 3. 风险评估

### 综合风险矩阵

| # | 风险 | 来源 | 概率 | 影响 | 缓解策略 | 状态 |
|---|------|------|------|------|---------|------|
| R1 | Mode 整段替换语义不直觉——用户期望"只覆盖几个字段"却被迫重抄整个 phases 数组 | 产品 + 技术 | 高 | 高 | spec.md 显式定义；CLI dry-run 默认 + 完整示例文档；二期 phase patch 留扩展位 | 待监控 |
| R2 | `simple-yaml.mjs` 不提供行号，overrides 校验失败时调试体验差 | 技术 | 中 | 中 | Zod 错误信息内嵌字段路径（`modes.fix.phases[1].id`）作为定位替代；文档说明此限制 | 已识别 |
| R3 | `repo-maintenance-core.mjs` 是核心同步链路，追加新校验器若接口不一致会让全量 `repo:check` 中断 | 技术 | 低 | 高 | 严格遵循 `{ status, checks, warnings, errors }` 接口；同 PR 补回归测试 | 已识别 |
| R4 | Override 漂移——用户覆盖某 mode 后无法享受 plugin 升级带来的修复 | 产品 | 中 | 中 | dry-run `--annotate` 标记每个字段来源（base / overrides），用户可定期 review | 已识别 |
| R5 | 测试框架不一致（`node:test` vs vitest 混用）可能让 CI 漏跑新测试 | 技术 | 中 | 中 | 跟随 `orchestrator.test.mjs` 的 `node:test` 形态；同时验证 `vitest run` 也能识别 | 已识别 |
| R6 | 用户写入非法 overrides 把工具搞崩 | 产品 | 中 | 高 | fallback to base + warning diagnostic（不静默丢弃，不 fail-loudly 阻塞） | MVP 设计已覆盖 |
| R7 | 命名冲突——用户在 overrides 自定义 mode 名意外覆盖 base mode | 产品 | 低 | 中 | Zod schema 对 mode 名做 enum 校验（base mode reserved list） | 待 specify 阶段决定 |
| R8 | `validateOrchestrationYaml()` 与 Zod schema 双校验链可能产生不一致错误 | 技术 | 低 | 中 | 明确分工：base config 走手写校验先失败；merged config 走 Zod 做最终校验 | 待 plan 阶段细化 |
| R9 | Worktree 场景下 `.specify/orchestration-overrides.yaml` 是否纳入 git 跟踪 | 技术 | 低 | 低 | 默认纳入（项目级长期配置），与 `.specify/project-context.yaml` 保持一致 | 已确认 |
| R10 | 子项目级 override 误期望（monorepo 用户期望 packages/*/orchestration-overrides.yaml） | 产品 | 中 | 低 | spec.md 明确声明 V1 只支持仓库级粒度；二期路线图保留 | 已识别 |

### 风险分布

- **产品风险**: 5 项（高:1 中:3 低:1）
- **技术风险**: 5 项（高:0 中:3 低:2）
- **共识高优先级风险**: R1（Mode 替换语义）、R3（repo:check 回归）、R6（非法 overrides 不能搞崩工具）

---

## 4. 最终推荐方案

### 推荐架构

**方案 B — Wrapper / Factory 函数**：新增 `plugins/spec-driver/lib/orchestration-resolver.mjs`，导出 `resolveOrchestrationConfig({ projectRoot, mode })`，纯函数返回 `{ mergedConfig, fieldSources, diagnostics, isFallback }`。

加载序：

```
plugin base (orchestration.yaml)
  → 读 .specify/orchestration-overrides.yaml（可选，存在则解析）
  → 深合并（modes 替换 / gates 字段合并 / 全局字段对象合并）
  → Zod schema safeParse
  → 校验失败：忽略 overrides，使用 base + 输出 warning diagnostic
  → 校验通过：使用 mergedConfig + 输出 info diagnostic（哪些字段被覆盖）
  → fieldSources 记录每个 canonical 路径来源
  → 返回供 Orchestrator 构造或 CLI dry-run 消费
```

`Orchestrator` 构造函数签名不变；`orchestrator-cli.mjs` 在每个命令前先调 resolver 拿 mergedConfig，再传入 `new Orchestrator(mergedConfig.userConfig, mode, ctx)`。

### 推荐技术栈

| 类别 | 选择 | 理由 |
|------|------|------|
| Schema 校验 | `zod ^3.24.1`（已在 deps） | 与 `config-schema.mjs` 风格一致；safeParse 天然支持 fallback |
| YAML 解析 | `simple-yaml.mjs`（仓库内置） | 已验证能解析 orchestration.yaml 规模；不引入新依赖 |
| 深合并 | 手写 `mergeOrchestrationConfigs()`（~40-50 行） | 数组语义复杂（modes 替换 / hard_gate_modes 替换）需要专用控制；通用 lodash.merge 反而风险 |
| Diagnostic | 复用 `createDiagnostic(level, code, message)` | 仓库统一形态（`project-profile-resolver.mjs:11`） |
| 测试框架 | `node:test`（跟随 `orchestrator.test.mjs`） | 避免在本 Feature 中重构测试基础设施；vitest 兼容性单独验证 |
| 文件命名 | `.specify/orchestration-overrides.yaml` | 对标 `docker-compose.override.yml` 业界惯例；与 `.specify/` 下 kebab-case 一致 |

### 推荐实施路径

1. **Phase 1（MVP）**：
   - `lib/orchestration-resolver.mjs`（合并 + 校验 + fieldSources + diagnostics）
   - `contracts/orchestration-overrides-schema.mjs`（Zod schema，预留 `$schema_version` / `extends` 扩展位）
   - `scripts/orchestrator-cli.mjs` 追加 `effective-orchestration` 命令
   - `scripts/validate-orchestration-overrides.mjs` + `repo-maintenance-core.mjs` 校验集成
   - `tests/orchestration-resolver.test.mjs`（合并 / 降级 / CLI 三类）
   - 文档与示例：`contracts/orchestration-overrides-contract.yaml`、`docs/shared/agent-orchestration-overrides.md`、`.specify/project-context.yaml` `forbidden_changes` 旁注

2. **Phase 2（二期，独立 Feature）**：Phase patch、Mode `extends` 派生、并行组覆盖、子项目级 override

3. **Phase 3（远期）**：Prompt 级 `.specify/agents/<phase>.append.md`、override 版本锁定、可视化 diff

---

## 5. MVP 范围界定

### 最终 MVP 范围

**纳入**：

- ✅ **加载与解析**：`.specify/orchestration-overrides.yaml` 存在则读取，使用 simple-yaml 解析
- ✅ **Mode 整段重写**：overrides 中 `modes.<mode>` 出现则**整段替换** base 同名 mode（包括 phases 数组）
- ✅ **Gate 行为字段级覆盖**：overrides 中 `gates.<GATE_ID>` 字段（`default_behavior` / `severity` / `hard_gate_modes`）做对象级合并
- ✅ **全局字段覆盖**：`parallel_scheduling.max_concurrent_tasks` 等顶层标量字段后者覆盖前者
- ✅ **Zod schema 校验**：merged config 走 Zod safeParse；新建 `orchestrationOverridesSchema`（约 100 行）
- ✅ **降级策略**：校验失败 → 忽略 overrides → 使用 base config + 输出 `warning` 级 diagnostic（code: `orchestration-overrides.schema-fallback`）
- ✅ **CLI dry-run**：`orchestrator-cli.mjs effective-orchestration <mode>` 输出 merged config；`--annotate` 标记每字段来源；`--diff` 仅显示覆盖差异；`--format yaml|json` 切换格式
- ✅ **fieldSources source map**：粒度为 Mode 级（`modes.feature`）+ Gate 级（`gates.GATE_DESIGN`），不细到 phase 数组元素
- ✅ **Schema 合同沉淀**：`contracts/orchestration-overrides-schema.mjs`（Zod）+ `contracts/orchestration-overrides-contract.yaml`（人读说明）
- ✅ **repo:check 集成**：`validate-orchestration-overrides.mjs` 校验器，纳入 `repo-maintenance-core.validateRepository()`
- ✅ **文档与示例**：示例 overrides 文件（fix 模式裁剪 + gate behavior 调整）；`docs/shared/agent-orchestration-overrides.md` 共享片段；`.specify/project-context.yaml` `forbidden_changes` 列表追加旁注

**排除（明确不在 MVP）**：

- ❌ Phase patch（按 phase id 局部 patch 单个字段）—— 数组合并语义复杂，留二期
- ❌ Mode `extends` 派生（基于 base mode 派生新 mode）—— schema 预留 `$schema_version` 和 `extends` 字段位置
- ❌ 并行组覆盖（`parallel_groups.RESEARCH_GROUP.members` 调整）
- ❌ Prompt 级覆盖（属辅助方案 B，独立 Feature）
- ❌ 子项目级 override（monorepo `packages/*/orchestration-overrides.yaml`）
- ❌ 任何对 plugin 内 `orchestration.yaml` / `agents/` / `SKILL.md` 的反向修改

### MVP 成功标准

- **S1**：项目放置一份合法的 `.specify/orchestration-overrides.yaml`（fix 模式整段重写 + GATE_DESIGN behavior 调整），运行 `node scripts/orchestrator-cli.mjs get-phases fix` 返回的 phase 序列与 overrides 一致
- **S2**：`node scripts/orchestrator-cli.mjs effective-orchestration fix --annotate` 输出含 `_source: base|overrides` 注释的 merged config
- **S3**：故意写入非法 overrides（schema 不匹配），运行任意编排命令时降级到 base + 输出 `[warning]` 级 diagnostic，进程不退出非零
- **S4**：`npm run repo:check` 既能识别合法 overrides，也能对非法 overrides 输出明确报错指引（不破坏现有校验链路）
- **S5**：`tests/orchestration-resolver.test.mjs` 三类测试通过：base+override 合并、schema 校验失败降级、CLI dry-run 输出格式
- **S6**：`spec-driver-{feature,story,fix,implement,refactor,resume,sync,doc}` 8 个 SKILL.md 自动感知 overrides，无需任何 SKILL.md 文件修改

---

## 6. 结论

### 综合判断

本 Feature 在产品方向（业界共识 + 用户场景验证充分）、技术方案（现成范本 + 零新依赖 + 零侵入接入）、MVP 范围（聚焦两类粒度 + 演进路径预留）三个维度都达到高置信度。**核心实施风险只有一个：Mode 整段替换语义对用户的直觉冲击**——这一点必须在 spec.md 中显式定义、文档示例中反复强化、dry-run 输出中实时呈现。其他风险均有现成缓解路径（fallback + diagnostic + 既有范本）。

### 置信度

| 维度 | 置信度 | 说明 |
|------|--------|------|
| 产品方向 | **高** | 9 个对标产品均已进入"plugin + project override"模式；用户场景 6 个具体且互不重复 |
| 技术方案 | **高** | `project-profile-resolver.mjs` 是 1:1 镜像范本；`Orchestrator` 构造函数零修改；零新依赖 |
| MVP 范围 | **高** | 8 项纳入项 + 5 项明确排除，分界清晰；演进路径已为二期/三期预留扩展点 |

### 后续行动建议

1. 进入 **Phase 2 specify**：将本汇总文档作为输入，产出结构化 `spec.md`，特别明确：
   - 数组合并语义（Mode 整段替换、phases / hard_gate_modes 替换、gates 对象字段合并）
   - 降级策略的精确语义（YAML 语法错误 / Zod 校验失败 / base 不可读三种情形分别处理）
   - CLI 子命令的输入输出契约（`--annotate` / `--diff` / `--format` 的精确行为）
   - fieldSources 粒度边界（Mode 级 / Gate 级，不下钻到 phase 数组元素）
   - 二期 schema 扩展位（`$schema_version` / `modes.<m>.extends` / `phase[].extends`）
2. 在 **Phase 4 plan** 阶段再做一次 `validateOrchestrationYaml()` 与 Zod schema 双校验链路的精确分工设计
3. 在 **Phase 7c verify** 阶段必须执行真实的 base+override 合并 / 降级 / CLI / `repo:check` 端到端验证，不接受单元测试通过即认为完成
