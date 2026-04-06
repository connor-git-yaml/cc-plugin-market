# Milestone: Orchestration Deepening — 编排深层优化

> 里程碑编号: M-088
> 创建日期: 2026-04-06
> 前置里程碑: M-083 Harness Hardening（084-087 全部完成）
> 输入来源:
> - M-083 review 中识别的 P1 遗留项
> - `specs/083-harness-hardening-milestone/research/` 中未覆盖的建议

---

## 一、里程碑目标

解决 M-083 遗留的三个结构性问题：SKILL.md 万行拆分、实现中期门禁、sync 合并算法确定性化。将 spec-driver 从"Prompt 追加型优化"推进到"编排架构结构性重构"。

---

## 二、Feature 清单（3 个）

### Feature 089-skill-orchestration-split: SKILL.md 编排拆分

**问题**：`spec-driver-feature/SKILL.md` 超过 10,000 行，编排逻辑、门禁策略、上下文注入、错误处理、输出格式全混在一个文件中。修改一个门禁行为需要在万行 Markdown 中精确定位。

**方案**：
1. 将 Phase 定义、依赖关系、Gate 配置、并行组提取到 `orchestration.yaml`
2. SKILL.md 瘦身到 <3,000 行（仅保留 Prompt 指令和流程说明）
3. 新增模式（如 refactor）可复用 Phase 定义
4. 7 种模式（feature/story/implement/fix/resume/sync/doc）全部适配

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

## 三、实施顺序

```
090 (中期门禁)  ──→ 089 (SKILL.md 拆分，最大工作量)
                         ↓
091 (sync 确定性)  ──→ （独立，可与 089 并行）
```

- **090** 先做：改动较小（SKILL.md 追加），为 089 提供可纳入的新 Gate 定义
- **089** 核心：SKILL.md 拆分需要 090 的 Gate 定义就绪后一并提取到 orchestration.yaml
- **091** 独立：改的是 sync 子系统，与 089/090 无文件重叠，可并行

---

## 四、成功标准

| 指标 | 当前（M-083 后） | M-088 完成后 |
|------|-----------------|-------------|
| SKILL.md 最大行数 | 10,000+ | <3,000 |
| 门禁类型 | GATE_DESIGN/TASKS/VERIFY + PreToolUse | +GATE_IMPLEMENT_MID |
| sync Prompt 大小 | 13,759 bytes | <5,000 bytes |
| 编排配置 | 嵌入 SKILL.md | orchestration.yaml 独立文件 |
