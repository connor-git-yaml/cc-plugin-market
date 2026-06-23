# F206 校准运行手册

> **用途**：用户参照此手册，在 Claude Max 配额充足时一条命令启动 ~5hr 校准批，获得难度校准后的任务集合，再生成 frozen/validation 两套 held-out 评测集。
> **入库**：此文件入库（manual）；calibrated-pool.json / sets.json 等运行产物**不入库**（gitignore）。

---

## 凭据 preflight（必做，3 分钟）

```bash
# 1. SiliconFlow API key（jury judge 用）
grep -c "^export SILICONFLOW_API_KEY=" .env.local  # 应输出 1

# 2. Claude Max OAuth（校准 driver = claude --print）
echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text
# 期望输出: ok

# 3. Docker 可用
docker ps > /dev/null && echo "Docker OK"
```

如果 Claude OAuth 失效 → `claude /login` 重新授权（不要换 API key 模式，成本 ~50×）。

---

## Step 1：启发式预筛 + 列候选（~2min，不烧配额）

```bash
node scripts/eval-calibrate.mjs --list-candidates 2>&1 | head -30
```

确认列出 ~30 个候选任务 id。如候选太少 → fixture 目录问题，检查 `tests/baseline/swe-bench-verified/fixtures/`。

---

## Step 2：N=3 经验校准批（~4–6hr，烧 Claude Max 配额约 18–30 turns/task）

```bash
# 默认 4-6 路并发；可通过 --concurrency 调低（配额紧时用 2）
node scripts/eval-calibrate.mjs \
  --concurrency 4 \
  --target 10 \
  --output-dir .calibration-output 2>&1 | tee .calibration-output/calibrate.log
```

**注意事项**：
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

如 discriminating 数 < 10 → 扩候选重跑（`--target 8` 降低要求 或 `--candidate-pool` 传更大池）。

---

## Step 4：分层 disjoint 划分（<1min）

```bash
node scripts/eval-split-sets.mjs \
  --pool .calibration-output/calibrated-pool.json \
  --target 10 \
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
| `infraFailRate > 20%` 作废 | 检查 OAuth → `claude /login`；重跑 |
| 池太小报错 | 降低 `--target` 或扩候选（`--candidate-pool` 传更多候选）|
| Docker 冷建镜像超时 | 串行预热已内置；如仍超时用 `--run-timeout-ms 1200000`（20min） |
| 配额耗尽 | 分日跑（校准批分 2-3 天）；用 `--concurrency 2` 降速 |
