# F263 验证报告 — receiver 类型定位本地导出分支遮蔽守卫

基线：`origin/master` = 3bf27a82；分支 HEAD 起点 = 64b1d72f。

## 1. 验收项逐条

| # | 验收项（任务卡原文） | 结果 | 证据 |
|---|---|---|---|
| 1 | 复现①（局部类遮蔽）②（泛型形参遮蔽）进 vitest 红先行 → 修复后绿（断言不出边） | **PASS** | resolver 层 R32/R33（plan 原编号 R13/R14）；mapper 层 M10d（案例①真实 AST）、M10g（案例②真实 AST）。红先行失败信息见 fix-report 各轮记录 |
| 2 | 对照真边用例绿（仍出边） | **PASS** | R34（resolver 层，断言完整边对象）；端到端 `INFERRED src/c.ts::driver -> src/c.ts::Real.go` |
| 3 | 本仓重建图：238 入边数与 coverage 236/517 保持（或逐边解释差异） | **PASS（含一处已解释差异）** | `legacy.classMethodWithInEdge=238`、`headline.methodWithInEdge=236` 均逐位不变；`methodNodes` 517→518，见 §3 |
| 4 | fix-report 含 R-2 更正节 | **PASS** | `fix-report.md`「F260 残余风险登记 R-2 的更正」节，含更正 1（低估范围）与更正 2（类型形参变体未被枚举） |
| 5 | F259 / F242 / F217 不回退 | **PASS** | 全量 `npx vitest run` 530 files / 7458 passed / 0 failed；`repo:check` graph-quality 六指标全 pass |

## 2. 门禁实跑（主线程亲跑，非转录子代理结论）

| 命令 | 结果 |
|---|---|
| `npx vitest run` | 530 files passed / 4 skipped；**7458 passed / 0 failed** |
| `npm run build` | tsc 零错误 |
| `npm run test:plugins` | pass 1580 / fail 0 |
| `npm run repo:check` | **exit 0**，全部检查项 pass |
| `npm run release:check` | **exit 0**，Release contract valid |

## 3. 生产图受控 A/B（逐边 diff，非纸面）

方法：`git checkout -- src/` 建 pre-F263 基线图 → 还原改动重建 → 两图逐边比对。
基线快照留存于 `/tmp/f263-ab/graph-BEFORE.json`（一次性验证产物，不入库）。

```
calls edges  pre-F263: 3996    final: 3996
REMOVED: []      ADDED: []
nodes ADDED: [ReceiverBinding.soleBinding, ReceiverTypeEnv.isSoleBinding]
```

**`methodNodes` 517 → 518 的精确归因**（实测 `metadata.memberKind`）：

| 新增节点 | memberKind | 是否计入 methodNodes |
|---|---|---|
| `…typescript-receiver-env.ts::ReceiverBinding.soleBinding` | `property` | 否 |
| `…typescript-receiver-env.ts::ReceiverTypeEnv.isSoleBinding` | `method` | **是（唯一的 +1）** |

二者均为本次改动自身新增的接口成员；接口方法签名不是调用目标，故无入边。
分子（236）与 F260 锚点（238）逐位不变 ⇒ **分母 +1 与判据行为无关**，不是弃权边导致。

## 4. 端到端 fixture（真实 `batch --mode graph-only` 流水线）

fixture 为一次性验证资产，置于 scratchpad，**不入库**。

| fixture | 期望 | 实测 |
|---|---|---|
| `repro/a.ts` 局部类遮蔽 | 不出边 | `schedule -> Task.run` 缺席 ✓ |
| `repro/b.ts` 泛型形参遮蔽 | 不出边 | `process -> Handler.run` 缺席 ✓ |
| `repro/c.ts` 对照真边 | 出边 | `INFERRED driver -> Real.go` ✓ |
| `verify/h1.ts` 声明合并 | **出边** | `INFERRED useModels -> Models.retrieve` ✓ |
| `verify/h2.ts` 合并对照 | 出边 | `INFERRED usePlain -> Plain.retrieve` ✓ |
| `verify/x1.ts` 别名导出绕过 | **不出边** | `goAlias -> Task.run` 缺席 ✓ |
| `round3/atk1-4` 顶层重赋值 / for-of 重绑 / 箭头无括号形参 | **不出边** | 四条 INFERRED `.m()` 边全部缺席 ✓ |

`repro/a.ts` 与 `round3/*` 仍存在的 `EXTRACTED …-> Class` 构造边属 F263-R-3 家族（Stage 1，
F260 之前即存在），明确不在本卡范围。

## 5. 审查档位与结论汇总

⚠️ **Codex 配额耗尽期，Codex 异构对抗档位缺席**（依 `CLAUDE.local.md` 暂停节）。
改用独立子代理异构对抗，共 6 次审查、5 个不同切入角，两轮（第 2 轮针对第 1 轮的新代码）。

| 轮 | 角色 / 切入角 | C | W | I | 处置 |
|---|---|---|---|---|---|
| 1 | Spec 合规审查 | 0 | 0 | 1 | 用例编号 R13-17→R32-36（撞号），已在测试文件留痕 |
| 1 | 代码质量审查（变异测试 5 变异体） | 0 | 1 | 2 | R36 fixture 无区分力 → 第 2 轮已修并变异自证 |
| 1 | 对抗 A：绕过构造面 | 3 | 1 | 1 | 别名导出绕过已修；R-4/R-5/R-6 登记 |
| 1 | 对抗 B：误伤面 | 1 | 3 | 0 | 声明合并误伤已修；R-7 登记 |
| 2 | delta 对抗：第 2 轮新代码顶层判定面 | 1 | 1 | 2 | 顶层重赋值 + 箭头形参，**均已修** |
| 2 | verify：证据核查 + over-claim 扫描 | 0 | 0 | 1 | node_modules 量化数字未二次复算（不影响正确性判定） |

**全部 CRITICAL 与 WARNING 已修或已登记为残余风险**（F263-R-3 … R-8，见 `fix-report.md`）。
残余风险如实声明：Codex 档位缺席，上述「无 CRITICAL 遗留」不构成安全证据，
配额恢复后可回补审查。

## 6. BEHAVIOR_VERSION / collector 指纹

**不 bump**（保持 3）。六类 bump responsibility 全部是「哪些文件被计入采集」维度，
本次改的是边解析语义；`extensionSurface` 不变。先例：F260 对 calls 边语义的改动更大，同样未 bump。
</content>
