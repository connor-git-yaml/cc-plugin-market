# F206 校准运行手册

> **用途**：用户参照此手册，在 Claude Max 配额充足时一条命令启动 ~5hr 校准批，获得难度校准后的任务集合，再生成 frozen/validation 两套 held-out 评测集。
> **入库**：此文件入库（manual）；calibrated-pool.json / sets.json 等运行产物**不入库**（gitignore）。

---

## 凭据 preflight（必做，3 分钟）

```bash
# 1. swebench venv（校准跑真 Docker FAIL_TO_PASS oracle，需完整 swebench harness）
#    若曾只装 datasets（如仅跑过 fixture 导入），此步幂等补全 swebench
bash scripts/setup-swebench-venv.sh   # 需 python3.12；首次装 swebench 较慢

# 2. Docker 可用（FAIL_TO_PASS 测试在容器内执行）
docker ps > /dev/null && echo "Docker OK"

# 3. Claude API 连通（校准 driver = claude --print；OAuth 过期或本地代理没开都会整批 infra 失败）
#    ⚠️ 必须在**将要跑校准批的同一个终端**里跑——shell 若导出 HTTPS_PROXY 指向本地代理
#    （如 Surge 127.0.0.1:6152），代理没在运行时所有 run 会 ConnectionRefused
#    （2026-06-29 实测 106/106 run 全废，批"看着在跑"因为 Docker oracle 不走该 env）
echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text
# 期望输出: ok
# 报 "Unable to connect to API (ConnectionRefused)" → 先启动代理 App（或 unset 代理变量）再重测
# 报 401/authentication → claude /login 重新授权（不要换 API key 模式，成本 ~50×）

# 4.（可选）SiliconFlow API key —— 仅当 /goal 验证启用 jury 评分时需要；
#    纯 Docker oracle 的校准/验证不读 jury，可跳过
grep -c "^export SILICONFLOW_API_KEY=" .env.local  # 启用 jury 时应输出 1
```

eval-calibrate 起批时会**自动再跑一次连接门禁**（同 env 继承真连一次，失败拒绝启动，exit 3）；
上面手动步骤仍保留——提前 3 分钟发现问题好过启动时才被拒。批跑数小时的场景**保持代理 App 全程运行**。

---

## Step 1：启发式预筛 + 列候选（~2min，不烧配额）

```bash
node scripts/eval-calibrate.mjs --list-candidates 2>&1 | head -30
```

确认列出 ~24 个候选任务 id（当前 30 fixture 池经启发式预筛，CANDIDATE_COUNT=30 cap）。如候选太少 → fixture 目录问题，检查 `tests/baseline/swe-bench-verified/fixtures/`；需扩池见文末「扩候选池」。

---

## Step 2：N=3 经验校准批（~3–6hr，target=6 早停，烧 Claude Max 配额约 18–30 turns/task）

```bash
# 默认 4-6 路并发；可通过 --concurrency 调低（配额紧时用 2）
node scripts/eval-calibrate.mjs \
  --concurrency 4 \
  --target 6 \
  --output-dir .calibration-output 2>&1 | tee .calibration-output/calibrate.log
```

**为何 target=6（不是 10）**：当前 30 fixture 池过预筛得 24 候选，经区分度筛选后预期 discriminating 约 12–17 个；split 要求池 ≥ 2×target，故 target=6 稳妥（需 ≥12 个）。要 target=10 须先扩候选池到 ~45（见文末），否则 split 会「池太小」报错。

**注意事项**：
- target=6 早停：找够 6 个 discriminating 即止，未必跑满 24 候选，故实际可能 ~3hr 收工。
- 首次跑会串行预热 env 镜像（约 9min/env），后续 warm run 约 1-2min。
- 过 6hr 还没出结果 → 检查 `.calibration-output/calibrate.log` 里 infra 失败率，如 > 30% 停下检查 OAuth。
- 配额监控：跑批 ≥ 30 runs 每 6 runs 看一次 Claude Max dashboard，≥ 60% weekly → 分日跑。

---

## Step 3：查看校准结果

```bash
cat .calibration-output/calibrated-pool.json | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); \
  console.log('discriminating:', d.meta.discriminatingCount, '/', d.meta.totalCandidates); \
  d.calibratedPool.filter(e=>e.discriminating).forEach(e=>console.log(e.taskId, JSON.stringify(e.perCohort?.c3?.passRate?.toFixed(2))))"
```

看 `discriminatingCount`：< 12 → 降 `--target`（如 4–5）重跑 split；≥ 16 → 可上调到 `--target 8`。若想稳定 target=10，扩候选池到 ~45（见文末「扩候选池」）后重跑校准。

---

