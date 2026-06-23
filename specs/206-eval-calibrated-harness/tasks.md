# 任务分解：F206 难度校准评测/验证 harness

**关联**: [spec.md](spec.md) · [plan.md](plan.md) · **日期**: 2026-06-23
**本轮范围**: 只交仪器代码 + 测试，不实跑校准批（CL-1）。

依赖：C0（并行池）→ {C1 校准, C3 验证}；C1 → C2 划分；C3 ⊇ C4（/goal 入口）。纯函数单测随各组件。

## T-C0a runner exit 码拆分（codex C-1 前置）〔改 F188 eval-task-runner〕
- [ ] eval-task-runner：`genInfra.failed → exit 3（infra）` / `runResult.timedOut → exit 4（生成超时=能力 fail）` 拆开（当前合并 exit 3）
- [ ] cohort-batch line 391 兼容：exit 3 和 4 都仍当 broken（resume 重跑），不破坏 F188
- [ ] 单测：两类退出码区分；F188 cohort-batch 行为不回归
- **验收**: exit 3/4 语义分明；F188 既有测试零回归

## T-C0 并行 run 执行器 + 单测 〔依赖 C0a；阻塞 C1/C3〕（FR-005/W-6 + codex 5 CRITICAL）
- [ ] `scripts/lib/parallel-run-pool.mjs`：并发受限池（默认 4-6）spawn `eval-task-runner`/run
- [ ] **唯一键**（C-3/C-4）：每路生成唯一 `--repeat-index`+`--fixture-suffix`+`--run-id`（防 fixture 互覆盖 + 容器名冲突）
- [ ] **串行 env 预热阶段**（C-2 核心）：先串行对每 unique env（repo×version）建一次镜像，再并行跑 instance run（暖缓存无 cold-build race）
- [ ] **进程树终止**（C-5）：每 run `detached:true` 建进程组；BUDGET_MS 超限/kill 时 `kill(-pgid, SIGKILL)` 杀整树（防游离子进程）
- [ ] 预算：单 run RUN_TIMEOUT（20min）+ 整批 BUDGET_MS（35min）硬上限 + over-budget 停
- [ ] 单测（mock runner）：并发上限 / 唯一键生成确定性 / 超时 / over-budget 触发进程组 kill 信号 / exit 3vs4 分类
- **验收**: 并发度可控 + 预算硬上限可机器验收 + 唯一键防冲突 + 进程组 kill 信号正确（docker race 真验靠 C5 串行预热+smoke）

## T-C1 校准脚本 + 单测 〔依赖 C0〕（FR-001/002/003，US1）
- [ ] 启发式预筛：拉 Verified 行 → patch行数/改文件数/failToPass数 难度打分 → 固定 seed 选 ~30
- [ ] N=3 经验校准：C0 并行跑 ~30 × {c1,c3} × N=3 + 真 oracle（复用 runSwebenchInstance）+ OAuth 防污染
- [ ] noise-aware discriminating：per-cohort pass+bootstrap CI（复用 cohort-aggregate）；聚合∈[LO,HI] 且 一对 cohort CI 不重叠
- [ ] 单测：难度打分确定性 / discriminating 判据（CI 重叠 vs 不重叠 → 剔/选）/ 全饱和剔除
- **验收**: 单测绿；--dry-run 列校准计划（不实跑）；输出 schema 含 per-cohort pass+CI+判定

## T-C2 集合划分 + 单测 〔依赖 C1〕（FR-004/009，US1）
- [ ] 按 c3 pass 率分箱分层 disjoint 切两半（固定 seed）；validation 偏 c3 中段（W-4）
- [ ] 池太小报错扩候选；各集合冻结 taskSetHash+fixtureContentHash+seed → 清单+锚入库（gold 不落库）
- [ ] 单测：分层 disjoint（无重叠 + 分箱分布一致 + seed 可复现）/ 池太小报错
- **验收**: frozen/validation disjoint + 难度分布一致 + 锚冻结

## T-C3 并行验证 harness + 单测 〔依赖 C0〕（FR-005/006/008，US2）
- [ ] `scripts/eval-validate.mjs`：c3（可配）× validation × N=1 经 C0 池跑
- [ ] 聚合单一 passRate + CI + JSON；剔分母语义（只 infra 剔；生成超时=fail，CR-3）；infraFailRate>FLOOR 作废重跑（W-5）
- [ ] held-out：默认只接 validation；`--milestone-frozen` 另路跑冻结集 + 标"勿迭代用"（CR-2）
- [ ] 单测（mock run 结果）：passRate 聚合 / infra 剔分母 / 生成超时计 fail / fail-closed 触发 / 默认拒冻结集
- **验收**: 单一机读 passRate + 预算 ≤ BUDGET_MS（smoke 实测）+ timeout/infra 语义正确

## T-C4 /goal 指标入口 + 比较纪律 + 单测 〔C3 内〕（FR-007/W-2）
- [ ] 末行打印 `PASSRATE=<x> CI=[lo,hi]` 供 /goal 解析；`--baseline <prev.json>` → keep/discard（新 CI 下界 > 旧均值 + MIN_DELTA）
- [ ] 单测：比较纪律（噪声内不 keep / 超 MIN_DELTA 才 keep）
- **验收**: /goal 一条命令拿标量 + 跨版本比较纪律正确

## T-C5 冒烟 + 验证 + 报告 〔依赖 C0-C4〕
- [ ] **默认 docker-free dry-run smoke**（codex W6，守"只交代码不烧配额"）：管道装配/参数/唯一键/调度全验，不 spawn claude/docker；`--live-smoke` 显式 opt-in 才跑 ≤2 真 run（标注烧小配额，非默认）
- [ ] `npx vitest run` 全绿 + `npm run build` + `npm run repo:check`
- [ ] 校准/验证 run 产物 gitignore 校验（只清单+锚+报告入库）；显式路径提交禁 git add -A
- [ ] 校准 runbook（manual）：用户一条命令启动 ~5hr 校准批的步骤 + 凭据 preflight + 配额提醒
- **验收**: smoke 通 + 三验证绿 + 产物边界零泄漏 + runbook 可照做

## 阶段 codex 审查点（CLAUDE.local）
| phase | 时机 |
|-------|------|
| plan+tasks（本文件） | 本 commit 前 |
| implement（C0 并行池 + C1 判据 + C3 语义） | 各 commit 前（重点查并发正确性 / 判据统计性 / 剔分母语义） |
| verify | 最终 commit 前 |

## 验收映射
| SC | 任务 |
|----|------|
| SC-001 headroom | C1 |
| SC-002 预算 | C0 + C3 + C5 smoke |
| SC-003 指标可用 | C3 + C4 |
| SC-004 held-out | C2 + C3 |
| SC-005 防伪影 | C0 + C3（timeout/infra 语义）|
