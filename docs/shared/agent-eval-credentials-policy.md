## 评测凭据策略（订阅优先）

跑评测脚本（`scripts/eval-mcp-augmented.mjs` / `scripts/eval-task-runner.mjs` / `scripts/eval-judge-jury.mjs` / 后续 `f16x-*.sh` batch 脚本）时使用**订阅优先**凭据策略，按角色分类：

### 角色 ↔ 凭据来源（订阅 vs API key）

| 角色 | 模型 | 凭据来源 | 说明 |
|------|------|---------|------|
| Driver | `codex:gpt-5.5` | **ChatGPT Pro / Pro Max 订阅 OAuth** (`~/.codex/auth.json`) | 订阅边际 $0 实付；按周配额管理 |
| Judge 1 | `claude-cli:claude-opus-4-7` | **Claude Max 订阅 OAuth** (macOS Keychain) | 订阅边际 $0 实付；按周配额管理 |
| Judge 2 | `siliconflow:Pro/zai-org/GLM-5.1` | `SILICONFLOW_API_KEY`（仓库根 `.env.local`）| **真实扣费**，按 token 计算 |
| Judge 3 | `siliconflow:Pro/moonshotai/Kimi-K2.6` | `SILICONFLOW_API_KEY`（同上）| 同上 |

### 关键不变量

- **不要**在 spec / plan / prompt 里写"需 `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` 全配"作为启动前提 — 当前生产路径走订阅 OAuth，**不需要**这两个 API key
- **不要**通过 `OPENAI_API_KEY` 直连 OpenAI API 替代 Codex CLI — Codex CLI 走 ChatGPT Pro 订阅，按 token 计费 vs 订阅免费的成本差 ~5-50×
- **不要**通过 `ANTHROPIC_API_KEY` 直连 Anthropic SDK 替代 Claude CLI — 同上理由（Claude Max 订阅）
- **必须**保留 `SILICONFLOW_API_KEY` 在 `.env.local`（jury GLM/Kimi 走 SiliconFlow API，没有订阅替代）
- 评测 cost 估算时，`实付 = 仅 SiliconFlow API token cost`，**不**包括 driver / Claude judge（订阅边际 0）

### 启动前 verify 模板（host shell）

跑评测前应在 host shell（非 sandboxed worktree env）verify 3 件事：

```bash
# 1. SiliconFlow API key 已配
grep -c "^export SILICONFLOW_API_KEY=" .env.local        # 应输出 1

# 2. Claude Max OAuth 工作
echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text
# 期望输出: ok

# 3. Codex CLI OAuth 工作 (文件存在即可，binary 检查会扣 token)
ls -la ~/.codex/auth.json
# 期望: 文件存在 + recent mtime
```

### 配额监控（订阅模式特有）

订阅模式下 cost 不是钱（$0 实付），但**周配额**是真实约束：

- ChatGPT Pro Max 20x 配额：driver = codex:gpt-5.5 主消耗源
- Claude Max 配额：judge = claude-opus-4-7 主消耗源
- 跑批 ≥ 30 runs 时，每 6 runs 检查一次配额 dashboard，≥ 60% weekly → 警告 / 询问继续 / 分日跑

### 凭据轮换或异常时的应急方案

- 如果 SILICONFLOW 余额耗尽 → 临时禁用 GLM judge，jury 降级为 2 judge（spec FR 允许，但显著性降低）
- 如果 Codex / Claude OAuth 失效 → 跑批前先 `claude /login` + `codex /login` 重新授权，**不要**改回 API key 模式
- 如果必须在 CI 环境跑（无 OAuth）→ 单独 Feature 决策，不能默认改 spec 的凭据要求
