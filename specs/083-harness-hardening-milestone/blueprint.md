# Milestone: Harness Hardening — 编排可靠性与原生能力深度利用

> 里程碑编号: M-083
> 创建日期: 2026-04-06
> 输入来源（见 `research/` 目录）:
> - `research/octoagent-code-review.md` — OctoAgent 团队深度代码审查（架构拆分、制品 Schema、Trace 日志）
> - `research/octoagent-refactor-retrospective.md` — OctoAgent 10,000+ 行重构实战反思（三层验证、架构劣化、根因分析）
> - `research/octoagent-session-review.md` — 单次大规模重构 Session 反思（一致性扫描、原子性、文档同步）
> - `research/harness-engineering-audit.md` — Claude Code Harness Engineering 生态调研（Hooks、rules/、Agent frontmatter、CI/CD）

---

## 一、里程碑目标

将 spec-driver 从"Prompt 依赖型软约束编排"升级为"Harness 原生 + 确定性检查 + 可观测的硬门禁编排"，同时精简过度工程化的治理层。

**一句话**：让 spec-driver 在 OctoAgent 这样 50K+ 行、12 包的大型项目中也能可靠运行。

---

## 二、Feature 清单（4 个）

### Feature 084-harness-native-integration: Harness 原生能力集成

**问题**：当前仅使用 28 种 Hook 中的 1 种（SessionStart），Agent frontmatter、`.claude/rules/`、CI/CD Action 等原生能力完全未利用。CLAUDE.md >200 行，每次会话全量加载浪费 token。

**范围**：

1. **PreToolUse 源码保护门禁** — 检测活跃 spec-driver 工作流时，硬性阻止对 `src/` 的 Edit/Write，将"不允许直接改代码"从软约束升为硬门禁
2. **PostToolUse 自动格式化** — Edit/Write 后自动 prettier
3. **Stop 完整性检查** — Claude 即将结束时，prompt hook 检查是否有遗漏任务
4. **`.claude/rules/` 路径规则拆分** — 将 CLAUDE.md 中的路径特定规则（spec-driver 约束、panoramic 开发、测试规范、语言约定）拆到 `.claude/rules/`，CLAUDE.md 瘦身到 <100 行
5. **CLAUDE.md 瘦身** — 删除 auto-generated 技术清单（50 行重复的 "TypeScript 5.x, Node.js LTS"）
6. **Agent frontmatter 声明式配置** — 为 14 个 agent .md 添加原生 model/tools/effort 声明，减少 SKILL.md 样板
7. **WorktreeCreate/Remove Hook** — 替代 post-checkout git hook，在 Claude Code 原生 worktree 操作时更可靠地同步本地态
8. **CI/CD 集成** — 引入 claude-code-action PR 审查 + repo:check GitHub Action

**交付物**：
- `plugins/spec-driver/hooks/hooks.json` 更新（PreToolUse/PostToolUse/Stop/Worktree）
- `plugins/spec-driver/scripts/hooks/guard-spec-driver-edit.sh`
- `.claude/rules/*.md`（4-5 个路径规则文件）
- CLAUDE.md 精简版
- 14 个 agent .md frontmatter 更新
- `.github/workflows/claude-review.yml`

---

### Feature 085-implement-verify-hardening: implement/verify 可靠性硬化

**问题**：OctoAgent 实战暴露 implement 是流水线最弱环节——6 层 silent failure chain、God Class 膨胀到 5112 行、枚举大小写不匹配、verify 只检查"代码是否存在"而非"是否正确运行"。

**范围**：

**implement 侧**：
1. **三层验证体系** — Layer 1（现有工具链）+ Layer 2（行为验证：每个 FR 的 happy path 需端到端可观测步骤）+ Layer 3（失败路径验证：禁止 bare except 返回空）
2. **改动后一致性自检** — 实现完毕→测试前插入自检：搜索修改/删除的类型名/枚举值/字段名的全部引用，确认无遗漏
3. **验证由编排器执行** — SKILL.md 编排层自己运行 build+lint+test，不信任 Agent 自我报告
4. **tasks.md 架构守护条目** — plan 自动生成 Architecture Guard 节（文件行数阈值、循环依赖、bare except 禁止）
5. **tasks.md 原子性约束** — 每个 task 完成后系统可编译，跨层改动不拆分到不同 task

**verify / quality-review 侧**：
6. **verify 深度检查** — Layer 1.5：调用链完整性追踪、数据持久化验证（commit/flush）、配置贯穿验证（env→config→constructor→使用点）
7. **verify 残留扫描** — 涉及删除/重命名时 grep 旧名称，确认代码和文档零残留
8. **quality-review 累积劣化检测** — 单文件 <300→>500 WARNING、<500→>800 CRITICAL 阻断；连续 3 个 Feature 同文件增长 CRITICAL
9. **verify 文档一致性检查** — 架构文档（Blueprint/README/ADR）引用了被删除概念时报警
10. **quality-review 跨模块一致性** — 并行子任务完成后全局扫描 import 路径、共享常量、类型定义一致性

**交付物**：
- `plugins/spec-driver/agents/implement.md` 重大更新
- `plugins/spec-driver/agents/verify.md` 重大更新
- `plugins/spec-driver/agents/quality-review.md` 更新
- `plugins/spec-driver/templates/specify-base/tasks-template.md` 更新
- 各 SKILL.md 编排流程更新（编排器驱动验证）

---

### Feature 086-upstream-phase-grounding: 上游阶段接地气 + 模式强化

**问题**：spec 写得漂亮但不知道目标文件已 2260 行；plan 没预估"清理 workspace_id"影响 59 文件跨 5 包；fix 修了 5 次才找到 6 层 failure chain 的根因；story 以为小改动实际 40+ 文件。

