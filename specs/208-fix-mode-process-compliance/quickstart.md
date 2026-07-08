# Quickstart：Fix 模式流程依从性结构化保障

本指南面向 implement/verify 阶段的开发者与 GATE_DESIGN 审查者，说明如何本地验证本特性的核心行为，不替代 tasks.md 的正式任务清单。

## 1. 前置准备

```bash
cd <本 worktree 根目录>
npm ci   # 确保 node_modules 完整（避免 F193 worktree 软链坑）
```

## 2. 用 `--mode report` 只读验证判定逻辑（无副作用，推荐先跑这个）

```bash
# 用一份真实或构造的 transcript 样本
node plugins/spec-driver/scripts/fix-compliance-judge.mjs \
  --mode report \
  --project-root . \
  --transcript-path /path/to/sample-transcript.jsonl
```

预期输出：`ComplianceVerdict` JSON（见 `data-model.md` §7），无落盘副作用、退出码恒为 0。

## 3. 单元测试

```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs
node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs   # 若拆分为独立文件
node --test "plugins/spec-driver/tests/**/*.test.mjs"              # 全量 plugin 测试
npx vitest run                                                      # 仓库主测试套件（不应受本次改动影响）
```

## 4. 用构造 payload 验证 hook 阻断/放行行为（`--mode hook`）

```bash
# 场景 A：transcript 不存在（判定异常 → FR-013 fail-open，exit 0）
echo '{"session_id":"test-1","transcript_path":"/nonexistent","stop_hook_active":false}' | \
  node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode hook --project-root .
echo "exit=$?"   # 期望 0

# 场景 B：payload 指向固定 fixture transcript（含 fix 展开痕迹 + 0 委派 + 无制品）→ 应阻断
# 注意：--mode hook 的 stdin 必须是 HookPayload JSON（CLI 合同），transcript 本体经 transcript_path 引用
printf '{"session_id":"test-collapse","transcript_path":"%s","stop_hook_active":false}' \
  "$PWD/plugins/spec-driver/tests/fixtures/fix-compliance/collapsed-zero-delegation.jsonl" | \
  node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode hook \
  --project-root /tmp/fix-compliance-sandbox
echo "exit=$?"   # 期望 2，stderr 含 [FIX-COMPLIANCE] 前缀
```

## 5. 阻断上限与降级验证

连续对同一 `session_id` 触发 3 次不合规判定（复用场景 B 的 payload，`session_id` 保持一致）：

```bash
for i in 1 2 3; do
  echo "--- 第 $i 次 ---"
  printf '{"session_id":"test-collapse","transcript_path":"%s","stop_hook_active":false}' \
    "$PWD/plugins/spec-driver/tests/fixtures/fix-compliance/collapsed-zero-delegation.jsonl" | \
    node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode hook \
    --project-root /tmp/fix-compliance-sandbox
  echo "exit=$?"
done
```

预期：第 1、2 次 `exit=2`；第 3 次 `exit=0` 且 stderr 含 `[GATE-DEGRADED]`，并可在 `/tmp/fix-compliance-sandbox/.specify/runs/YYYY-MM.jsonl` 中看到一条 `eventType: workflow-run-summary` 事件（`complianceVerdict.degraded: true`）与三条 `eventType: fix-compliance-verdict` 审计事件。

## 6. 配置强制程度验证（FR-015）

```bash
mkdir -p /tmp/fix-compliance-sandbox
cat > /tmp/fix-compliance-sandbox/spec-driver.config.yaml <<'EOF'
fix_compliance:
  enforcement: warn
EOF
# 重跑场景 B，预期 exit=0 但 stderr 含 [FIX-COMPLIANCE][WARN] 前缀，且落盘 fix-compliance-verdict 事件

cat > /tmp/fix-compliance-sandbox/spec-driver.config.yaml <<'EOF'
fix_compliance:
  enforcement: off
EOF
# 重跑场景 B，预期 exit=0，stderr 为空，.specify/runs/ 无新增文件（零接触）
```

## 7. Headless E2E spike（手工，非 CI 自动化，消耗真实凭据）

参考 `research/harness-verification.md` 的插件副本手法：

```bash
node plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs --scenario collapsed
node plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs --scenario compliant
```

该脚本会：拷贝 `plugins/spec-driver` 到 scratchpad 副本 → 挂载新 hook → 用 `claude --print --plugin-dir <副本>` 跑一次极简场景 → 打印 hook-trace 时间线供人工核对。**不计入 `npm test`**，仅在 implement/verify 阶段人工触发，用量控制在 haiku + 极简任务（成本 <$0.05/次，与 `harness-verification.md` 原始 spike 同量级）。

## 8. 性能基准（C-003 p95 < 100ms）

implement 阶段任务应包含：用真实规模的 fix 会话 transcript 样本，跑 N=20 次 `--mode report` 计时，记录 p50/p95，写入 `verification/verification-report.md`（本特性自身走完整 verify 流程时的产出）。若 p95 超标，回头调整 `MAX_TRANSCRIPT_BYTES` 或单遍扫描算法，而非引入运行时熔断（见 research.md D6 决策边界）。

## 9. 配置示例文档（供用户参考，非强制任务）

若用户希望在自己项目中调整强制程度，在项目根 `spec-driver.config.yaml` 追加：

```yaml
fix_compliance:
  enforcement: warn   # 或 off
```

不追加该字段时默认 `block`（详见 `contracts/fix-compliance-config-field.md`）。
