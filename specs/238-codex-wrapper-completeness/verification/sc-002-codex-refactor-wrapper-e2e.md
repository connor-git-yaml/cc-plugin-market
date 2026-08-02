# SC-002 验收证据 — spec-driver-refactor wrapper 真机 discovery/load E2E

- **执行时间**：2026-08-02T11:23Z（本地 19:23 CST）
- **CLI 版本**：`codex-cli 0.144.6`（`codex --version` 实测输出）
- **验收口径**：discovery/load（spec SC-002，Plan 审查轮 W8 收窄；执行级 E2E 见 follow-ups.md FU-3）
- **配额消耗**：一次 ChatGPT 订阅推理（16,721 tokens；订阅边际 $0，未用任何 API-key fallback）

## 执行命令（plan §5 固定命令，一次最小只读触发）

```bash
codex exec --sandbox read-only --ephemeral --skip-git-repo-check --color never \
  -C . \
  "请确认你能发现名为 spec-driver-refactor 的 skill（通过 $spec-driver-refactor 或等价方式），只需回答是否发现及其 frontmatter description 摘要，不要执行该 skill 的任何指令。"
```

## 关键输出（成功证据）

```
workdir: <worktree 根>
model: gpt-5.6-sol
sandbox: read-only
session id: 019fc236-c3c8-7721-b441-cb9fac5121d9

codex
是，已发现 `spec-driver-refactor` skill。

Frontmatter description 摘要：用于大规模代码重构，分为影响分析、分批规划、
逐批实现、残留扫描和最终验证 5 个阶段。

tokens used: 16,721
```

## 判定

- ✅ Codex 能发现 `.codex/skills/spec-driver-refactor/SKILL.md`（skill 列表可见）
- ✅ 返回的 description 摘要与 canonical frontmatter（"大规模代码重构 — 5 阶段：影响分析→分批规划→逐批实现→残留扫描→最终验证"）语义一致，证明 wrapper frontmatter 被正确加载解析
- ✅ read-only sandbox + --ephemeral，零写副作用
- **附带实证**（非本 SC 验收项但值得记录）：本次调用未传 `--model`，CLI 自行按其配置分层选择了 `gpt-5.6-sol`（header 可见）——"未显式 pin 时交还 Codex CLI 决定模型"（FR-304 delegate 语义的 CLI 侧行为）获得一次真机侧证
- 已知无害噪声：CLI 启动时报 `models cache: missing field supports_reasoning_summaries` 为本机 codex models 缓存的版本兼容告警，与本验收无关
