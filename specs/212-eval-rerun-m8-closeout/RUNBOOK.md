# RUNBOOK — 212 M8 收官付费批（headline 33-run + 触发率 A/B 60-run）

> 全部命令在 **worktree** `.claude/worktrees/m8-closeout-212`（含 T0 + 驱动 + 重建 fixtures + `.env.local` 副本；
> 主 checkout 没有 venv/fixtures）。**慢验窗口内禁改 `plugins/**`**（eval 活读 worktree plugin）。
> v2 修正：headline 执行链从 cohort-batch 改为 **eval-pool-rerun**（F206 全池结算同链 = validate/pool 家族，
> driver=claude-sonnet-4-6；cohort-batch 是 F176/188 epoch 的 A/B 链，driver=claude-opus-4-7，两链不互比 C1 红线）。

## 0. 前置状态（本轮已备 ✅ / 用户须做 ❌）

| 项 | 状态 |
|----|------|
| swebench venv（4.1.0）+ HF 离线缓存 | ✅ worktree 内建好 |
| fixtures 30 个重建 + F176 锚字节级命中（19d8d42）| ✅（POOL-RECOVERY.md）|
| 全池 11 task 清单 + 集合锚验证 | ✅ pool-11.json |
| oracle 语义 re-freeze（f4044f21，T0 后冻结）+ 三 hash 门 PASS | ✅ specs/176 prereg |
| `.env.local`（SiliconFlow jury）副本 | ✅ worktree（gitignored）|
| Docker daemon | ✅ 已拉起（重启后需再起）|
| Surge 代理（HTTPS_PROXY=6152）| ✅ 在监听（发射器有活门禁）|
| **Claude OAuth** | ❌ **`claude /login`**（401 过期；唯一剩余人工步骤）|
| 全局 plugin disable | 发射器自动做 + trap 恢复（spec-driver + spectra 两个）|

## 1. 发射器（一条命令跑完两批）

发射器脚本：session scratchpad `f212-launch.sh`（未入库；内容=本节流程的机械化）。
它按序做：OAuth/docker/proxy preflight → `build-spectra-stamped`（dist 门禁）→ disable 两个全局
plugin（trap 保证恢复）→ **headline** → 成功才进 **A/B** → 标记文件 `.calibration-output/f212-batch-status.json`。

手工等价（如需拆开跑）：

```bash
cd .claude/worktrees/m8-closeout-212
node scripts/build-spectra-stamped.mjs
claude plugin disable spec-driver@cc-plugin-market --scope user
claude plugin disable spectra@cc-plugin-market --scope user
# ── headline：c3 × 11 × N=3 = 33 run（~5-7hr，driver sonnet-4-6，无 jury 零 SiliconFlow）──
node scripts/eval-pool-rerun.mjs --output .calibration-output/f212-headline.json   # 断点续: 加 --resume
# ── A/B：c1/c3 × 10 × N=3 = 60 run（driver opus-4-7 + jury SiliconFlow <$20）──────────
node scripts/swe-bench-verified-cohort-batch.mjs \
  --manifest specs/212-eval-rerun-m8-closeout/ab-manifest.json --full            # 断点续: 加 --resume
claude plugin enable spec-driver@cc-plugin-market --scope user
claude plugin enable spectra@cc-plugin-market --scope user
```

## 2. 护栏（跑批中）

- **配额**：每 6 run 打人工提醒行（两条链都有）；≥60% weekly → Ctrl-C 中断，`--resume` 无损续。
- **fail-closed**：headline 连续 2 task 全剔除 → 自动中止 partial 落盘 exit 2（OAuth 中途过期/代理挂烧不穿）；
  cohort-batch 同款 broken 判定 + resume。
- **取证**：headline 驱动**拒绝无 --resume 覆盖已有 output**；重要取证先存档再重跑。
- OAuth 长批/隔夜 resume 前必 `claude /login` preflight（发射器起批时自动探测）。
- F208 enforcement=block：评测 cwd 无 fix-compliance 配置 → 默认 block（无需任何开关，勿注入 off）。

## 3. 判定口径（预注册）

- **headline**：全池 c3 passRate（N=33 剔除后分母诚实报）vs 对照锚 GStack 90.9% / c1 77.4% / 战役后 81.8% /
  F208 预测 ~88%；坍塌率对照（战役期 20-30% → 实测：从 run 产物委派计数/fix-report 缺失判坍塌）；逐任务
  对照（V008 ≥2/3 是 F208 结构性收益的靶心信号；V006 全场坟场预期仍 0）。
- **A/B 指标 1 触发率**：c3 每 run `mcpTrace` callCount 总和（fixture 内建采集，与 F176 1.77 基线同源），
  均值 + bootstrap 95% CI；"显著提升" ⟺ CI 下界 > 1.77；"达标" ⟺ CI 下界 ≥ 2.0；跨越 → 噪声带内。
- **A/B 指标 2 完成率 lift**：c3/c1 真 oracle passRate lift（同批同 oracle）。
- **C1 红线**：headline（sonnet 链）与 A/B（opus 链）不同 driver epoch，禁互比 c3 绝对率。

## 4. 跑后回填

四方终表 + 坍塌率 → PUBLISH-REPORT-M8 §3/§5；A/B 双指标 → §4；M8-SC-002/004 闭合裁定 → §6；
dogfooding 四维度 → §7。push 前列 report 等用户确认；产物不入库（全在 gitignored 路径）。
