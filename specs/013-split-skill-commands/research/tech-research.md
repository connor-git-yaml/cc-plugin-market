# 技术调研报告: 拆分 Speckit Driver Pro 技能命令

**特性分支**: `013-split-skill-commands`
**调研日期**: 2026-02-15
**调研模式**: 在线
**产品调研基础**: [product-research.md](product-research.md)

## 1. 调研目标

**核心问题**:
- SKILL.md frontmatter 的最佳配置策略：`description` 对自动触发的影响、`disable-model-invocation` 在三个技能上的差异化设置
- 共享逻辑的引用机制：三个技能共用的初始化逻辑如何在 Markdown 层面复用
- Claude Code 对 Plugin 技能命名的限制验证：run、resume、sync 是否合法且不与内置命令冲突
- 旧技能目录的安全删除策略

**产品 MVP 范围（来自产品调研）**:
- 创建 `skills/run/SKILL.md`：包含主编排器的 10 阶段工作流
- 创建 `skills/resume/SKILL.md`：包含中断恢复机制
- 创建 `skills/sync/SKILL.md`：包含产品规范聚合模式
- 删除 `skills/speckit-driver-pro/SKILL.md`：移除旧的单体技能文件
- 每个 SKILL.md 配置正确的 frontmatter

## 2. 架构方案对比

### 方案对比表

| 维度 | 方案 A: 完全独立拆分 | 方案 B: 主技能 + 引用拆分 | 方案 C: 共享引用层拆分 |
|------|-------------------|------------------------|---------------------|
| 概述 | 三个 SKILL.md 各自包含完整的独立逻辑，无文件引用依赖 | 保留一个精简主技能（run）作为入口，resume/sync 独立但引用主技能中的共享部分 | 三个 SKILL.md 独立，但共用初始化和配置逻辑提取到 `_shared/` 引用目录 |
| 内容重复度 | 高 — 初始化阶段（约 60 行）在 run 和 resume 中重复 | 中 — 共享逻辑在主技能中，resume/sync 通过链接引用 | 低 — 共享逻辑集中在引用文件中 |
| 上下文效率 | 最优 — 每个技能仅加载自身内容，无额外引用文件开销 | 中等 — resume/sync 可能触发额外文件读取 | 中等 — 引用文件按需加载，但增加一次 Read 调用 |
| 实现复杂度 | 最低 — 纯文本拷贝+裁剪，无文件间依赖 | 中等 — 需设计引用点和引用格式 | 较高 — 需设计 `_shared/` 目录结构和引用协议 |
| 可维护性 | 中等 — 共享逻辑变更需同步更新 2-3 个文件 | 较好 — 共享逻辑单点维护 | 最好 — 共享逻辑单点维护，职责分离最清晰 |
| 与 Claude Code 平台兼容性 | 最高 — 完全符合 Plugin skills 规范，无特殊约定 | 高 — 技能间链接引用是平台支持的模式 | 高 — `_shared/` 目录非技能目录（无 SKILL.md），不会被注册为命令 |
| MVP 适配性 | 最优 — 最快实现，最低风险 | 中等 — 需额外设计引用机制 | 低 — 属于 Nice-to-have 范畴（产品调研明确归类） |

### 推荐方案

**推荐**: 方案 A — 完全独立拆分

**理由**:
1. **最低实现风险**：纯 Markdown 文本的拆分和裁剪操作，不涉及任何文件间引用机制的设计，出错概率接近零
2. **最优上下文效率**：每个技能文件自包含，Claude 加载时无需额外 Read 调用来获取引用文件，符合产品调研中"上下文预算优化"的核心目标
3. **与产品 MVP 范围精确对齐**：产品调研将"共享工具模块"明确归类为 Nice-to-have（二期），MVP 应聚焦于拆分本身而非复用优化
4. **适度重复可接受**：实际需要重复的内容主要是初始化阶段的环境检查和配置加载逻辑（约 60 行），且 run 和 resume 的初始化存在差异（resume 需额外的制品扫描逻辑），并非完全相同
5. **为后续演进保留空间**：方案 A 不排斥未来向方案 C 演进——当维护成本证明共享引用层有价值时，可在二期实施

