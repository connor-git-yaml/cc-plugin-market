# 实施计划：F206 难度校准评测/验证 harness

**Feature**: 206-eval-calibrated-harness · **关联**: [spec.md](spec.md)
**日期**: 2026-06-23

## 架构决策

**最大化复用 F188，唯一真新增 = 并行执行器**。F188 已有：真 oracle（`runSwebenchInstance`）、生成 runner（`eval-task-runner` + OAuth 防污染 exit-3-broken）、cohort 子集（`manifest.cohorts`）、fixture import、bootstrap CI（`cohort-aggregate` 的 ci95）。F188 的 `cohort-batch` 是**串行**矩阵派发——用户要"并行几路"，需补一个**并发受限的并行 run 执行器**。

**本轮范围**：只造仪器代码 + 测试，**不实跑校准批**（CL-1，用户定时启动）。

## 组件（4 个脚本 + 1 共享执行器）

### C0 并行 run 执行器（唯一真新增，共享）`scripts/lib/parallel-run-pool.mjs`
- 并发受限池（默认 4-6）跑 N 个 (task,cohort,repeat) run，每 run = spawn `eval-task-runner`（复用）。
- 单 run 超时 `RUN_TIMEOUT`（默认 20min）+ 整批硬墙钟 `BUDGET_MS`（默认 35min，超即停标 over-budget，FR-005/W-6）。
- 资源争抢：并发度可配，docker cache_level=env 暖缓存降单 run 成本；不足降并发而非失败。

#### 🔴 并行 Docker 安全合同（codex 5 CRITICAL — F188 串行正因这些不安全；本 feature 要并行必须显式解决）
1. **唯一 runId + fixture-suffix/run-id**（C-2/C-3/C-4）：每路 run **必须**传唯一 `--repeat-index`/`--fixture-suffix` + 唯一 `--run-id`，否则 ① runner fixture `tests/baseline/tasks/<task>/<tool>/full.json` 并发互覆盖；② swebench 容器名 `sweb.eval.<instance>.<run_id>` 冲突（F188 污染同源）；③ worktree `rmSync` 互删。C0 生成 `<task>-<cohort>-r<i>-<seq>` 唯一键。
2. **env 镜像串行预热阶段**（C-2，核心）：官方 harness `--cache_level env` 的 `docker_build.py` cold-build **无跨进程锁**，N 路并发首次冷建同一 env 镜像会抢同一 tag/build dir → 镜像损坏。**解法**：C0 分两阶段——先**串行**对每个 unique env（instance 的 repo×version）预热建一次镜像（warm cache），再**并行**跑 instance run（暖缓存下无 cold-build race）。预热可用 `--limit-per-env 1` 串行跑。
3. **进程树终止**（C-5）：BUDGET_MS 超限或 kill 时，runner 内 `spawnSync('claude')`/`spawnSync(py)` 是子进程树——父池**必须** `process.kill(-pgid, SIGKILL)`（杀进程组）或 detached + group kill，否则留 claude/python/docker 游离 + 半写 fixture。每 run spawn 时 `detached:true` 建独立进程组。
4. **exit 码拆分**（C-1）：F188 当前 eval-task-runner 把 `genInfra.failed || timedOut` 合并 exit 3。C0 前置需把它拆：**exit 3 = infra（OAuth/api，剔分母/可重跑）/ exit 4 = 生成超时（=能力 fail，不剔）**，对齐 CR-3 语义。这是 C0 的 runner 侧前置改动（小，含测试）。
- **本轮交付**：C0 实现含上述合同 + 单测（mock 验并发上限/超时/进程组 kill 信号/唯一键生成）；docker race 等真并发路径靠 C5 的串行预热 + 小 smoke 验，纯函数 mock 覆盖不到（codex W4 诚实标注）。

### C1 校准脚本 `scripts/eval-calibrate.mjs`（US1）
1. **启发式预筛**（CL-1）：拉 Verified 500 行，按 patch 行数 / 改文件数 / failToPass 测试数 等中等难度代理打分，固定 seed 选 ~30 候选。
2. **N=3 经验校准**：C0 并行跑 ~30 × {c1,c3} × N=3，真 oracle 判分。
3. **noise-aware discriminating**（FR-003/CR-1）：每 cohort N=3 估 pass 率 + bootstrap CI（复用 cohort-aggregate）；保留 聚合 pass∈[LO,HI] **且** 至少一对 cohort CI 不重叠 的任务；剔全饱和 + 剔噪声内伪区分。
4. 输出 calibrated pool（每任务 per-cohort pass+CI + discriminating 判定）→ 校准报告（manual 入库）+ 中间产物（不入库）。

