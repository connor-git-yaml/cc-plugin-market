# Codex 对抗审查 — Implement Phase A（F201 goal_loop 声明层）

审查对象：Phase A 实现（T001~T010）git diff（未提交）
审查时间：2026-06-20
结论分档：**CRITICAL 0 / WARNING 7 / INFO 4**

## 实跑验证的最高风险点（Codex I3，已通过）

golden 模板 ↔ base feature phases 逐字段一致性：`get-phases feature` 返回 17 phase，与模板/fixture 比对**仅 implement.agent_mode（single→goal_loop）一处差异**，version 均 1.0。**实测无漂移。**

zod 降级路径（I4）：`SPEC_DRIVER_FORCE_ZOD_MISSING=1` 下 get-phases / generate-template exit 0，schema 导出 zodAvailable=false + null，不崩。

## WARNING 处置

| ID | 发现 | 处置 |
|----|------|------|
| W2 | goal_loop 默认值不注入（optional 段省略时读 undefined 非 5）| **fixed** — goalLoopSchema 改 `.default({})`；BUILTIN_DEFAULTS + resolveEffectiveConfig.nestedKeys 各加 4 dotPath。双路径默认值。新增 T-GL-05/05b 验证 |
| W4 | T-GL-03 测 fixture 非 golden 模板本体（漂移假绿）| **fixed** — 新增 T-GL-03b 直接 parse `goal-loop-override-template.yaml` 本体，逐字段断言与 base 仅一处差异。模板被 CI 守护 |
| W5 | T-GL-04 未覆盖 goal_loop 专属 version-mismatch | **fixed** — 新建 `goal-loop-version-mismatch.yaml`（goal_loop + version 2.0），T-GL-04 加断言 |
| W6 | 模板注释误导"其他 phase 仍来自 base" | **fixed** — 改为准确表述：整段替换下所有 phase source=overrides（非部分继承）|
| W7 | runtime dispatch 在 Phase A 未激活但未声明 | **fixed** — 模板 header 加激活边界声明（dispatch 在 Phase B/C SKILL.md）|
| W3 | max_verify_seconds 用 positive() 接受小数但文案称"正整数" | **按说明处理** — 保留 positive()（分数秒有意），error message "正整数"→"正数" |
| W1 | spec-driver.config.yaml 含 batch 段不在 config-schema，validate-config 报未知字段 | **不修（预存债）** — Feature 146 引入，非 F201，已 spawn 独立 task 跟踪 |

## INFO

- I1：新 fixture/模板为 untracked，commit 必须用显式路径纳入（否则 CI 找不到 fixture 直接失败）——commit 时确认
- I2：全仓无对旧 agent_mode 列表的精确字面量断言，error_map 改文案低风险
- I3：golden 模板一致性实测通过（见上）
- I4：zod 降级不崩（见上）

## 修复后验证

- `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs`：**41 pass / 0 fail**（原 33 + T-GL-01/02/03/03b/04/05/05b/15）
- `npm run build`：tsc 零类型错误
- `npm run repo:check`：全 pass
- `validateConfig({})` → `goal_loop.max_iterations===5`（W2 双路径验证）

## 结论

CRITICAL 0；7 WARNING 中 5 个 fixed、1 个按说明改文案、1 个预存债转独立 task。Phase A 可提交。