**方案 B 淘汰理由**：违反了拆分的核心意图（职责独立），resume/sync 对主技能的引用依赖使它们在逻辑上仍然耦合。此外，`disable-model-invocation` 差异化设置要求每个技能的上下文加载路径完全独立。

**方案 C 延期理由**：产品调研已明确将共享逻辑提取归入 Nice-to-have。在 MVP 阶段引入 `_shared/` 目录增加了不必要的设计复杂度，且目前仅有约 60 行重复内容，维护成本可控。

## 3. 依赖库评估

### 评估矩阵

| 库名 | 用途 | 版本 | 是否需要 | 评级 |
|------|------|------|---------|------|
| 无 | — | — | — | — |

### 推荐依赖集

**核心依赖**: 无新增

本需求为**纯 Markdown 文件重构**，不涉及任何 TypeScript/Node.js 代码变更，因此无需引入新的运行时或开发依赖。

所有操作均在文件系统层面完成：
- 创建三个新目录：`skills/run/`、`skills/resume/`、`skills/sync/`
- 在每个目录中创建 `SKILL.md` 文件
- 删除旧目录 `skills/speckit-driver-pro/`

### 与现有项目的兼容性

| 现有依赖/组件 | 兼容性 | 说明 |
|--------------|--------|------|
| `agents/*.md`（12 个子代理 prompt） | 完全兼容 | 子代理 prompt 位于 `agents/` 目录，与 `skills/` 完全独立。拆分不影响任何子代理的内容和引用路径 |
| `scripts/init-project.sh` | 完全兼容 | 初始化脚本通过相对路径引用 Plugin 根目录，不依赖 skills 目录结构 |
| `hooks/hooks.json` | 完全兼容 | SessionStart hook 引用 `./scripts/postinstall.sh`，不涉及 skills 目录 |
| `templates/*.md` | 完全兼容 | 模板文件通过 SKILL.md 中的路径引用，拆分后每个 SKILL.md 使用相同路径（`plugins/speckit-driver-pro/templates/...`） |
| `.claude-plugin/plugin.json` | 完全兼容 | Plugin manifest 不包含 skills 列表，Claude Code 自动发现 `skills/*/SKILL.md` |
| `spec-driver.config.yaml`（配置模板） | 完全兼容 | 配置文件由 SKILL.md 中的逻辑读取，拆分后 run 和 resume 各自独立读取同一配置文件 |

## 4. 设计模式推荐

### 推荐模式

1. **Strangler Fig 模式（绞杀者模式）**：
   - **适用场景**：从单体 SKILL.md 迁移到三个独立技能
   - **应用方式**：先创建三个新技能目录并验证功能正确，确认后再删除旧的 `speckit-driver-pro/` 目录。这样在迁移过程中新旧技能短暂共存，降低回滚风险
   - **理由**：行业主流 CLI 重构方法论（oclif 文档明确推荐），且 Claude Code 的 Plugin 自动发现机制支持新旧技能同时存在

2. **单一职责原则（SRP）在 Prompt 工程中的应用**：
   - **适用场景**：每个 SKILL.md 的职责边界划分
   - **应用方式**：
     - `run/SKILL.md`：仅包含 10 阶段编排流程、初始化、模型选择、失败重试、选择性重跑
     - `resume/SKILL.md`：仅包含中断恢复逻辑（制品扫描 + 恢复点确定 + 初始化 + 恢复执行）
     - `sync/SKILL.md`：仅包含产品规范聚合流程（扫描 + 聚合 + 报告）
   - **理由**：每个技能文件对应一个清晰的用户意图，description 字段能精确描述其功能，提升 Claude 的自动触发准确性

3. **渐进式披露（Progressive Disclosure）**：
   - **适用场景**：每个 SKILL.md 内部的信息组织
   - **应用方式**：SKILL.md 保持精简的核心流程描述，详细的模板和参考资料通过文件路径引用（如 `plugins/speckit-driver-pro/templates/...`），Claude 按需 Read
   - **理由**：Claude Code 的技能加载策略为"frontmatter 先行，body 按需"，精简的 SKILL.md 减少上下文预算占用

