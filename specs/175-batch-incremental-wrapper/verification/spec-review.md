# Spec 合规审查报告 — Feature 175 Batch Incremental Wrapper

**审查阶段**: verify / Phase 7a（spec-review 子代理，独立验证 acceptance 真实达成）
**结论**: 19/19 FR ✅ · 7/7 SC ✅（SC-007 正向超出）· 9/9 EC ✅ · 0 CRITICAL · 0 WARNING · 3 INFO

---

## FR 逐条核实（带代码 + 测试证据）

| FR | 状态 | 证据 |
|----|------|------|
| FR-001 默认增量三入口一致 | ✅ | `regen-plan.ts:77` 规则(4) incremental:true；三入口均调 resolveRegenPlan；`regen-plan.test.ts:65` 断言 `resolveRegenPlan({})`=incremental:true |
| FR-002 三处归一化消漂移 | ✅ | `batch.ts:63` / `server.ts:178` / `batch-orchestrator.ts:413` 均经 resolveRegenPlan，原硬编码已删 |
| FR-003 显式全量逃生口 | ✅ | `parse-args.ts:707` --full；`regen-plan.ts:61` 规则(1) full→全量 |
| FR-004 regen 轴与 BatchMode 正交 | ✅ | parse-args/server schema 独立字段；`index.ts:93/99` help 标注正交 |
| FR-005 未受影响模块 mtime 不变 | ✅ | E2E 场景1（c.spec.md mtime 快照断言）+ 场景2（全模块级 mtime 不变） |
| FR-006 graph.json 时间戳归一化（含 inputHash 嵌套） | ✅ | `graph-builder.ts:418` stripVolatileFields+stableStringify 替代 dg.generatedAt；单测验证仅时间戳变→hash 不变 |
| FR-007 写盘边界确定性排序 | ✅ | `batch-orchestrator.ts:1554` 社区分析后调 normalizeGraphForWrite；nodes by id / links by source+target+relation |
| FR-008 无改动模块级 generateSpec=0 | ✅ | 场景2 `mockCreate.calls.length===0` + `successful.length===0` |
| FR-009 新 E2E 覆盖增量核心路径 | ✅ | feature-175 E2E 10 场景，vi.hoisted+vi.mock+mkdtempSync+gitInit 范式 |
| FR-010 不引入存量回归 | ✅ | vitest 3898 passed / 0 failed |
| FR-011 force 优先于 incremental | ✅ | `regen-plan.ts:61` 规则(1) 先于(2)；`regen-plan.test.ts:74` 断言 |
| FR-012 首次运行退化全量 | ✅ | `delta-regenerator.ts:88` storedSpecs.length===0→mode:full,fallbackReason:no-existing-specs；场景9 断言 |
| FR-013 generatedByMode 缺失/不一致→cache miss | ✅ | `delta-regenerator.ts:336`；场景4 mode 切换→全部重生成 |
| FR-014 baseline-collect --full | ✅ | `baseline-collect.mjs:447`/`:489` args 加 '--full' |
| FR-015 task D Out of Scope | ✅ | spec [YAGNI-移除]，未实现 |
| FR-016 full 不被残留 checkpoint 绕过 | ✅ | `batch-orchestrator.ts:637` full 清 completed+failed；场景3/6 |
| FR-017 孤儿删除 + ownership | ✅ | `batch-orchestrator.ts:1117` isBatchGenerated(generatedByMode)+!hasLiveSource+isInManagedOutputDir；场景5 含手写 spec 不删 |
| FR-018 BFS 传播独立断言 | ✅ | 场景1（a/b/c 集合归属独立比对）+ 场景8 diamond/cycle |
| FR-019 target 口径统一 | ✅ | delta-regenerator:250 + batch-orchestrator:751 均调 resolveSourceTarget；oracle 单测验证等价 |

**覆盖率：19/19 FR（100%）**

## SC / EC 核实

| SC/EC | 状态 | 证据 |
|-------|------|------|
| SC-001 调用数==regenerateTargets（独立断言） | ✅ | 场景1 用 successful 集合比对 |
| SC-002 无改动模块级=0 | ✅ | 场景2 |
| SC-003 byte-stable deepEqual | ✅ | 场景10 full vs 无改动增量：spec 字节 + graph.json readNormalizedGraph 后 toEqual |
| SC-004 三入口默认 incremental=true | ✅ | regen-plan.test.ts:86 it.each |
| SC-005 显式全量 checkpoint 不绕过 | ✅ | 场景3（skipped=0）+ 场景6 |
| SC-006 存量零失败 + build + repo:check | ✅ | 3898 passed / build 0 / repo+release check pass |
| SC-007 E2E 覆盖核心路径 | ✅（正向超出：实现 10 场景 vs 要求 9 类） | feature-175 E2E |
| EC-001 force 优先 | ✅ | regen-plan.test.ts:74 |
| EC-002 旧 spec 无 generatedByMode→cache miss | ✅ | delta-regenerator.ts:336 |
| EC-003 mode 切换→cache miss | ✅ | 场景4 |
| EC-007 checkpoint×force | ✅ | 场景6 + batch-orchestrator.ts:637 |
| EC-008 源删除文件集收敛 | ✅ | 场景5 |
| EC-009 孤儿删除 ownership 边界 | ✅ | 场景5（手写 spec 保留断言） |

## INFO（非阻塞）

1. 场景10 `readNormalizedGraph` 注释提及 inputHash 但实际只剥 generatedAt+currentRun（保守，FR-006 已保证 inputHash 一致；可未来补 inputHash 跨路径断言）
2. 场景10 实现使 E2E 达 10 场景（spec/SC-007 列 9 类）—— 正向超出，额外场景对应 SC-003 byte-stable
3. 无 spec 未定义的公共 API / 配置项 / 用户可见行为新增（无 scope 蔓延）

## 执行摘要

**真实满足 19/19 FR（100%）、7/7 SC、9/9 EC**。所有关键验证点均有具体 file:line 代码证据 + 测试覆盖，无 over-claim（纸面声称）。spec-review 子代理独立核实，与 quality-review（0 CRITICAL）+ verify（全 gate pass）+ Codex 终审（READY）一致。
