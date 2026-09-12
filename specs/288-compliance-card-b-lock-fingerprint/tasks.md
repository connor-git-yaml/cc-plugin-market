# F288 tasks

- [x] T001 G1：`acquireStateLock` / `releaseStateLock` / `mutateBlockState`（link 原子创建、陈旧接管 rename 唯一化、锁不可得降级无锁 RMW）+ `lastCountedFingerprint` 字段
- [x] T002 G1：4 条 RMW 迁移（routeBlock / releaseDegraded test-and-set / defer / 指纹路由），手工透传与默认值 fail-open 消失
- [x] T003 G2：`computeEvidenceFingerprint` + `routeByFingerprint` 互斥三分 + `dispatchRoute` + 耗尽放行终态（真实 blockCount）+ warn 门控 + 五个新码入表 / schema
- [x] T004 6b：`countBlockFeedbackEntries` + `releaseCorroborated` + `hasFailedRunRecord`
- [x] T005 新测试 22 + 既有套件适配（harness 回灌模拟 / 基线 diagnostics / W7 / E-b / E-r）；test:plugins 1886/0
- [x] T006 合同：CLI 合同文档新节 + 退出码表；schema description；io / judge 死注释改写
- [ ] T007 异构对抗复审 ×2（绕过面 / 误伤与并发面）+ 处置回写 §7
- [ ] T008 verify 子代理 verification-report.md（含变异清单 M1-a..e / M2-a..f / M6-a..c + K-14 速率实测）
- [ ] T009 门禁：build / vitest / test:plugins / repo:check / release:check
- [ ] T010 rebase master → ff push origin master → 删分支