### 应用案例

**oclif CLI 框架的 Plugin 化迁移**：Salesforce CLI 从单体命令架构迁移到 oclif 插件系统时，采用 Strangler Fig 模式——先在新插件中实现子命令，验证无误后删除旧命令入口。这与本需求的迁移策略高度一致。

**Claude Code 官方 Skill 最佳实践**：官方文档建议将 SKILL.md 控制在 1,500-2,000 words 以内（约 200-300 行），超过此范围的内容应提取到 `reference.md`、`examples.md` 等辅助文件。当前 706 行的单体 SKILL.md 明显超出此建议范围，拆分后每个技能文件预计在 150-350 行之间，完全符合最佳实践。

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | **`run`、`resume`、`sync` 与内置命令冲突** — 这三个名称可能与 Claude Code 内置命令或其他 Plugin 技能冲突 | 低 | 高 | **已验证**：Claude Code 官方文档确认 Plugin 技能使用 `plugin-name:skill-name` 命名空间（如 `speckit-driver-pro:run`），不会与内置命令（`/help`、`/compact` 等）或用户自定义技能冲突。`run`、`resume`、`sync` 不在已知保留名列表中 |
| 2 | **初始化逻辑遗漏** — resume 技能需要包含完整的初始化流程（环境检查、配置加载、prompt 来源映射），拆分时可能遗漏关键步骤 | 中 | 高 | 在拆分实现阶段，逐行对照原始 SKILL.md 的初始化阶段（L36-L97），确保 run 和 resume 各自包含必要的初始化步骤。resume 需额外包含制品扫描逻辑，但不需要"特性目录准备"（因为目录已存在） |
| 3 | **选择性重跑归属歧义** — `--rerun <phase>` 在语义上属于 run 的变体（重新执行特定阶段），但也可视为 resume 的一种形式（基于已有制品继续） | 中 | 中 | **设计决策**：将 `--rerun` 归入 `run` 技能。理由：rerun 需要完整的编排流程上下文（10 阶段定义、质量门），这些在 run 中已包含。resume 聚焦于"从中断处继续"的单一场景，不应承担重跑逻辑 |
| 4 | **description 字段措辞不当导致误触发** — sync 技能的 description 如果包含"规范"、"聚合"等泛化词汇，可能在用户讨论无关话题时被 Claude 自动加载 | 中 | 低 | 为每个技能精心设计 description，使用具体动作词：run 用"执行 Spec-Driven Development 完整研发流程"，resume 用"恢复中断的 Speckit 研发流程"，sync 用"聚合功能规范为产品级活文档"。对 run 设置 `disable-model-invocation: true` 防止意外触发 |
| 5 | **向后兼容中断** — 删除 `skills/speckit-driver-pro/` 后，用户键入 `/speckit-driver-pro` 将无法触发任何技能 | 低 | 低 | Plugin 尚未广泛分发（仅存在于当前代码仓库），影响范围极小。在 README 和 Plugin 变更日志中说明迁移路径：`/speckit-driver-pro` -> `/speckit-driver-pro:run` |
| 6 | **上下文预算节省不如预期** [推断] | 低 | 低 | Claude Code 可能在 `/` 菜单展示时预加载所有技能的 description（而非 body），此时拆分的上下文节省主要来自 body 而非 description。但即使预算节省有限，命令可发现性和语义清晰度的改进仍然成立 |

## 6. 产品-技术对齐度

### 覆盖评估

