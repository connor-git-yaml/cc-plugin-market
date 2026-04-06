# Milestone: Orchestration Deepening — 编排深层优化

> 里程碑编号: M-088
> 创建日期: 2026-04-06
> 前置里程碑: M-083 Harness Hardening（084-087 全部完成）
> 输入来源:
> - M-083 review 中识别的 P1 遗留项
> - `specs/083-harness-hardening-milestone/research/` 中未覆盖的建议

---

## 一、里程碑目标

解决 M-083 遗留的结构性问题和未覆盖的高价值建议：SKILL.md 万行拆分、实现中期门禁、sync 合并算法确定性化、配置体验提升、跨 Feature 守护、大规模重构模式。将 spec-driver 从"Prompt 追加型优化"推进到"编排架构结构性重构 + 模式完备"。

---

## 二、Feature 清单（5 个）

### Feature 089-skill-orchestration-split: SKILL.md 编排拆分

**问题**：`spec-driver-feature/SKILL.md` 超过 10,000 行，编排逻辑、门禁策略、上下文注入、错误处理、输出格式全混在一个文件中。修改一个门禁行为需要在万行 Markdown 中精确定位。

**方案**：
1. 将 Phase 定义、依赖关系、Gate 配置、并行组提取到 `orchestration.yaml`
2. SKILL.md 瘦身到 <3,000 行（仅保留 Prompt 指令和流程说明）
3. orchestration.yaml 的 Phase 定义可被新增模式复用（如 093 refactor 模式）
4. 7 种现有模式（feature/story/implement/fix/resume/sync/doc）全部适配

**风险**：最大工作量项（3-5 天），需完整测试 7 种模式行为不变性。

**验收标准**：
- `orchestration.yaml` 存在且包含所有 Phase/Gate/并行组定义
- feature SKILL.md <3,000 行
- 7 种模式 smoke test 通过（手动验证）
- `npm run repo:check` pass

---

### Feature 090-implement-mid-gate: 实现中期门禁

**问题**：implement 完成全部任务后才验证，大型 Feature（>10 tasks）中如果在 50% 时已经偏离架构或推翻前置假设，完成后再发现成本高得多。OctoAgent 实战中多次出现"完成后才发现底层 API 不支持预期行为"。

**方案**：
1. 在 implement 完成 50% 任务（向下取整）后插入 GATE_IMPLEMENT_MID 轻量级检查
2. 检查内容：已完成任务的代码是否引入架构劣化信号、tasks 前置假设是否仍成立
3. 默认策略：on_failure（发现问题才暂停）
4. 在 feature/implement SKILL.md 中追加触发逻辑
5. 小型 Feature（<=5 tasks）自动跳过

**验收标准**：
- feature SKILL.md 包含 GATE_IMPLEMENT_MID 触发逻辑
- spec-driver.config.yaml 支持 `gates.GATE_IMPLEMENT_MID.pause` 配置
- <=5 tasks 时自动跳过
- `npm run repo:check` pass

---

### Feature 091-sync-deterministic-merge: sync 合并算法确定性化

**问题**：sync.md Agent 的 Prompt 包含 13,759 bytes 的复杂合并算法（5 级推断优先级、14 章合并策略、冲突解决规则），用自然语言描述确定性算法导致 LLM 遵循度随 Prompt 长度下降，不同模型对同一算法的执行结果可能不同。

**方案**：
1. 将合并算法的核心逻辑提取为 MJS 脚本（`plugins/spec-driver/scripts/sync-merge-engine.mjs`）
2. sync Agent 通过 Bash 调用脚本执行合并，自己只负责"理解哪些 spec 应该合并"和"审查合并结果"
3. 决策与执行分离：Agent 负责决策（LLM 强项），脚本负责执行（确定性保障）
4. 脚本支持 `--dry-run` 模式预览合并结果

**验收标准**：
- `sync-merge-engine.mjs` 存在且可独立执行
- sync.md Prompt 大幅瘦身（<5,000 bytes）
- `--dry-run` 输出合并预览
- `npm run repo:check` pass

---

### Feature 092-config-ux-and-cross-feature-guard: 配置体验 + 跨 Feature 守护

**问题**：6 层配置优先级链对用户完全不透明；多个 Feature 串行修改同一模块时缺少协调；验证命令无��时保护。

**来源**：code-review §4.1/4.2/6.2 + retrospective §6.1/7.1 + audit §2.5

**范围**：
1. **配置校验前移** — init-project.sh 阶段对 spec-driver.config.yaml 执行 Schema 校验，对常见错误提供修复建议
2. **effective config 展示** — 编排器初始化时输出合并后的最终生效配置（标注每项来源）
3. **跨 Feature 冲突检测** — analyze Agent 扫描近 5 个 Feature 的 tasks.md，重叠文件输出 OVERLAP_WARNING
4. **验证命令超时保护** — spec-driver.config.yaml 支持 `verification.timeout`（默认 300 秒）
5. **sync 文档矛盾检测** — 补全 087 未覆盖的矛盾检测和术语一致性检查
6. **Skill frontmatter 增强** — 为 7 个 SKILL.md 补齐 `allowed-tools` / `model` / `effort` 声明

**验收标准**：
- init-project.sh 对故意错误的 config.yaml 输出校验错误和修复建议
- 编排器初始化输出 effective config（含来源标注）
- analyze.md 包含跨 Feature 冲突检测逻辑
- spec-driver.config.yaml 支持 `verification.timeout` 字段
- sync.md 包含矛盾检测和术语一致性检查
- 7 个 SKILL.md 含 frontmatter 声明
- `npm run repo:check` pass

