# F282 plan

| # | 步骤 | 落点 | 验收 |
|---|---|---|---|
| P1 | 红先行：`normalizeName` 归一化矩阵 + 既有形态不回退用例 | `tests/unit/graph-accuracy.test.ts` | 改前 2 红 |
| P2 | `normalizeName` 后缀剥离后取尾段 + export + 空串 null | `scripts/graph-accuracy.mjs` | P1 绿；4 相关测试文件 44/44 |
| P3 | census `countingUnit` 字段 | `scripts/adoption-census.mjs` | `adoption-census.test.ts` 绿 |
| P4 | 协议 §2.2 重取两语料原始读数 | `docs/design/f265-graph-quality-rerun-plan.md` 追加「首次正式读数」；M10 §11 | 输出含 baseline 三字段 |
| P5 | 独立子代理对抗复审 + verify 子代理 | `verification/` | 无 CRITICAL |
| P5b | 对抗复审处置（读数可信面 1C+3W）：协议文档追加缺陷 2/3 + 口径说明；GORM 口径一致读数；M10 §11/§12 改写；fix-report §3/§4/§7 | 同 P4 落点 + `specs/282-*/` | 复算一致；CRITICAL 清零 |
| P6 | 全量门禁 + rebase master + ff push | — | vitest/build/repo:check/release:check 零失败 |

不做：改冻结协议定义（只追加缺陷 2/3）；改判据方向；处理 module 文件名多段点形态（现图不产出）；symbol 级尺子（移交 M11）。
