# Codex 对抗审查归档 — Tasks 阶段（Feature 213）

- **审查对象**: `specs/213-codex-plugin-distribution/tasks.md`（v1，356 行，22 task / 8 Phase）
- **审查模型**: gpt-5.6-sol
- **日期**: 2026-07-20
- **执行状态**: **完整**（本 feature 首次完整分档返回）。通道说明：rescue 子代理层持续 API 断连（本次为第 6 次），改由主编排器经 Bash 直发 codex-companion `task --background` 并轮询回收（job `task-mrsx0vtf-0txqyy`，不再设激进 stall 自动取消——吸取 plan 阶段误杀教训）。审查会话 ID 019f7e78-831a-7540-931f-7cda336891f7。

## 审查结论：8 CRITICAL + 4 WARNING，v1 判定不能进 GATE_TASKS

### CRITICAL（全部修复于 v2）

| # | 发现 | 处置（v2 落点） |
|---|------|----------------|
| C1 | 依赖图纸面无环但真实命令过早执行：T016 只依赖 T015 却真实跑 `repo:check`（此时 skills-codex/、两 manifest、marketplace 未齐）；T017 缺 T018 边；T020 缺 T011 边（会装占位 manifest）；T007 实际必改 `repo-maintenance-core.mjs:41`（现状 runStep 无 flag），与 T016 同文件而图允许并行 | ✅ T016 依赖改 T007+T011+T015+T018；T017 加 T012+T015+T018；T020 加 T11；T007 显式声明文件改动并与 T016 强制串行标注；关键路径重算：唯一 9 长度链 T000→T004→T005→T007→T010→T012→T011→T020→T021→T022 |
| C2 | T002 未承载 plan §3.4 原子七步：第 3 步只建空目录、marketplace 写入被推迟到 T018，第 7 步"该文件此刻仅存在于本 worktree"与自身矛盾；空目录无法验证 ignore 放行 | ✅ marketplace.json 内容写入并入 T002（对齐 plan 步骤 3 原始语义）；T018 降级为纯验证（schema 断言 + fresh-clone）；回滚给出可执行命令序列与预期状态 |
| C3 | TDD 红绿序违约：T012 标 test-first 却依赖已完成实现的 T011；T016/T017/T018 测实同 task 无先红后绿；T019 出生即绿 | ✅ T012 移至 T011 之前；T016/T017/T019 各拆 (a)test-red/(b)implementation-green 两步 |
| C4 | T008 扫描命令 `grep -n "Task tool\|...Task\("` 无 `-E` 实跑报 `parentheses not balanced`，"零匹配"证据无效；且 research 文件已存在、task 性质错标为待生成 | ✅ 改 `rg -n 'Task tool|mcp__plugin_|AskUserQuestion|Task\(' plugins/spectra/skills`，期望 exit=1 且 stdout/stderr 均空；task 改为"复跑校正既有文档" |
| C5 | 矩阵不校验 manifest `skills` 字段值（只数磁盘目录）：把 spec-driver manifest 错改 `./skills/` 后 repo:check 仍过，违反 FR-007 持续门禁 | ✅ T015 新增 `skills-reference:spectra`/`skills-reference:spec-driver` check（字段值 + 引用目录存在 + skill id 集合）；T013 加错误路径/缺目录/同数量错身份负例 |
| C6 | "100% FR 覆盖"三实质缺口：FR-012 waiver 删除模拟可被其他 skill 冒充（未断言 error 指名 spec-driver-refactor）；FR-006 hooks ship 文件存在性无测试；FR-013/SC-006 fresh-clone 无用例 | ✅ T013 补精确 waiver 删除模拟（error 指名断言）；T019 补 hooks.json 及引用脚本随包存在断言；T018 补隔离 clone/新 worktree 物化验证 + marketplace 完整 schema 断言 |
| C7 | T009/T010 手写占位 version/description 违反 plan §3.7「受控字段初值也由 release:sync 生成」 | ✅ 初稿 manifest 不含这两个 key；T011 接线后由 `npm run release:sync` 插入；T011 验收改 Node 精确相等断言 |
| C8 | T021 新增 `verification-report.md` 超 plan §3.6 文件红线 | ✅ 归位为 spec-driver 流程制品（specs/213-.../verification/，入库惯例）；tasks.md 头部显式豁免流程制品于红线之外 |

### WARNING（全部落实于 v2）

| # | 发现 | 处置 |
|---|------|------|
| W1 | 多项验收是人工观察（T009 只 JSON.parse 不断言字段 / T010 无命令 / T011 git diff 目测 / T022 无基线前置 / T06 测试落点不明与 T016 或有同文件冲突） | ✅ node:assert 机械化；新增 **T000 基线捕获** task（22→23）；T006 指明测试落点 |
| W2 | T020 的 `beforeAll` 后改 it.skip 在 vitest 中不可实现（用例注册先于 beforeAll） | ✅ 改模块加载期探测 + `describe.skipIf(!hasCodex)`；清理链 spawnSync 逐项记 exit code 汇总断言 |
| W3 | Phase 7 "可选"与 T022 无条件依赖矛盾；风险 3 又说本机必跑 | ✅ 条件语义明确：本机有 binary 必跑 T020/T021；无 binary 记 skip 证据/标 N/A；T022 依赖该条件结果 |
| W4 | T003 声称三用例全红不准确（无 flag 守护与 remove 守护是现状行为，先天绿） | ✅ 改"一红两绿"（flag 功能用例红，两条 characterization guard 绿） |

### INFO 摘录

- 声明依赖边无环；T004→T005 串行安全；范围红线（scripts/eval* / A2/A3/A4 / .claude-plugin/** / canonical skills）零触碰确认。
- 审查者 dogfood 反馈：未调用 Spectra MCP（三份规范制品的合同/依赖审查无需 symbol graph）。

## 复核

- v2 修订后 8C/4W 逐项落点由主编排器抽查验证（T002 原子性 / T007↔T016 串行标注 / rg 命令 / skills-reference ×6 / 受控字段禁手写 / T000 存在）。
- v2 进入 GATE_TASKS 用户复核。
