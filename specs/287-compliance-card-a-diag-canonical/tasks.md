# F287 tasks

- [x] T001 红先行：卡 A 测试文件 16 例（首轮 SyntaxError 红；实现后 3 红 → 修后 16/16 绿）
- [x] T002 G0：canonical 表 + userFacing 白名单 + 产出点改引用 + 渲染点过滤；io `STATE_STORAGE_DIAGNOSTICS`
- [x] T003 G3(a)：SKILL 长等待落盘惯例成文 + `repo:sync` 再生 codex 副本
- [x] T004 G3(b)：`PENDING_MARK_REGEX` / `countPendingSections` / `pendingSectionCount` / `verification-report-pending`；schema
- [x] T005 G4：`buildAssistantTextSet` / `classifySnapshotMessage` / evaluate 快照交叉校验（只走审计通道）；schema 两码
- [x] T006 K-1：入口守卫 → `isInvokedDirectly`（闭包不扩张；首稿重复登记被守卫抓回）
- [x] T007 既有守卫适配：F240 I2 基线 diagnostics 列（五列逐字不变）
- [x] T008 真值集 P/R 双报 + 重算器；T4-M1 可测部分语料统计（360 份）
- [x] T009 异构对抗复审 ×2（绕过面 1C/5W/9I · 误伤面 0C/4W/10I）+ 处置回写 §7（C-1 stdin EAGAIN 既有 fail-open 已修并钉回归）
- [ ] T010 verify 子代理 verification/verification-report.md（含变异清单执行）
- [ ] T011 门禁：`test:plugins` 0 fail + vitest / build / repo:check / release:check
- [ ] T012 rebase master → ff push origin master → 删分支
