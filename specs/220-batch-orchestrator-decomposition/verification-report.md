# F220 最终验证报告（Phase 5）

**验证时间**: 2026-07-21
**验证 HEAD**: 80520bc（guard 1de6d7e → Tier-A 333551b → Tier-B 80520bc）
**基线**: f7bd643（= origin/master）

---

## 1. 唯一成功标准：行为不漂移 —— 证据链

| 合同 | 证据 | 结果 |
|------|------|------|
| **graph-only 输出合同** | G1 自校验门：拆后 `buildAstGraphOnly`（已迁 ②graph-assembly）对 micrograd@c911406 输出与**拆前冻结产物逐字节相等**（SHA db854b85…46cb8）；每批次后均复验 | ✅ byte-identical |
| **full/incremental 输出合同** | G2 特征化 charter 10 场景（mock-LLM 零付费）：完整归一化 GraphJSON、模块 spec 摘要、README/_index/summary 清洗后全文、LLM 调用数 —— **快照自拆前生成后全程零再生**（key 集合断言防静默增删） | ✅ 11/11 |
| **checkpoint 恢复** | charter 场景8：注入失败→checkpoint 全文合同快照→resume（completed 跳过/failed 重生成/成功清理）；场景7 显式 full 旁路；F182 测试群 17 用例；新增 ④ 状态机 9 用例 | ✅ |
| **byte-stable（复现性）** | micrograd：拆前冻结 vs 拆后逐字节；nanoGPT：拆后双跑逐字节；G1 采集脚本双跑逐字节 | ✅ |
| **F217 六指标** | 图重建（graph-only，5954 节点/7982 边）后 `graph-quality`：duplicate-canonical-id / contains-coverage 100% / orphan-ratio 0.0% / dangling-edge / legacy-ignored / freshness(fresh@80520bc) | ✅ Overall pass |
| **导出契约** | 14 符号双向差集空（G3 ts-morph 编译器级 + dist d.ts 独立核实）；41 消费者导入路径零改动 | ✅ |

## 2. 工具链验证

| 检查 | 结果 |
|------|------|
| `npm run build`（tsc + declaration） | ✅ 零错误 |
| `npx vitest run` 全量 | ✅ Tier-B 后 **5421 passed / 0 failed**（464 文件；Tier-A 后一轮 5419 pass + 2 已知 load-flaky 隔离双绿） |
| `npm run typecheck:tests`（含 f220 Equal 形状冻结） | ✅ |
| `npm run repo:check` | ✅ status=pass（12 检查族全过；graph freshness fresh） |
| `npm run release:check` | ✅ contract valid |

## 3. Codex 对抗审查（四轮全闭环）

| 轮次 | 对象 | 结论 | 处置 |
|------|------|------|------|
| R1 设计 | impact-report + refactor-plan | 5C/4W/3I | 全处置（plan §8）：验证协议 v2（冻结基线/charter/导出合同） |
| R2 守护层 | G1/G2/G3 代码 | 5C/4W/3I | 全修复（plan §9）：graph 全量合同、B7 内容守护、resume 链、ts-morph 化、scrubber JSON 缺陷 |
| R3 Tier-A | 搬迁 diff | **0C**/3W | 20 声明 AST 逐行比对全等（独立核实）；W1 加载轨迹口径记录、W2 @internal 标注、W3 src.spec.md 排除 |
| R4 Tier-B | seam diff | **0C**/2W | 6 项重点全"已核实无问题"（独立复算依赖矩阵/覆盖精确匹配/异常落点）；2W 均系 src.spec.md 生成器缺陷 → dogfooding 反馈 |

## 4. 验收清单对照

- [x] 五段各自独立可测（stage 级单测/既有测试面映射见 residual-report §2）
- [x] batch-orchestrator.ts 降到有边界职责（2580→1749；残留扫描 + residual-report 齐，残留块逐一有边界理由）
- [x] 三 mode 输出合同 + byte-stable + checkpoint 恢复 + F217 六指标全绿
- [x] 全量 vitest / build / repo:check（release:check 附带）零失败
- [x] batch-project-docs.ts 显式决策记录（defer + 三条理由，impact-report §7）
- [x] 每 phase Codex 对抗审查（四轮）
- [x] specs/src.spec.md 排除出全部 commit
- [x] 与 F219 并行 disjoint（未触碰 scripts/spec-drift 与 repo:check 检查族定义）

## 5. 已知边界（诚实披露）

- **freshness 一步滞后（收尾 commit 后）**：`specs/_meta/graph.json` 是本地运行态（不入库）；本报告入库的收尾 commit 会使本地图相对新 HEAD 落后一格（warn 级）。任何 worktree 跑一次 `spectra batch --mode graph-only`（3.5s）即恢复 fresh —— 与 F218 交付模式一致，非回归。
- **加载轨迹非合同**（R3-W1）：`createLogger` 二次调用与 `directory-graph` 惰性加载属模块初始化轨迹差异，无业务行为差；零漂移合同口径 = facade 公共行为与产物输出。
- **stage 深导入**（R3-W2）：五 stage 已标注 @internal；package `exports` 白名单属独立兼容性决策（follow-up 候选）。