**范围**：

**plan 增强**：
1. **Codebase Reality Check** — plan 必选步骤：读取目标文件，记录行数/方法数/已知 debt，需清理则增加前置 task
2. **Impact Radius 评估** — plan 输出必须包含 Impact Assessment（影响文件数、跨包影响、数据迁移、API 变更、风险等级），HIGH 风险强制分阶段

**specify 增强**：
3. **最小必要性检验（YAGNI）** — 对每个拟定组件问"去掉是否仍可实现？"；plan 标注"必须 vs 可选"
4. **GATE_DESIGN 复杂度审查** — 门禁增加"设计是否过度复杂"维度

**fix 增强**：
5. **5-Why 根因追溯** — 诊断阶段从表面症状追到根本原因，输出 root cause chain
6. **影响范围扫描** — 同一 pattern 是否在其他位置存在，修复是否需要同步更新调用方/测试/文档

**story 增强**：
7. **scope 评估** — Phase 1 评估改动规模，>15 文件或跨包/DB schema 变更建议切到 Feature 模式

**resume 增强**：
8. **结构化断点** — implement 每完成一个 task 更新 `execution-state.json`（last_completed、in_progress、discovered_issues、pending_decisions、modified_files），resume 基于此精确恢复

**交付物**：
- `plugins/spec-driver/agents/plan.md` 更新
- `plugins/spec-driver/agents/specify.md` 更新
- `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` 更新
- `plugins/spec-driver/skills/spec-driver-story/SKILL.md` 更新
- `plugins/spec-driver/agents/implement.md` 更新（断点写入）
- `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` 更新
- `plugins/spec-driver/templates/specify-base/plan-template.md` 更新

---

### Feature 087-orchestration-upgrade-governance-trim: 编排架构升级 + 治理精简

**问题**：SKILL.md 10,000+ 行单文件、Phase 间制品契约隐式化、执行过程不可观测、10+ 生成脚本 5000+ 行 ROI 存疑。

**范围**：

**编排升级**：
1. **Trace 日志机制** — 编排器写入 `specs/{feature}/trace.md`：每 Phase 启停时间、产物统计、降级事件、Gate 决策、失败重试
2. **子 Agent 制品 Schema 显式化** — 每个 Agent 输出定义 `agents/{phase}.artifact.yaml`（路径、必选/可选章节、校验规则），analyze 基于 Schema 校验
3. **SKILL.md 编排拆分** — 将 Phase 定义/依赖/Gate/并行组提取到 `orchestration.yaml`，SKILL.md 瘦身到 <3000 行
4. **错误传播链路补全** — 降级记录原因、Agent 失败 root cause 传播到最终报告、模板 fallback 通知用户

**治理精简**：
5. **生成脚本矩阵分层** — 核心（entity-catalog、quality-reports）保留，实验性（scorecards、adoption、workflow-registry）移到 `scripts/experimental/`，repo:sync 主链路不执行
6. **sync 文档健康度检查** — 膨胀检测（>1000 行建议拆分）、陈旧章节检测、术语一致性
7. **Constitution 可量化约束** — Measurable Guardrails：文件行数上限、循环依赖零容忍、silent failure 零容忍
8. **contributor-guide.md** — 流程图说明"改 X 文件需要做什么"，降低新贡献者门槛

**交付物**：
- `plugins/spec-driver/skills/spec-driver-feature/orchestration.yaml`（新增）
- 各 SKILL.md 瘦身
- `plugins/spec-driver/agents/*.artifact.yaml`（14 个）
- SKILL.md Trace 写入逻辑
- 脚本目录重组（`scripts/experimental/`）
- `plugins/spec-driver/agents/sync.md` 更新
- `plugins/spec-driver/agents/constitution.md` 更新
- `docs/contributor-guide.md`

---

## 三、实施顺序

```
084 (Harness 原生)  ──→ 085 (implement/verify 硬化)
                            ↓
086 (上游接地气)    ──→ 087 (编排升级 + 精简)
```

- **084** 先做：Hooks 门禁和 rules/ 拆分是基础设施，后续 Feature 都在此基础上工作
- **085** 最关键：直接解决 OctoAgent 的最大痛点（silent failure + God Class）
- **086** 可与 085 并行启动（改的是不同 agent 文件）
- **087** 最后做：SKILL.md 拆分工作量最大，且需要前三个 Feature 的经验积累

---

## 四、成功标准

| 指标 | 当前 | 083-01 后 | 全部完成后 |
|------|------|----------|----------|
| Hooks 利用 | 1/28 | 5/28 (084) | 5/28 |
| 硬门禁 | 1 (GATE_DESIGN) | 2 (+PreToolUse, 084) | 3 (+编排器验证, 085) |
| implement 自检覆盖 | ~5% prompt | ~5% | ~20% (085) |
| CLAUDE.md 行数 | >200 | <100 (084) | <100 |
| SKILL.md 最大行数 | 10,000+ | 10,000+ | <3,000 (087) |
| 执行可观测性 | 无 | 无 | trace.md (087) |
| 制品合同覆盖 | 0/14 | 0/14 | 14/14 (087) |

---

## 五、风险

1. **087 的 SKILL.md 拆分是最大工作量**（3-5 天），需完整测试 7 种模式行为不变性
2. **所有 Prompt 修改无法自动化回归**——需人工 smoke test 验证行为未退化
3. **Agent frontmatter** Plugin Subagent 不支持 hooks/mcpServers/permissionMode，需先验证可用字段
4. **Codex 兼容性**——Hooks / rules/ / frontmatter 在 Codex 不可用，需保留降级路径