---

### Feature 093-refactor-mode: 大规模重构模式

**问题**：当前 7 种模式都假设改动是局部的。当改动涉及 40+ 文件的全局命名替换、跨包迁移、deprecated 概念清理时，需要不同策略——分批迁移 + 中间验证 + 残留扫描。OctoAgent 实战中多次出现"以为是小改动实际 59 文件跨 5 包"、"改了底层但忘了上层调用方"等问题。

**来源**：session-review §可改进2 + retrospective §3.2（Impact Radius HIGH 场景）

**方案**：
1. 新增 `spec-driver-refactor` Skill（SKILL.md + agents/refactor-plan.md）
2. 核心流程：影响分析 → 分批规划 → 逐批实现+中间验证 → 全量残留扫描 → 最终验证
3. 与 feature 模式的区别：
   - 无需 specify/research，直接从重构目标开始
   - plan 阶段强制 Impact Radius 评估 + 分批策略
   - implement 阶段按批次执行，每批完成后编排器独立验证 + 残留扫描
   - verify 阶段增加全局一致性扫描（import 路径、枚举值、类型定义）
4. 复用 089 的 orchestration.yaml Phase 定义机制

**验收标准**：
- `plugins/spec-driver/skills/spec-driver-refactor/SKILL.md` 存在
- 支持 `--target` 参数指定重构目标（文件/模块/概念名）
- 自动执行影响分析（grep 影响文件数 + 跨包检测）
- 分批 implement + 每批中间验证
- 全量残留扫描（旧名称零残留）
- `npm run repo:check` pass

---

## 三、实施顺序与并行分析

```
┌─── 090 (中期门禁) ──────────┐
│                              │
├─── 091 (sync 确定性) ───────├──→ 089 (SKILL.md 拆分) ──→ 093 (refactor 模式)
│                              │
└─── 092 (配置+守护) ─────────┘
```

### Wave 1（可并行）：090 + 091 + 092

| Feature | 主要改动文件 | 与其他冲突 |
|---------|------------|-----------|
| 090 | feature/implement SKILL.md body（追加 Gate）+ config.yaml | 无 |
| 091 | sync.md + 新建脚本 | 无 |
| 092 | init-project.sh + analyze.md + SKILL.md frontmatter + config.yaml + sync.md | config.yaml 与 090 轻微重叠（不同字段），sync.md 与 091 重叠 |

**冲突风险**：
- 092 和 090 都改 config.yaml，但 090 加 `gates.GATE_IMPLEMENT_MID`，092 加 `verification.timeout`，不同字段，合并无冲突
- 092 和 091 都改 sync.md，但 092 追加矛盾检测（审查维度），091 瘦身合并算法（核心逻辑），改动位置不同。**建议 091 在 092 之后执行**，避免 sync.md 的交叉编辑

**修正后的 Wave 1 并行策略**：
- **090 和 092 并行** → 合并到 master
- **091 紧随其后**（依赖 092 的 sync.md 矛盾检测就绪）

### Wave 2：089

- 依赖 Wave 1 全部完成（090 的 Gate + 092 的 frontmatter/config 稳定后统一提取到 orchestration.yaml）

### Wave 3：093

- 依赖 089 的 orchestration.yaml 就绪
- 在其基础上新增 refactor 模式

---

## 四、成功标准

| 指标 | 当前（M-083 后） | M-088 完成后 |
|------|-----------------|-------------|
| SKILL.md 最大行数 | 10,000+ | <3,000 |
| 执行模式 | 7 种 | 8 种（+refactor） |
| 门禁类型 | GATE_DESIGN/TASKS/VERIFY + PreToolUse | +GATE_IMPLEMENT_MID |
| sync Prompt 大小 | 13,759 bytes | <5,000 bytes |
| 编排配置 | 嵌入 SKILL.md | orchestration.yaml 独立文件 |
| 配置可观测性 | 无 | effective config 展示 + Schema 校验 |
| 跨 Feature 守护 | 无 | analyze 冲突检测 |
| 验证超时 | 无 | verification.timeout 配置 |
| 大规模重构支持 | 无（手动组合 story+implement） | 原生 refactor 模式（分批+中间验证+残留扫描） |

---

## 五、已评估但不纳入的遗留项

| 建议 | 来源 | 不纳入原因 |
|------|------|-----------|
| Constitution 渐进式创建 | code-review §5.1 | 用户基数有限，当前完整 Constitution 模板已够用 |
| 多 Feature 并行管理 / status 命令 | code-review §5.2 | 实施复杂度高（3 天），较少出现多 Feature 并行场景 |
| verify Monorepo 增强（uv/Nx/Turbo） | code-review §6.1 | 场景特定，非核心用户路径 |
| Prompt Token 预算控制 | code-review §1.3 | Claude 系列模型长 Prompt 容忍度好，非当前瓶颈 |
| 编排逻辑行为退化测试 | code-review §1.5 | 理想但实施极难（Prompt 行为不可确定性测试） |
| 制品版本化 / 自动 snapshot | code-review §5.3 | Git commit 即可简易实现 |
| 研究 Agent 离线降级置信度 | code-review §3.4 | 离线场景少见，低紧迫 |
| 用户自定义 preset | code-review §4.3 | 3 个内置 preset 当前够用 |
