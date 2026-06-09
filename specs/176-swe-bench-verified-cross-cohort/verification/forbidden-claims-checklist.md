---
feature: 176
artifact: forbidden-claims-checklist
purpose: SC-007 — 报告 internal-cohort-only，无裸用"绝对可比/SOTA"措辞（除非带限定）
---

# 报告禁用词 checklist（SC-007 / FR-C-008）

> 自动扫描：`scripts/lib/forbidden-claims-scan.mjs::scanForbiddenClaims(reportText)`，
> verify-feature-176（T-F3）会对 PUBLISH-REPORT-M7.md 跑此扫描，violations 必须为 0。
> 命中禁用词但**同句带限定语**（internal-cohort-only / 仅组内 / directional / 不声称绝对可比 / 同 harness）则放行。

## 禁用词表（裸用即 violation）
| id | 模式 | 说明 |
|----|------|------|
| sota | `SOTA` / state-of-the-art | 绝对 SOTA 声称 |
| absolute-best | 绝对(领先/最优/第一/最强) | 绝对最优 |
| cross-lab | 跨实验室(绝对)可比 | 跨实验室绝对可比 |
| beats-absolute | outperforms / 碾压 / 全面超越 | 无限定超越 |
| world-best | 世界第一 / 业界第一 / 最佳模型 | 业界第一 |
| absolute-passrate | 绝对 pass rate …可比/领先 | 绝对 pass rate 可比 |

## 人工 review 勾选（自动扫描之外的语义判断）
- [ ] 所有业界锚点（Augment 70.6% / Anthropic -98.7% / RepoGraph / Serena）均标 internal-cohort-only，未与本仓 cohort 直接画等号
- [ ] lift 表述为 product-bundle directional，非 Spectra-MCP 单因果
- [ ] token-per-completed-task 引用业界数字时带 FR-C-004 限定口径
- [ ] §leakage 背景明确"2026 业界共识 Verified 绝对 pass rate 跨实验室不可比"
- [ ] falsification（lift<1.5×）如实写入 §10.6，无隐藏/挑数据
- [ ] 无 ORACLE-UNAVAILABLE / TOKENS-UNAVAILABLE 被静默补判