| MVP 功能 | 技术方案覆盖 | 说明 |
|---------|-------------|------|
| 创建 `skills/run/SKILL.md` | 完全覆盖 | 方案 A 直接支持。内容来源：原 SKILL.md 的 L1-L97（标题+初始化）、L99-L489（工作流+完成报告）、L580-L609（失败重试）、L642-L706（重跑+模型选择+进度映射）。预计约 350 行 |
| 创建 `skills/resume/SKILL.md` | 完全覆盖 | 方案 A 直接支持。内容来源：精简的标题和 description + 初始化阶段（环境检查+配置加载+prompt 映射，约 50 行）+ L610-L638（中断恢复机制，约 30 行）+ 恢复后执行流程引用。预计约 150 行 |
| 创建 `skills/sync/SKILL.md` | 完全覆盖 | 方案 A 直接支持。内容来源：精简的标题和 description + L493-L577（聚合模式，约 85 行）。预计约 120 行 |
| 删除 `skills/speckit-driver-pro/SKILL.md` | 完全覆盖 | 直接 `rm -rf skills/speckit-driver-pro/`。已验证不影响 agents/、hooks/、scripts/、templates/ |
| 每个 SKILL.md 配置正确的 frontmatter | 完全覆盖 | 见下文"Frontmatter 配置方案" |

### Frontmatter 配置方案

基于 Claude Code 官方文档和最佳实践，推荐以下 frontmatter 配置：

#### `skills/run/SKILL.md`

```yaml
---
name: run
description: "执行 Spec-Driven Development 完整研发流程（10 阶段编排：调研-规范-规划-实现-验证）"
disable-model-invocation: true
---
```

**设计决策**：
- `disable-model-invocation: true`：run 是重量级编排流程（10 阶段），不应被 Claude 基于对话内容自动触发，必须由用户通过 `/speckit-driver-pro:run` 显式调用
- `description` 强调"完整研发流程"和"10 阶段"，帮助用户在 `/` 菜单中快速理解其功能范围

#### `skills/resume/SKILL.md`

```yaml
---
name: resume
description: "恢复中断的 Speckit 研发流程 — 扫描已有制品并从断点继续编排"
disable-model-invocation: true
---
```

**设计决策**：
- `disable-model-invocation: true`：resume 涉及已有制品的扫描和流程恢复，自动触发可能导致意外重跑
- `description` 使用"中断"和"恢复"关键词，与 run 的"完整流程"形成语义区分

#### `skills/sync/SKILL.md`

```yaml
---
name: sync
description: "聚合功能规范为产品级活文档 — 将 specs/ 下的增量 spec 合并为 current-spec.md"
disable-model-invocation: false
---
```

**设计决策**：
- `disable-model-invocation: false`（默认值）：sync 是轻量级操作（3 步流程），且在用户讨论"规范聚合"、"产品文档同步"等话题时自动触发是合理的用户体验
- 产品调研建议 sync 可考虑允许自动触发，以支持"渐进式功能发现"
- `description` 包含具体技术术语（"specs/"、"current-spec.md"），提高触发精确度

### 扩展性评估

方案 A 完全支持产品调研中的 Nice-to-have 和 Future 功能扩展：

| 扩展功能 | 技术可行性 | 说明 |
|---------|-----------|------|
| 共享工具模块（`_shared/`） | 可行 | 在 `skills/` 下创建 `_shared/` 目录（无 SKILL.md），存放 `init-reference.md` 等引用文件。由于该目录不含 SKILL.md，Claude Code 不会将其注册为技能命令 |
| 命令别名支持 | 不可行（平台限制）[推断] | Claude Code Plugin 规范未提供技能别名机制。`/speckit-driver-pro` 作为命令需要对应的 `skills/speckit-driver-pro/SKILL.md`，与旧目录冲突。替代方案：在 README 中说明迁移路径 |
| 交叉引用提示 | 可行 | 在每个 SKILL.md 末尾添加"相关命令"段落，提示用户可用的其他技能 |
| 技能间编排协议 | 可行 | 各技能读写同一 feature 目录下的制品文件（spec.md、tasks.md 等），天然形成文件系统级的数据交换 |
| 新增技能 | 可行 | 直接在 `skills/` 下创建新目录即可，如 `skills/verify/SKILL.md` |

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| 写操作仅限 `plugins/speckit-driver-pro/skills/` 目录 | 完全兼容 | 所有文件创建和删除操作均在 `plugins/speckit-driver-pro/skills/` 目录内进行 |
| 不可直接修改源代码 | 完全兼容 | 本需求为纯 Markdown 文件操作，不涉及 TypeScript/JavaScript 源代码 |
| 中文散文 + 英文技术术语 | 完全兼容 | SKILL.md 文件遵循现有的双语规范 |

