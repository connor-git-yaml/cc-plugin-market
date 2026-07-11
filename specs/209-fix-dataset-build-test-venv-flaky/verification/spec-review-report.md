# Spec 合规审查报告 — F209(Phase 4a)

> 审查代理:spec-driver:spec-review(sonnet)。子代理本身无 Write/Bash 工具,本报告由主编排器按其返回结论代为落盘(结论文本未改动,仅格式化)。

## 审查范围与方法

基于 Read 通读 fix-report.md / plan.md / tasks.md / 实际测试文件 `tests/unit/feature-187-dataset-build.test.ts` / 生产源码 `scripts/lib/swebench-dataset-build.mjs`,逐行核对。

## 实际改动核对

`tests/unit/feature-187-dataset-build.test.ts` L108-117(经 Read 直接比对当前文件内容与 plan.md 预期 diff):与 plan.md 行级 diff 预期**完全一致**——新增 `venvPath` 局部变量、`spawnSync` 参数追加 `'--venv', venvPath`、两处注释文案调整,三条断言语句字面量未变(`res.status).not.toBe(0)` / `res.stderr).not.toMatch(/dataset 标签不一致/)` / `res.stderr).not.toMatch(/未知 dataset tag/)`)。改动严格落在 plan.md 变更清单范围内,未见越界或遗漏。

## 关键事实核验(对照 CLI 源码)

- 混合标签守卫 `process.exit(2)` 实际在 L133(fix-report 原写 L131,偏差 2 行);未知标签守卫 `process.exit(2)` 实际在 L140(fix-report 原写 L139,偏差 1 行)。两处均**确认严格早于** L142 的 `buildLocalDataset(...)` 调用(venv/fetch 逻辑入口),fix-report"L88-103 两用例[安全]"的结论**成立**,仅引用行号有细微误差。
- `--venv` 为 CLI 既有参数(L121 `else if (argv[i] === '--venv') venvPath = argv[++i];`),F209 零源码改动的表述属实。
- `datasetTagToHfId` / 混合标签禁止 / 未知标签报错三个 W-1 守卫分支均未被本次改动触碰,"无需更新 spec"(不改变 W-1 行为语义)结论**成立**。
- Grep 确认 `tests/` 目录下仅该文件引用 `swebench-dataset-build` CLI,"同源问题清单穷尽"结论可信。
- 测试目的保持:新注入路径导致失败发生在 fetch 阶段(`buildLocalDataset` 内 `fetchOfficialRows` 抛错),逻辑上仍是"越过 W-1 守卫后才失败",与原测试意图一致。

**未发现应升级为 feature 模式的信号**:改动面单文件单用例,不触碰生产代码、不触碰 spec 行为语义。

## 分级结论

| 级别 | 数量 |
|------|------|
| CRITICAL | 0 |
| WARNING | 0 |
| INFO | 2 |

**INFO-1**: fix-report.md"影响范围扫描"表中引用的 CLI 行号(L131/L139)与当前源码实际行号(L133/L140)存在 1-2 行偏差,结论仍成立,属报告文字精度瑕疵,不影响修复正确性。
→ **处置**:主编排器已同步修正 fix-report.md 行号引用。

**INFO-2**: 测试文件头部注释(L1-7,未改动部分)仍笼统声称"buildLocalDataset 注入 fetchRows(W-4)免跑真 venv/Python",但该注入实际只覆盖库函数用例,CLI 子进程用例无法注入,这一文档漂移正是本次 fix-report Why-5 已识别的根因组成部分之一,属遗留、非本次改动引入,plan.md 已明确将本次范围限定在 L105-113,未处理此头部注释属合理的最小化范围决策。
→ **处置**:保持不动(遵守"不加未要求的改动");记录于完成报告。

## 总结论

实际改动与 fix-report/plan/tasks 完全一致、无越界、无遗漏、测试目的与断言语义保持不变,fix-report 的关键论据(W-1 守卫早于 venv/fetch、无需更新 spec)经源码核验均成立,仅存在两处无关紧要的行号引用误差,判定为**合规、可继续验证阶段**。
