# F289 tasks

- [x] T001 spec.md（设计 §1–§7 承接 + 必答项窗口锚点 + FR/SC）
- [x] T002 spec 异构对抗 spec-review ×2（绕过面 / 误伤面）+ 处置回写
- [x] T003 core：`latestResumeLineIndex` 同趟累计；`judgeCompliance({ tier2 })` implement 豁免
- [x] T004 io：`writeSidechainMarker` / `listSidechainMarkers`；共享 `readStdinSync`
- [x] T005 SubagentStop CLI `fix-compliance-sidechain-marker.mjs` + 薄壳 `hooks/subagent-stop-fix-marker.sh` + `hooks.json`
- [x] T006 judge：`detectTier2Binding` + 有效锚点 + `tier` / `tier2Source` + 三码 + report 透传；schema enum + `tier`
- [x] T007 分发登记：Claude 独有脚本表 +1；F283 归属测试按登记表剔除
- [x] T008 新测试 `fix-compliance-tier2-continuation.test.mjs` 16/16；judge-cli + card-a + card-b 零翻转；codex-hooks 五套 vitest 零翻转
- [x] T009 合同文档新节 + fix-report + 账本
- [x] T010 implement 异构对抗复审 ×2 + 处置
- [x] T011 verify 子代理 verification-report.md（含变异 + 真实 sidechain 分位数）
- [x] T012 门禁：build / vitest / test:plugins / repo:check / release:check
- [x] T013 rebase（F288 合入后）→ ff push origin master → 删分支