## 7. 结论与建议

### 总结

技术调研充分验证了产品调研的 MVP 方案在技术上完全可行且风险极低：

1. **方案选型明确**：推荐方案 A（完全独立拆分），这是实现成本最低、上下文效率最优、与平台兼容性最高的方案。共享引用层的优化（方案 C）可延期至二期
2. **零新增依赖**：纯 Markdown 文件重构，不涉及任何代码变更或依赖引入
3. **命名无冲突**：已验证 `run`、`resume`、`sync` 在 Claude Code Plugin 命名空间下合法且不冲突
4. **Frontmatter 策略清晰**：run 和 resume 设置 `disable-model-invocation: true`（防止重量级流程被自动触发），sync 允许自动触发（轻量级操作，支持渐进式发现）
5. **删除策略安全**：旧的 `skills/speckit-driver-pro/` 目录删除不影响 Plugin 的 agents/、hooks/、scripts/、templates/ 等组件
6. **共享逻辑重复可控**：run 和 resume 的初始化逻辑约 60 行重复，且两者的初始化存在差异（resume 需制品扫描），适度重复是合理的

### 行数分布预估

| 技能 | 预估行数 | 占原 706 行比例 | 主要内容 |
|------|---------|---------------|---------|
| `run/SKILL.md` | ~350 行 | ~50% | 标题+初始化+10 阶段编排+完成报告+失败重试+重跑+模型选择+进度映射 |
| `resume/SKILL.md` | ~150 行 | ~21% | 标题+精简初始化+中断恢复机制+恢复执行流程 |
| `sync/SKILL.md` | ~120 行 | ~17% | 标题+聚合模式完整流程 |
| 初始化重复 | ~60 行 | ~8.5% | run 和 resume 共有的环境检查+配置加载 |

### 内容归属决策

以下为原 SKILL.md 中各功能段落的归属分配：

| 原始段落 | 行范围 | 归属 | 理由 |
|---------|--------|------|------|
| 标题和角色描述 | L1-L3 | run（裁剪版）| 三个技能各有独立标题 |
| 触发方式 | L5-L13 | 拆分到各技能 | 每个技能仅保留自身的触发命令 |
| 输入解析 | L15-L33 | run（含 --rerun/--preset）| resume 和 sync 各自仅保留相关参数 |
| 初始化阶段 | L36-L97 | run + resume（裁剪版）| sync 不需要完整初始化（仅需项目路径） |
| 工作流定义（10 阶段） | L99-L457 | run | 主编排逻辑 |
| 完成报告 | L458-L491 | run | 10 阶段完成报告 |
| 聚合模式 | L493-L577 | sync | 独立完整的聚合流程 |
| 失败重试 | L580-L609 | run | 子代理重试逻辑 |
| 中断恢复机制 | L610-L638 | resume | 核心恢复逻辑 |
| 选择性重跑 | L642-L663 | run | 属于 run 的变体操作 |
| 模型选择逻辑 | L666-L689 | run + resume（引用）| run 需要完整表，resume 仅需配置加载 |
| 阶段进度编号映射 | L692-L706 | run | 10 阶段编排专用 |

### 对产研汇总的建议

- **产品-技术交叉分析应关注**：`disable-model-invocation` 的差异化设置直接影响用户的命令发现体验——sync 允许自动触发支持了产品调研中"渐进式功能发现"的差异化机会，而 run/resume 禁止自动触发则防止了重量级操作的意外执行
- **风险评估重点**：初始化逻辑的完整性是拆分质量的关键——resume 需要包含足够的初始化步骤以独立运行，但不应包含"特性目录准备"等 run 独有的步骤
- **MVP 验证建议**：拆分完成后应按顺序验证三个技能的独立可用性：(1) 在 `/` 菜单中确认三个命令各自可见，(2) 执行 `/speckit-driver-pro:sync` 验证轻量级流程，(3) 执行 `/speckit-driver-pro:run` 验证完整编排
