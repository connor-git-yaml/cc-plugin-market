---
feature_id: 163
phase: plan
mode: fix
status: completed
generated_at: 2026-05-15
related_feature: 162
---

# Feature 163 — Fix Plan: Pilot 27 Spec Gap 修复

> fix-report.md 根因：plan.md 缺 §0.x 启动前置 + clone 脚本幂等弱

## 修复范围（最小化）

**变更文件**：

1. `specs/162-codex-driver-glm-judge-eval/plan.md` — 新增 §0.6 启动前置 section
2. `scripts/baselines/clone-swe-bench-upstream.sh` — 升级 clone_repo() 幂等校验

**不改动**：
- eval-mcp-augmented.mjs（EC-13 guard 保留，行为正确）
- pilot-27-batch.sh（运行时脚本，方案 A 不碰）
- Feature 162 spec.md（修复属 plan/ops 层，非 spec FR 变更）

## 实现细节

### Fix 1: plan.md 新增 §0.6 启动前置（文档改动）

在 Feature 162 plan.md 的 §0.3（顺带歧义决议）之后，插入 §0.6 section：

```markdown
### 0.4 启动前置（Cohort C / MCP server 硬依赖，运行前必须完成）

**按顺序执行以下 3 步**，再启动任何 pilot 跑批：

**Step 1 — clone 上游 repo**（幂等，已存在自动跳过）：
```bash
bash scripts/baselines/clone-swe-bench-upstream.sh
```
首次 clone pytest+astropy+sympy 总量 ~528MB，预计 10-30 分钟；已 clone 则秒级跳过。

**Step 2 — 构建 dist**（Cohort C 硬依赖）：
```bash
npm run build
```
Cohort C 的 MCP server 入口为 `dist/cli/index.js`；未构建则 EC-13 error，整批 fail。
Cohort A/B 不依赖 dist，但建议统一先 build 避免遗漏。

**Step 3 — 更新 spec-driver plugin cache**：
```bash
claude plugin update spec-driver
```
**然后重启 IDE / Claude session**（必须）。
更新后须确认 `~/.claude/plugins/cache/cc-plugin-market/spec-driver/` 已切到 4.1.0。
未更新 cache 则 Cohort C 的 sub-agent 加载旧版 frontmatter，MCP 工具继承失效。
```

### Fix 2: clone-swe-bench-upstream.sh 幂等校验升级（代码改动）

改 `clone_repo()` 函数，从"仅检 dir 存在"升级为：
1. dir 不存在 → 正常 clone
2. dir 存在但 `.git/config` 不可读（空目录 / 残留） → `rm -rf` 后重 clone（自动修复）
3. dir 存在且 `.git/config` 可读，但 `origin` URL 不匹配 → warn + 跳过（不覆盖用户自定义 clone）
4. dir 存在且 git 完整 → 正常跳过（现有行为）

关键代码路径：
```bash
if [ -d "$target_dir" ]; then
  # 新增：校验 git 完整性
  if [ ! -f "$target_dir/.git/config" ]; then
    log_warn "$name: 目标目录存在但 .git/config 缺失（中断残留），自动 rm -rf 重 clone"
    rm -rf "$target_dir"
    # fall through to clone
  else
    local actual_url
    actual_url=$(git -C "$target_dir" remote get-url origin 2>/dev/null || echo "")
    if [ "$actual_url" != "$repo_url" ] && [ -n "$actual_url" ]; then
      log_warn "$name: origin URL 不匹配（expected=$repo_url actual=$actual_url），跳过（保留现有 clone）"
      return 0
    fi
    log_info "$name: 目标目录已存在且 git 完整，跳过 clone（dir=$target_dir）"
    return 0
  fi
fi
```

## 回归风险评估

- plan.md 是文档，无代码回归风险
- clone 脚本改动：新增 2 个 if 分支，不影响正常 clone 路径；对已完整 clone 目录行为不变
- 幂等改动不影响 A/B cohort 行为（A/B 不依赖 clone 脚本输出）

## 验证方案

1. `npm run build` 成功产出 `dist/cli/index.js`
2. 重跑 `bash scripts/baselines/clone-swe-bench-upstream.sh`（已存在则正常跳过，不报错）
3. `npx vitest run` 零失败
4. 重跑 Pilot 27（全 27 runs），Cohort C prepareWorktree 成功率 ≥ 80%
