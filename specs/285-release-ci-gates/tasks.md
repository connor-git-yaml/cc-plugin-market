# F285 tasks

- [x] T001 prepublishOnly 接 typecheck:tests + test:plugins（full 不进）
- [x] T002 coverage job（本机全量 88.13/85.53/94.78/88.13，阈值全达标）
- [x] T003 tsconfig.tests.json + typecheck:tests:full + CI 只报不阻断步骤（基线 1022 / 147）
- [x] T004 CI Test 步只跑 vitest；test:plugins 单跑
- [x] T005 删 claude-review.yml
- [x] T006 守护测试 release-ci-gates.test.ts 6/6
- [x] T007 全量门禁（build / vitest 8216 / test:plugins 1840 / repo:check / release:check / typecheck:tests exit 0）
- [x] T007b 异构对抗复审 ×1（两切入角 0C+5C / 3W+3W）+ 守护测试按 §6 重写（10 条）+ ci.yml A-I1/A-W2
- [x] T008 verify 子代理 verification-report.md（PASS，0C/3W/4I）
- [ ] T009 rebase master → ff push origin master → 删分支
