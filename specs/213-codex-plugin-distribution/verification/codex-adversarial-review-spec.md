# Codex 对抗审查归档 — Specify 阶段（Feature 213）

- **审查对象**: `specs/213-codex-plugin-distribution/spec.md`（初版）
- **审查模型**: gpt-5.6-sol（codex-companion rescue 通道）
- **日期**: 2026-07-20
- **执行状态**: 部分完成（诚实标注）——审查会话在输出完整分档清单前 stall（25 min 无进展）被取消；已从 job log 回收 2 条实质性 preliminary findings。stall 前模型已完整读取 spec.md 与 _grounding.md 并做过交叉 rg 核对。

## 环境备注（审查通道修复记录）

- 前 2 次调用失败：companion 默认模型 gpt-5.6-sol 被 Homebrew codex-cli 0.142.0 拒绝（400 requires-newer-CLI）。
- 第 3 次失败根因：companion「shared session」复用先前由 0.142.0 spawn 的长驻 `codex app-server`，新调用的 PATH 前缀无法触达。
- 修复：kill 本 worktree 专属的 stale broker/app-server（确认 cwd 与 state dir 均限本 worktree、系统唯一实例，F212 不受影响），以 `PATH="/Applications/ChatGPT.app/Contents/Resources:$PATH"` 前缀重启 → 0.145.0-alpha.18 支持 gpt-5.6-sol，第 4 次审查真实运行。
- **禁改动**: 未运行 `codex update`（F212 并行跑批期间不动全局 toolchain）。

## 回收的审查发现与处置

| # | 级别 | 发现 | 处置 |
|---|------|------|------|
| F1 | CRITICAL | skills 集合矛盾：plugin `skills/` = 9 个 canonical skill（Claude 语汇），SC 却按 8 个根级 `.codex/skills/` wrapper 验收；manifest `skills` 字段只能指 plugin root 内路径，spec 未定义 Codex 侧暴露哪套 skills | ✅ 已修：FR-004（Spectra 直用 canonical）/FR-005（Spec Driver 指向 Codex 适配 wrapper 目录）拆分落定；落位机制经 GATE_DESIGN 裁定移交 plan（OQ-004 RESOLVED） |
| F2 | CRITICAL | P1 与可选交付矛盾：「一次安装」为 P1，但唯一安装路径依赖的 marketplace 入口在 FR-011 标 `[可选]`（实测 `codex plugin add` 只认 configured marketplace） | ✅ 已修：升级为 FR-013 `[必须]`（ship tracked `.agents/plugins/marketplace.json` + `.gitignore`/worktree symlink 最小收窄）；GATE_DESIGN 裁定确认（OQ-002 RESOLVED） |

## 编排器自查补充（同轮修复）

| # | 级别 | 发现 | 处置 |
|---|------|------|------|
| S1 | WARNING | FR-008 与一处 Edge Case 悬空引用不存在的 OQ-004 | ✅ 已修：双层验证策略写死进 FR-010，删悬空引用 |
| S2 | WARNING | `.agents` 被 .gitignore 整目录忽略且 worktree 整目录 symlink 共享——tracked marketplace.json 会穿透 symlink 污染主仓，spec 未列该 Edge Case | ✅ 已修：新增 Edge Case + FR-013(b) 最小收窄 + Non-Goals 划界（不做 B3 .worktreeinclude 大改） |

## 复核

- 修订后 spec 经 clarify（NON-BLOCKING，11 项维度确认明确）与 checklist（✅15/⚠️3/❌0）双通道复核。
- GATE_DESIGN 2026-07-20 通过，三项 OQ 全部裁决（详见 spec.md 文末决议记录）。
- 后续阶段（plan/tasks/implement/verify）各自独立跑 codex 对抗审查，不以本次部分完成为豁免先例。
