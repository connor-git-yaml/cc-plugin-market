# 技术决策研究: 拆分 Speckit Driver Pro 技能命令

**特性分支**: `013-split-skill-commands`
**研究日期**: 2026-02-15
**输入**: [spec.md](spec.md) + [research/research-synthesis.md](research/research-synthesis.md)

## 决策 1: 拆分架构方案

### Decision

采用**方案 A — 完全独立拆分**：三个 SKILL.md 各自包含完整的独立逻辑，无文件间引用依赖。

### Rationale

1. **最低实现风险**：纯 Markdown 文本拆分，不涉及文件间引用机制设计
2. **最优上下文效率**：每个技能加载时无需额外 Read 调用获取引用文件
3. **与 MVP 范围对齐**：产研汇总已将"共享工具模块 `_shared/`"归入二期
4. **重复可控**：run 和 resume 共有的初始化逻辑约 60 行，且两者存在差异（resume 需制品扫描，不需特性目录准备）

### Alternatives

| 方案 | 淘汰理由 |
|------|---------|
| 方案 B: 主技能+引用拆分 | 违反拆分核心意图（职责独立），resume/sync 对主技能存在引用耦合 |
| 方案 C: 共享引用层拆分 | 产品调研明确归入 Nice-to-have；MVP 阶段引入 `_shared/` 增加不必要的设计复杂度 |

---

## 决策 2: 迁移策略

### Decision

采用 **Strangler Fig 模式**（绞杀者模式）：先创建三个新技能并验证功能，再删除旧技能目录。

### Rationale

1. **降低回滚风险**：如新技能存在问题，旧技能仍可用
2. **行业验证**：Salesforce CLI 从单体迁移到 oclif 插件系统时采用同一模式
3. **平台支持**：Claude Code 自动发现机制天然支持新旧技能共存
4. **共存为过渡态**：验证通过后立即删除旧技能目录，不长期并行

### Alternatives

| 方案 | 淘汰理由 |
|------|---------|
| 原地替换（直接删旧建新） | 无回滚机制，如新技能有问题则所有命令不可用 |
| 版本化迁移（保留旧命令 + deprecation 标记） | Claude Code Plugin 规范不支持 deprecation 标记机制 |

---

## 决策 3: Frontmatter `disable-model-invocation` 差异化策略

### Decision

- `run`: `disable-model-invocation: true` -- 重量级编排流程，禁止自动触发
- `resume`: `disable-model-invocation: true` -- 涉及制品扫描和流程恢复，禁止自动触发
- `sync`: `disable-model-invocation: false` -- 轻量级操作，允许自动触发以支持渐进式功能发现

### Rationale

1. run 和 resume 是有状态、有副作用的操作（创建目录、修改文件、执行多阶段流程），意外自动触发可能导致不可预期的行为
2. sync 是轻量级的只读聚合操作（扫描+合并+生成报告），自动触发风险低
3. sync 允许自动触发可实现"渐进式功能发现"——用户讨论"规范聚合"时 Claude 自动推荐

### Alternatives

| 方案 | 淘汰理由 |
|------|---------|
| 全部设为 true | 牺牲 sync 的渐进式发现能力，新用户不易发现此轻量级入口 |
| 全部设为 false | run 和 resume 可能被误触发，导致意外执行重量级流程 |

---

## 决策 4: `--rerun` 归属

### Decision

`--rerun <phase>` 功能归入 **run 技能**，resume 技能不包含重跑逻辑。

### Rationale

1. rerun 需要完整的编排流程上下文（10 阶段定义、质量门、阶段依赖关系）
2. resume 聚焦于"从中断处继续"的单一场景，语义上与"选择性重新执行"不同
3. 技术调研和产研汇总对此决策达成一致

### Alternatives

| 方案 | 淘汰理由 |
|------|---------|
| 归入 resume | resume 的职责边界为"恢复"而非"重跑"，归入会模糊语义 |
| 独立技能 `rerun` | 增加不必要的命令数量，rerun 与 run 共享大量上下文（阶段定义、质量门） |

---

## 决策 5: resume 技能的初始化范围

### Decision

resume 包含**精简的初始化逻辑**：环境检查 + 配置加载 + prompt 来源映射。不包含"特性目录准备"步骤。额外包含制品扫描逻辑。模型选择仅包含配置加载部分（读取 `spec-driver.config.yaml`），不重复完整的模型选择决策表。

### Rationale

1. resume 的调用场景是"特性目录已存在但流程中断"，因此不需要创建特性目录
2. resume 需要从配置文件中读取模型设置以恢复执行，但模型选择的完整决策表（preset 默认配置表）仅在 run 中维护
3. 技术调研内容归属表（L238-239）明确：run 需要"完整表"，resume 仅需"配置加载"

### Alternatives

| 方案 | 淘汰理由 |
|------|---------|
| 完整复制 run 的初始化 | 包含不必要的"特性目录准备"步骤，增加文件体积 |
| 最小化初始化（仅配置加载） | 缺少环境检查和 prompt 来源映射，无法独立运行 |

---

## 决策 6: SKILL.md description 措辞策略

### Decision

使用**具体动作词 + 技术术语**的 description 措辞，避免泛化词汇：

- run: "执行 Spec-Driven Development 完整研发流程（10 阶段编排：调研-规范-规划-实现-验证）"
- resume: "恢复中断的 Speckit 研发流程 -- 扫描已有制品并从断点继续编排"
- sync: "聚合功能规范为产品级活文档 -- 将 specs/ 下的增量 spec 合并为 current-spec.md"

### Rationale

1. 具体术语（"specs/"、"current-spec.md"、"10 阶段"）提高 Claude 自动触发的精确度
2. 动作词（"执行"、"恢复"、"聚合"）使三个命令在 `/` 菜单中形成清晰的语义区分
3. 技术术语帮助有经验的用户快速理解功能范围

### Alternatives

| 方案 | 淘汰理由 |
|------|---------|
| 泛化描述（如"管理研发流程"） | 语义模糊，Claude 自动触发精确度低，用户难以区分三个命令 |
| 过长描述（>100 字符） | `/` 菜单展示空间有限，过长描述被截断后失去信息 |