## Step 4：分层 disjoint 划分（<1min）

```bash
node scripts/eval-split-sets.mjs \
  --pool .calibration-output/calibrated-pool.json \
  --target 6 \
  --seed 42 \
  --out .calibration-output/sets.json
```

输出会打印 `frozen anchor taskSetHash` 和 `validation anchor taskSetHash`——把这两个 hash 记录到 specs/206-eval-calibrated-harness/verification/ 的锚文件中（手动操作，作为 held-out 合同）。

---

## Step 5：验证集 smoke 跑（~30min，验证 harness 可用）

```bash
node scripts/eval-validate.mjs \
  --sets .calibration-output/sets.json \
  --goal \
  --output .calibration-output/validate-result.json
```

stdout 末行应打印 `PASSRATE=0.xx CI=[lo,hi]`，表示 harness 端到端通。

---

## Step 6：/goal 持续优化（每轮 ~30min）

```bash
# 基准跑（保存 baseline）
node scripts/eval-validate.mjs --sets .calibration-output/sets.json --goal \
  --output .calibration-output/baseline.json

# 改完代码后对比
node scripts/eval-validate.mjs --sets .calibration-output/sets.json --goal \
  --baseline .calibration-output/baseline.json \
  --output .calibration-output/current.json
# 末行：PASSRATE=0.xx CI=[lo,hi]
# 倒数第二行：比较 vs baseline: KEEP/DISCARD — 原因
```

**比较纪律**（spec FR-007）：只有 `新 CI 下界 > 旧均值 + 0.05` 才输出 KEEP。否则 DISCARD = 噪声内伪进步，不算真改进。

---

## 里程碑冻结集对比（谨慎使用）

```bash
# ⚠️  此结果只用于里程碑对比，勿用于 /goal 迭代
node scripts/eval-validate.mjs --sets .calibration-output/sets.json --milestone-frozen --goal
```

---

## 常见问题

| 问题 | 解决 |
|---|---|
| 起批被连接门禁拒绝（exit 3） | 本地代理（HTTPS_PROXY 指向的 Surge 等）没在跑 → 启动代理；或 OAuth 过期 → `claude /login`；修好后重跑 |
| 某候选剔除率（infra+error）> 30% | 该候选自动标 `lowConfidence`（不计入 discriminating），批继续；如多个候选如此 → 检查代理 App 是否中途退出 / OAuth → `claude /login` |
| 连续 2 候选剔除率 ≥ 50% 中止（exit 2） | 系统性故障（连接 / flag 错配 / 版本门禁），已跑数据（含触发中止的候选）在 partial pool；修好后重跑 |
| 池太小报错 | 降低 `--target` 或扩候选池（见下「扩候选池」）|
| Docker 冷建镜像超时 | 串行预热已内置；如仍超时用 `--run-timeout-ms 1200000`（20min） |
| 配额耗尽 | 分日跑（校准批分 2-3 天）；用 `--concurrency 2` 降速 |

---

## 扩候选池（想要更大 target 时）

候选 fixture 在 `tests/baseline/swe-bench-verified/fixtures/`（gitignore，本地 eval 产物）。当前 30 个（7 repo）支撑 target≈6。要 target=8/10 需扩到 ~42/~45。

用官方 importer 从本地缓存的 SWE-bench Verified 增量导入（`--task-prefix` 用新值避免覆盖已有 fixture）：

```bash
# 一次性：建 venv 装 datasets（仅导入需要；跑校准另需 setup-swebench-venv.sh 的完整 swebench）
python3.12 -m venv scripts/.swebench-venv && scripts/.swebench-venv/bin/pip install -q datasets

# 增量导入（轻量 repo，避免 django/matplotlib 重型 Docker 镜像）；SWE-VC 前缀不碰已有 SWE-V/SWE-VB
HF_DATASETS_OFFLINE=1 scripts/.swebench-venv/bin/python scripts/swe-bench-fixture-import.py \
  --dataset princeton-nlp/SWE-bench_Verified \
  --task-prefix SWE-VC --dataset-tag verified --fixtures-subdir swe-bench-verified \
  --repos sphinx-doc/sphinx,pydata/xarray,pylint-dev/pylint,astropy/astropy \
  --max-patch-files 3 --limit 15 --min-fixtures 10 \
  --output-dir tests/baseline/swe-bench-verified/fixtures/
```

导入后 `node scripts/eval-calibrate.mjs --list-candidates` 复核候选数，再按新 target 重跑 Step 2。
> 注：Verified 多数 issue 在 2022–2023（早于多数模型 cutoff），importer 默认取最新日期以降泄漏；校准测的是 cohort 间「区分度差值」，绝对泄漏对结论影响有限。
