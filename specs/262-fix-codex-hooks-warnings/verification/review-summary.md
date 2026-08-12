# F262 Phase 4 审查汇总（供 4c verify 证据核查引用）

## 审查矩阵（完整路径 + CLAUDE.local.md 异构对抗档位）

| 轮次 | 审查 | 结论 | 处置 |
|------|------|------|------|
| Phase 1（诊断轮） | 异构对抗-权限/合并破坏面（opus） | 3C/7W/10I | 全部裁决进 fix-report 修订版（W1 修法撤换、src/ 分流、W3 细化） |
| Phase 1（诊断轮） | 异构对抗-诊断误报面（opus） | 3C/5W/7I | 同上（W2 边界扩、W1b 纳入、W4 文案重写、严重度修正） |
| Phase 4（实现轮） | 4a spec-review（sonnet） | 0C/0W/2I | 5/5 条目一致、已否决方案零实现、范围红线未破 |
| Phase 4（实现轮） | 4b quality-review（sonnet） | 0C/0W/3I | 总评 EXCELLENT；suffix path 死代码（已在修复轮删）、doctor-io 体量（plan 已裁决）、isInstallResultShape 假设（已在修复轮改写） |
| Phase 4（实现轮） | 异构对抗-权限破坏面（opus） | 1C/3W/8I | CRITICAL-B（W1b 判据 2 独立性被消解）→ 修复轮二收口 |
| Phase 4（实现轮） | 异构对抗-诊断误报面（opus） | 1C/2W/4I | CRITICAL-A（W2 幻影多行串错归属回归）→ 修复轮一收口 |

## 修复重验轮（Phase 4 内两轮，文件零交集并行）

- 修复轮一（doctor 链）：单遍 TOML 扫描器 + 段边界分离 + 6 组对抗矩阵锚定。红 4 → 绿 71（doctor 单测）/109（doctor 三件套）。
- 修复轮二（installer/validate 链）：C1 豁免可见性（warning finding + removedByDeclaration）、W1a after 投影收窄、W-2/I-2 形态识别 fail-loud、W-3 mkdir 0o700、I-1 'wx'、I-3 必传、I-6 注释。红 10 → 绿 137（installer/flow/event-gate/parity 四件套）。
- 语义变更（deliberate）：升版路径 validate 结论 pass→warning（判据无法区分升版与误认，见 fix-report 回归护栏修订）。

## 主线程验证证据（时间序）

| 项 | 结果 |
|----|------|
| 目标测试组（修复后） | doctor 三件套 109/109；installer/flow/event-gate/parity 137/137 |
| npx tsc --noEmit（修复轮二自检） | 0 错误 |
| npm run build | 零错误（postbuild 盖章 dd59ebbd dirty 正常） |
| npm run test:plugins | 1580 pass / 0 fail |
| npm run repo:check | pass（唯一 warning=worktree 本地图 stale，记忆确认常态，与本卡无关） |
| npm run release:check | pass |
| 全量 vitest 第一轮 | 1 failed（tail 截断未存名）/7497 pass |
| 全量 vitest 第二轮 | 1 failed + 1 文件级 error / 7496 pass：feature-213 e2e 超时 1073s + architecture-ir-builder 文件级 error |
| 满载 flake 判定 | 三条件齐：隔离重跑全绿（e2e 空载 3.5s / ir-builder 0.6s）+ 失败文件与被改文件 grep 零交集 + 失败组合逐轮漂移（前三轮全量分别是 F239/graph/sync-worktree/batch-incremental 组合，其中 batch-orchestrator-incremental 为记忆预存 flaky） |

## 已知边界（登记不修，详见 fix-report）

TOCTOU mode 快照非原子；悬空 symlink 拆链；emptiedEvents 共享轴盲区；W2 显式不支持形态清单；CLI 兜底渲染未来 info 误标；[hooks."state"] 引号键（T062 挂账）；软链恶意预置旁证抹除（既有面）；多行数组续行段边界过度近似（absent 安全方向）。

## 分流候选（dogfooding ledger 收尾落账）

Claude 侧问题群（atomic-write 非同构 5 消费方 / hook-installer chmod 0755 / .bak 无 EXCL / tmp 竞写）；doctor `.find` 首匹配漏诊；doctor-io 体量抽 lexer 候选；fix-compliance 判定器在本 harness 下主 transcript 懒刷盘失明（本会话实证）；共享工作树禁 stash 约束。
