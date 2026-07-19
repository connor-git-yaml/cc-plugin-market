# RUNBOOK — 212 M8 收官付费批（headline 全池复测 + 触发率 A/B）

> 面向"专用执行会话"（用户在 host shell 有配额窗口时启动）。所有命令在 **host shell**
> 主 checkout `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market`（`.env.local` 在此）；
> 代码版本 = worktree `m8-closeout-212`（branch `212-eval-rerun-m8-closeout`，T0 已合）。
> **慢验窗口内禁改 `plugins/**`**（eval 活读 worktree plugin，中途改=两 take 测不同版本）。

## 0. 前置（3 项用户动作 + 2 项已备）

| 项 | 状态 | 动作 |
|----|------|------|
| SiliconFlow key | ✅ 已备 | `.env.local` 有 `SILICONFLOW_API_KEY`（jury 实付 <$20） |
| swebench venv | ✅ 已备（本轮建） | `scripts/.swebench-venv`（swebench 4.1.0，gitignored）；幂等，重跑 `bash scripts/setup-swebench-venv.sh` |
| **Claude OAuth** | ❌ **须做** | `claude /login`（现 401 过期）；隔夜 resume 前必再 preflight |
| **全局 spectra plugin** | ❌ **须做** | `claude plugin disable spectra@cc-plugin-market --scope user`（188 launch 阻塞；否则 entryValidation hard-fail / c3 MCP 测量失真）。跑完可 re-enable |
| **Docker daemon** | ❌ **须做** | 启动 Docker Desktop（现 daemon DOWN；oracle 走 `swebench.harness.run_evaluation` 需 docker，每 repo 多 GB 镜像首拉慢） |

**F208 enforcement=block**：无需配置项——`208/spec.md` W-1/FR-015：评测环境无项目配置 → enforcement **默认 block**。runbook 只须**确保不注入 `off` override**（不在评测 cwd 放 fix-compliance 配置 / 不设关闭 env）。

## 1. 起批前 preflight（每次启动，含 resume）

```bash
cd /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market
# 凭据三查
grep -c "^export SILICONFLOW_API_KEY=" .env.local            # 期望 1
echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text   # 期望 ok（否则先 claude /login）
docker info >/dev/null 2>&1 && echo "docker UP" || echo "docker DOWN → 启动 Docker Desktop"
claude plugin list | grep spectra@cc-plugin-market           # 确认已 disable（不应显示 enabled）
# 抗污染三重门（复用 F176 prereg 作 checkPreregistration 锚，oracleSpecHash=f4fbd0f9）
node scripts/freeze-preregistration.mjs --swebench-oracle --manifest <manifest.json>   # 或直接复用 F176 prereg 校验
```
⚠️ **T0 已确认不扰 oracleSpecHash**（由 manifest+fixture/prompt hash 派生，不含 eval-calibrate.mjs）→ 三重门应与 F176/F197 冻结值一致；不一致 = hard-fail，查语义模块为何变动，**禁跑中换判分**。

## 2. Run 集 1 — headline 全池复测（F208 block 下 c3≈88% 验证）

**目的**：F208 enforcement=block 下重跑 F206 全池（33 held-out task，N=1/task/cohort），回答 c3 真实水平。
**对照锚**：c5 GStack 90.9% / c1 裸 Claude 77.4% / c3 战役后 81.8% → F208 预测 ~88%。

```bash
# manifest（写到评测 cwd，勿 git add）：cohorts=c1/c3 最小集，真 oracle，冻结 timeout
cat > /tmp/212-headline-manifest.json <<'JSON'
{ "cohorts": ["baseline-claude", "spec-driver-spectra-mcp"],
  "swebenchOracle": true, "swebenchTimeoutMs": 300000,
  "repeat": 1, "quotaCheckInterval": 6 }
JSON
# 全池 33-task 池：沿用 F206 held-out 池（见 specs/206 campaign-2 报告 §结算）——run-prep 确认池 id 列表接入
node scripts/swe-bench-verified-cohort-batch.mjs --manifest /tmp/212-headline-manifest.json --swebench-oracle
```
driver = claude-opus-4-7（cohort-batch 用 Claude OAuth）；jury = claude-opus + GLM-5.1 + Kimi-K2.6（SiliconFlow 实付）。
**⚠️ run-prep 待确认**：headline "33 run" = F206 全 33 held-out task 池（N=1）。cohort-batch 默认任务池须核对 = F206 结算同池（否则口径不可比）。若默认池 ≠ 33 held-out，须在 manifest 指定 taskset。

## 3. Run 集 2 — 触发率 A/B（完成 188 遗留 P2 / SC-002）

**目的**：c1/c3 × 10 task × N=3 = 60 runs，测双指标（触发率 + 完成率 lift）vs F176 基线。

```bash
export SPECTRA_MCP_TELEMETRY_PATH=run_artifacts/212-ab/mcp-trace.jsonl
export SPECTRA_MCP_RUN_ID=212-ab-$(date +%Y%m%d)   # 注：脚本内禁用 Date.now，此为 shell 侧标签，OK
cat > /tmp/212-ab-manifest.json <<'JSON'
{ "cohorts": ["baseline-claude", "spec-driver-spectra-mcp"],
  "swebenchOracle": true, "swebenchTimeoutMs": 300000,
  "repeat": 3, "quotaCheckInterval": 6 }
JSON
node scripts/swe-bench-verified-cohort-batch.mjs --manifest /tmp/212-ab-manifest.json --swebench-oracle
```
**双指标判定（机判）**：
- 指标 1 触发率：c3 每 run MCP 调用数（`parent_tool_use_id` 子代理归因），均值 + bootstrap 95% CI。"显著提升 vs F176" ⟺ CI 下界 > 1.77；"达标" ⟺ CI 下界 ≥ 2.0；CI 跨越 → 噪声带内不显著。
- 指标 2 完成率 lift：c3/c1 真 oracle passRate lift（c1 触发率恒 0，不入 lift 分母）。

## 4. 配额护栏（跑批中）

- 每 **6 runs** 查 Claude 配额 dashboard；weekly ≥ **60%** → **停下问用户**（分日跑 or 终止），不擅自烧穿。
- SiliconFlow jury 实付 < $20；jury 失败不静默 —— 401/限流暂停不产假阴性。
- OAuth 跑批中过期 → 暂停 + `claude /login` 再 resume。

## 5. 取证隔离（护栏）

- 每 run 集用**独立 runId**；validate/池 runId **跨批复用会覆盖 run_artifacts 取证现场** → 重要取证先存档再重跑。
- 评测产物**不入库**：`run_artifacts/**`、`scripts/.swebench-venv/**`、`logs/run_evaluation/**`、`*.tgz`、`patch.diff`、`*.jsonl` 全 gitignore。提交只显式路径，**禁 `git add -A`**。
- 慢验窗口内 **禁改 `plugins/**`**。

## 6. 跑后回填

- headline：四方终表更新（c3 F208 后新数）+ 坍塌率对照（战役期 20-30% → F208 后实测）+ N=33 噪声带诚实标注 → `PUBLISH-REPORT-M8.md §headline`。
- A/B：双指标 → `§ab`。
- 闭合 M8-SC-002（触发率）/ SC-004（评测可信度，已由 T0 + 133 引用 188 支撑）裁定。
- dogfooding 四维度反馈节。
- push 前列 report 等用户确认；`specs/**/src.spec.md` 排除出 commit。
