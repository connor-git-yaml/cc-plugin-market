---
feature_id: "156"
phase: "analyze"
created: "2026-05-08"
verdict: "yes-with-conditions"
---

# Feature 156 — Spec/Plan/Tasks Consistency Analysis

## 1. 维度评分

| 维度 | 状态 | 证据 / 残留 |
|------|------|-----------|
| A. FR ↔ Plan | PASS | 32 FR 全部可在 plan §2.1-2.7 找到架构对应 |
| B. FR ↔ Task | PARTIAL | FR-30 / FR-31 trace 弱（T-033 DoD 未显式断言 --incremental 一次性退出；FR-31 禁全局 cache 仅 T-006/T-013a 提及）|
| C. Plan ↔ Task | PASS | shape-map 8 文件 → T-012b + T-014~T-020 共 8 task；rewrite 6 → T-008~T-013（拆 a/b/c）；trivial 3 → T-021；删除 → T-024 |
| D. AC ↔ 验收 Task | PARTIAL | AC-4（jq .changedFiles）/ AC-10（watch 互不干扰）无专属 task DoD 命令 |
| E. EC ↔ Task / Plan | PASS | EC-1~EC-11 全覆盖（EC-11 → T-035a 跨 worktree） |
| F. clarify auto-decision 一致性 | PASS | 5 条决议全体现：pretty JSON / 不裁剪 symbol / depth=1 + flag / hook 只给脚本 / atomic 两步 commit |
| G. checklist PARTIAL 修复 | PASS | B2 / B3 plan 已修；F2 spec.md §4.3 OQ-5 字面已在本 phase 同步更新 |
| H. Cross-doc 字面引用 | PASS | import-resolver.ts / detectSCCs:32 / FR-28 三文档一致（doc-graph-builder.ts 重复行已在本 phase 删除）|
| I. 时间盒一致性 | PARTIAL | spec §11 W1 出口 grep 单条排除 vs plan §5 双条排除（plan 更精确，implement 以 plan 版本为准）|
| J. 风险一致性 | PASS | 风险 A-D 三文档对齐，缓解措施 → T-013a/b/c |

## 2. PASS 综述

- 32 FR ↔ plan §2.1-2.7 架构模块全覆盖
- 11 EC 全部有 plan 处理或专属 task
- clarify 5 auto-decision 全部被尊重
- 风险 A-D 跨文档对齐
- core cross-doc 引用（import-resolver.ts、detectSCCs:32、FR-28 接口）字面一致

## 3. PARTIAL 详细（无 CRITICAL）

### F-01 (HIGH)：T-033 DoD 未显式断言 FR-30 一次性退出
- 证据：tasks.md 总览 T-033 关联 FR-30，但 DoD 未显式包含"`spectra index --incremental` 执行后 exit 0、不持续运行"
- 修复：implement 时在 T-033 DoD 补 exit 验证

### F-02 (HIGH)：AC-4 / AC-10 无专属 task DoD 命令
- 证据：
  - AC-4（第二次运行 changedFiles=0）：T-030 仅写"EC-8 降级"，未列 `jq .changedFiles`
  - AC-10（watch 互不干扰）：T-035 DoD 仅写 AC-2b/AC-3b 耗时
- 修复：implement 时 T-030 补 `jq .changedFiles` 命令；T-035 补"`spectra watch` + `spectra index --watch` 同跑"验证

### F-03 (MEDIUM)：spec §4.3 写盘格式
- 已在本 phase 修订（spec.md §4.3 标注"OQ-5 已 close → pretty JSON"）

### F-04 (MEDIUM)：spec §3.1 doc-graph-builder.ts 重复行
- 已在本 phase 修订（删除 L83 重复行）

### F-05 (MEDIUM)：W1 出口 grep 命令三文档微差
- 现状：spec §11 用单条排除 vs plan §5 用双条（含 JSDoc * 行）；tasks T-025 引用 AC-5 命令
- 修复：implement 以 plan §5 的双条版本为权威；T-025 实际执行命令对齐 plan

### F-06 (LOW)：spec AC-11 "circular" 概念 vs plan ImportType
- AC-11 用 circular 描述 SCC 推导的 isCircular 字段；plan §2.5 ImportType 4 类不含 circular
- 不混淆：isCircular 是边的字段、ImportType 是 import 语法分类
- 修复：implement 时明确区分

### F-07 (LOW)：FR-31（禁 getCurrentUnifiedGraph）覆盖弱
- 仅 T-006 / T-013a DoD 提及；T-008~T-011 改造时同样需遵守
- 修复：implement 时所有 adapter rewrite task 确认不调用全局 cache

## 4. 总体评估

- **是否可以进入 Phase 6 (implement)？yes-with-conditions**
- 阻断点：无 CRITICAL / FAIL
- 带条件进入：F-01 / F-02 在 implement 阶段对应 task 执行时同步补充 DoD 命令；F-05 以 plan 版本为权威；F-06/F-07 implement 时执行注意事项

## 5. implement 阶段提醒清单

1. **T-033 DoD 补充**：`spectra index --incremental` 必须 exit 0、不持续运行
2. **T-030 DoD 补充**：`jq .changedFiles .spectra/unified-graph.json` 验证 = 0（验收 AC-4）
3. **T-035 DoD 补充**：同时启动 `spectra watch` 与 `spectra index --watch` 验证 AC-10 互不干扰
4. **W1 出口 grep 以 plan §5 为准**：`grep -rn "DependencyGraph" src/ --include="*.ts" | grep -v "^[^:]*:[ \t]*//" | grep -v "^[^:]*:[ \t]*\*" | wc -l` = 0
5. **import-resolver `ImportType` 字面量对齐**：plan §2.5 `'static' | 'dynamic' | 'type-only' | 'commonjs-require'`（4 类）；AC-11 中 `circular` 指 isCircular 字段（非 ImportType）
6. **legacy-shim.ts 非 public export**：T-006 验证 `src/graph/index.ts` 不 re-export，T-024 删除时确认无残留
7. **FR-31 禁 getCurrentUnifiedGraph**：所有 adapter rewrite (T-008~T-013c) 必须从入参 / 本次 buildUnifiedGraph 派生，禁读全局 cache

## 6. 指标

| 项 | 数值 |
|---|------|
| 总 FR | 32（FR-1~FR-32）|
| 总 Task | 44 |
| FR 覆盖率 | 30/32 完整 + 2 弱 = ~94% |
| AC 覆盖率 | 11/13 完整 + 2 弱 = ~85% |
| EC 覆盖率 | 11/11 = 100% |
| CRITICAL | 0 |
| HIGH | 2（F-01, F-02）|
| MEDIUM | 3（F-03, F-04, F-05）— F-03/F-04 本 phase 已修 |
| LOW | 2（F-06, F-07）|

**总体结论**：三件文档整体一致性良好，无 CRITICAL 阻断。F-03/F-04 本 phase 已修，F-01/F-02/F-05/F-06/F-07 在 implement 阶段对应 task 执行时合并修补，无需回炉 spec/plan。可带条件进入 Phase 6。
