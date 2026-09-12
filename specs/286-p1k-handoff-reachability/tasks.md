# F286 tasks

- [x] T001 `export-reachability.mjs`：契约字段 / `--base` 必填 + merge-base + 基线 == HEAD 干净树 exit 2 / 新增符号 = 新增 − 删除 / 合格使用行（自身或 importer 文件、非声明 / 注释 / import 块）/ md+json / `--fail-on-warning` / 固定口径随行
- [x] T002 `verify.md` Layer 1.85（适用范围 / baseRef 来源 / 6a–6c）+ Layer 1.86（先读 red-first-evidence）+ 合并律映射表 +4 + 返回摘要 + 报告结构行；`verify.artifact.yaml` 两可选章节（如实注明无校验器）
- [x] T003 `spec-review.md` + `quality-review.md` 受限 Write（对称）+ 证据包来源 + 缺席处置；两份 artifact output_path
- [x] T004 `implement.md` RED 级取证 append 到独立 append-only 文件 + F279 替代证明兜底
- [x] T005 四个 SKILL：预跑段（baseRef 首行 + evidence-pack + 不开 Bash 白名单）+ 返回处理（缺席 / 越界）+ spec-review 与 verify 派发块注入
- [x] T006 守护：`export-reachability.test.mjs` 10/10 + `f286-handoff-contracts.test.mjs` 13/13（段落级）
- [x] T007 `npm run repo:sync` 再生 skills-codex / .codex/skills 副本（SHA 同步）；插件模板同步到 `.specify/templates/`；再生噪声还原
- [x] T008 账本回写：F278/F279 四条「已分流 → F277 移交卡」标注 F286 已落地
- [x] T009 对抗复审（独立子代理 · 两切入角：A 2C/5W/6I · B 2C/5W/6I）+ 处置回写 §6
- [x] T010a verify 子代理首轮（NEEDS FIX：2C/2W）→ 全部随 §6 修复
- [x] T010b verify 子代理复核 verification-report.md（PASS：首轮 5 项阻断全部证实已解决；新变异 5 组全红；B-W5 削弱抽查红）
- [ ] T011 门禁：build / vitest / test:plugins / repo:check / release:check
- [ ] T012 rebase master → ff push origin master → 删分支