### C2 集合划分 `scripts/eval-split-sets.mjs`（US1，FR-004/W-3）
- 对 calibrated pool 按 c3 pass 率分箱（如 低/中/高三档）**分层** disjoint 切两半（固定 seed）→ frozen + validation。
- **c3 敏感性**（FR-009/W-4）：validation 优先收 c3 中段（非 0 非 1）任务。
- 池太小（<2×验证集目标）→ 报错让扩候选重校准，不强切。
- 各集合冻结 taskSetHash + fixtureContentHash + seed → 入库清单 + 锚（gold 不落库，CR-2）。

### C3 并行验证 harness `scripts/eval-validate.mjs`（US2，/goal 入口）
- 默认 c3（可配 cohort）× validation × N=1，经 C0 并行池跑（~30min 预算）。
- 聚合：单一标量 `passRate` + bootstrap CI + 机读 JSON `{passRate, ci, n_valid, n_total, n_pass, infraFailRate, genTimeoutCount, wallClockMs, perTask}`。
- **剔分母语义**（CR-3/W-5）：只 infra 剔分母；生成超时=fail；`infraFailRate > FLOOR`（默认 20%）→ 作废 exit 非 0 重跑（不出失真可比值）。
- **held-out**（CR-2）：默认入口只接 validation 集 id；`--milestone-frozen` 显式命令才跑冻结集（另路），其结果带"勿用于 /goal 迭代"标。

### C4 /goal 集成（薄封装，FR-007/W-2）
- `eval-validate.mjs` 即 /goal 度量入口：一条命令 → stdout 末行打印 `PASSRATE=<x> CI=[lo,hi]`，便于 /goal 解析 keep/discard。
- 比较纪律：harness 可选 `--baseline <prev.json>`，按 **新 CI 下界 > 旧均值 + MIN_DELTA** 输出 keep/discard 建议（防 n≈10 噪声抖动）。

## 测试（本轮交付，纯函数为主，不跑 docker）

- 启发式难度打分（C1）：样例 row → 难度分 + 预筛选择确定性。
- noise-aware discriminating 判据（C1）：CI 重叠/不重叠样例 → 选/剔正确。
- 分层 disjoint 划分（C2）：池 → 两集合 disjoint + 分箱分布一致 + seed 可复现。
- passRate 聚合 + timeout/infra 语义（C3）：mock run 结果 → passRate / infra 剔分母 / timeout 计 fail / fail-closed 触发。
- 比较纪律（C4）：新旧 CI → keep/discard 判定。
- 并行池（C0）：mock runner，验证并发上限 + 超时 + over-budget 停。

## 风险登记

| 风险 | 缓解 |
|------|------|
| **并行 docker cold-build race**（codex C-2）| **串行 env 预热阶段** + 暖缓存后并行（见 C0 安全合同） |
| **并发容器名/fixture 冲突**（codex C-3/C-4，F188 污染同源）| 每路唯一 runId + fixture-suffix（C0 硬合同） |
| **over-budget 留游离子进程**（codex C-5）| detached 进程组 + `kill(-pgid, SIGKILL)`（C0 硬合同） |
| **exit-3 混淆 infra/gen-timeout**（codex C-1）| 拆 exit 3(infra)/4(gen-timeout)，runner 侧前置改动 |
| 校准选不出够数 discriminating | 扩候选重校准（不放宽判据混饱和），spec Edge Case |
| validation 几轮后被过拟合 | 里程碑冻结集检测（C3 --milestone-frozen），spec FR-008 |
| **启发式预筛偏掉真中段任务**（codex W3）| 预筛只缩池不定终选 + **加随机保底桶**（一部分候选不经预筛随机入池，审计预筛偏差）；终选靠经验校准真 oracle spread |
| **校准 N=3 统计力弱**（codex W2）| N=3 是成本下限；CI 不重叠判据从严；标注"中等难度初判，几轮后用验证集实际区分度回检" |
| **校准早停未落地**（codex W1，spec FR-002 MUST）| C1 实现增量校准：每候选判完即更新 discriminating 计数，够数即停（不必跑满 30） |
| **本轮不跑校准 → C2 无真 pool 验收**（codex W5）| C2 单测用**合成 calibrated-pool fixture**（人造 per-cohort pass+CI），验分层切分逻辑；真 pool 待校准跑后 |
| **smoke 烧配额**（codex W6，与"只交代码"冲突）| C5 smoke **默认 docker-free dry-run**（验管道装配，不 spawn claude）；真 ≤2-run smoke 设 `--live-smoke` 显式 opt-in，标注烧小配额，非默认 |

## 不做（范围外）

- 不实跑 ~5hr 校准批（用户定时启动）。
- 不跑 /goal 实际优化循环（仪器就绪后的后续工作）。
- 不改 F188 oracle/cohort/判分语义。
- 不做自动复校准（饱和漂移只给提示）。
