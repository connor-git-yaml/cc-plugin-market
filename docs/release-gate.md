# Release Gate（Feature 147 SC-009）

> **本仓库 spectra / spec-driver 核心代码改动的 PR 必须跑 `npm run eval:refresh-self` 并附 diff report。文档软约束（不强制 hook 拦截）。**

---

## 触发条件

PR diff 包含以下路径中**任一**改动：

```
src/generator/**         # spec 生成器
src/batch/**             # batch orchestrator
src/panoramic/**         # panoramic pipeline
src/graph/**             # graph 构建
src/mcp/**               # MCP server
plugins/spec-driver/agents/**     # spec-driver agent prompts
plugins/spec-driver/scripts/**    # spec-driver runtime scripts
plugins/spec-driver/contracts/**  # spec-driver schema / orchestration contracts
```

→ 触发 release gate B（文档软约束）。

---

## PR 描述必含

PR 模板已含 checkbox。提交 PR 时必须勾选其中一个：

```markdown
## Release Gate (F147 SC-009)
- [ ] 不触及 spectra / spec-driver 核心代码（如纯文档 / 纯测试 / 仅 scripts/ 改动）
- [ ] 触及核心代码，已跑 `npm run eval:refresh-self` 并附 diff report 链接（见下方）
- [ ] 触及核心代码但暂不重跑（说明理由 + 风险评估）

### Diff report
（如已跑 eval:refresh-self，把 `npm run baseline:diff` 输出粘贴到此处）

```

---

## 跑 eval:refresh-self 的标准流程

### 完整版（cost ~$15-20，~30-50 min）

```bash
# 1. 备份当前 fixture（用于 diff 对比）
mkdir -p /tmp/baseline-prev
cp -R tests/baseline /tmp/baseline-prev/

# 2. build
npm run build

# 3. 跑 spectra perf + spec-quality 重评（3 项目）
npm run eval:refresh-self

# 4. （可选）跑 grounding 重评（micrograd add tanh）
npm run eval:refresh-self -- --grounding

# 5. （可选）跑 spec-driver task 重跑（如改动了 spec-driver agents/scripts）
npm run eval:refresh-self -- --tasks T1-micrograd-add-tanh

# 6. 对比 diff
for proj in micrograd nanoGPT self-dogfood; do
  echo "=== $proj spectra ==="
  npm run baseline:diff -- /tmp/baseline-prev/baseline/$proj/spectra/full.json tests/baseline/$proj/spectra/full.json
done

# 7. 把 diff 粘贴到 PR 描述（仅放 perf + quality 关键差异）
```

### 缩水版（cost ~$2-5，~5-10 min）

仅跑 spec-quality judge 重评（不重跑 spectra batch）：

```bash
npm run eval:refresh-self -- --skip-perf
```

适合：只改了 spec-driver agent prompts 等不影响 spectra perf 的代码。

---

## 阈值（基于 baseline-diff regression mode）

`baseline-diff` 默认 thresholds（详见 [scripts/baseline-diff.mjs](../scripts/baseline-diff.mjs)）：

| 维度 | 黄色 | 红色 |
|------|------|------|
| `perf.totalWallMs` | +10% ~ +20% | > +20% |
| `perf.tokensInputPlusOutput` | +5% ~ +15% | > +15% |
| `perf.estimatedCostUsd` | +10% ~ +20% | > +20% |
| `output.graphNodeCount` | ±10% | ±20% |
| `output.specSuccessRatio` | < 95% | < 90% |
| `quality.judgeSpecQuality.score` | -1 | -2 |

**红色 = block**：建议 PR 暂缓 merge，分析回归原因后决定是否接受 / 修正。  
**黄色 = warn**：可以 merge，但 PR 描述需说明合理性。  
**绿色 = pass**：无需特殊说明。

---

## 跨 commit 比较的标准命令

```bash
# 与 master 最新 fixture 比较
git show origin/master:tests/baseline/self-dogfood/spectra/full.json > /tmp/master-fixture.json
npm run baseline:diff -- /tmp/master-fixture.json tests/baseline/self-dogfood/spectra/full.json

# 与上一个发布 tag 比较
git show v4.1.1:tests/baseline/self-dogfood/spectra/full.json > /tmp/v4.1.1-fixture.json
npm run baseline:diff -- /tmp/v4.1.1-fixture.json tests/baseline/self-dogfood/spectra/full.json
```

---

## 频率与覆盖

- **必须跑**：spectra 主版本升级（4.x → 5.x）/ batch / panoramic / graph 核心改动
- **建议跑**：每月 1 次（cron-friendly，但本仓库不强制 cron）
- **可跳过**：纯 scripts/ 改动（如 baseline-collect.mjs 自身重构）/ 纯文档 / 纯测试

---

## 升级 release gate 到 hook 强制

当前是 release gate B（文档软约束）。如未来需升级到 A（hook 强制），步骤：

1. 加 `.git/hooks/pre-push`（或 `.husky/pre-push`）：
   ```bash
   #!/bin/sh
   if git diff --name-only HEAD~1 | grep -qE '^(src/(generator|batch|panoramic|graph|mcp)|plugins/spec-driver/(agents|scripts|contracts))/'; then
     echo "F147 release gate: 触及 spectra/spec-driver 核心，请确认已跑 npm run eval:refresh-self"
     read -p "已跑并附 diff report 到 PR 描述？(y/n): " confirm
     [ "$confirm" = "y" ] || exit 1
   fi
   ```
2. 提交此 hook 到仓库
3. 更新 PR 模板说明

但当前 release gate B 已足够；**不主动升级 A**（避免开发流程被 hook 卡住）。

---

## 已知偏差

- `eval:refresh-self` 不能完整自动化 SuperPowers / GStack 重跑（cost 大 + plugin 安装路径不同）；如改动了对 4 工具对比的逻辑，需手动 trigger 完整 task-runner 矩阵
- Permission 阻塞（git commit / pytest）让 4 工具 task-execution 全工具一致扣分；diff 时此维度不变化（噪声 = 0）

---

*Release gate 文档由 Feature 147 Phase 5 落地。2026-04-30。*
