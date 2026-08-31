# F240 验证报告聚合（人工验证挂账项）

> 自动化门禁结论见各 phase 制品；本文件按 tasks.md §3 约定聚合 `[MANUAL-PENDING]` 项的执行结果。

## T062 — SC-013 hook 信任状态迁移人工验证（2026-08-31 执行）

- **执行环境**：codex-cli **0.151.0**（≥0.149 前置满足）· spec-driver plugin 4.4.3 · 仓库基线 f7a65aa9 · 隔离 CODEX_HOME（真实 ~/.codex 未动，auth sha 前后一致，清理彻底）
- **完整一手记录**：[verification/t062-manual-report-2026-08-31.md](verification/t062-manual-report-2026-08-31.md)（Codex 会话执行 + 用户 UI 授信，原始 RPC/doctor 输出全量在案）
- **总体判定：SC-013 FAIL（三段未全达成）——但缺陷全部在我方 doctor/spec 侧，Codex 原生能力三段全部工作**

| 观察面 | 结论 |
|---|---|
| Codex 原生：安装/发现 | PASS——恰 5 条 source=plugin hook、`${CLAUDE_PLUGIN_ROOT}` 展开、初始全 untrusted；F264 双注册守卫拦截合并器（正确跳过 + 指引文案） |
| Codex 原生：untrusted→trusted | PASS——UI /hooks 授信后 RPC 全 trusted；**无 bypass** 真实事件执行且 SessionStart hook 落盘证据内容正确（FR-010 PASS） |
| Codex 原生：modified | PASS（**但触发面与 spec 假设不同**）——hooks.json 声明改 1 字节（bash␠→bash␠␠）即 modified；UI 小写 `t` 重授信恢复 trusted；信任只绑定**当前哈希**（恢复旧命令后旧哈希再判 modified） |
| **我方 doctor：三段观察** | **FAIL**——hook-trust 维度全程 `not-applicable`/`remediation=null`：只探 `$CODEX_HOME/hooks.json` 存在性，未消费 app-server `hooks/list`，F264 插件主路径下把真实 untrusted/trusted/modified 一律误报 not-applicable（FR-009 三情形合同未兑现） |
| **spec 假设** | **被 0.151.0 实测证伪**——FR-009 引 _grounding §8.3「信任按（脚本）内容哈希绑定，脚本内容变更即失效」：实测 `currentHash` 只覆盖 hooks.json 的 hook 声明（command 串等），**脚本文件改 1 字节仍 trusted**（sha 前后已证、cmp 单字节） |

**派生缺陷 → F275**（doctor hook-trust 对齐插件主路径 + remediation 实测回填 + spec/文档假设修订 + 评估我方脚本内容指纹核验——Codex 不哈希脚本字节意味着受信 hook 的脚本可被静默替换，属新暴露的安全面，F238 wrapper body-sha256 是仓内先例）。

**实测有效的 remediation（回填 doctor 模板的唯一允许来源；untrusted→trusted 首次逐键未逐字回述，只回填完整观察过的 modified→trusted 路径，禁止补写未观察细节）**：

> 在目标 CODEX_HOME 下启动 Codex，输入 /hooks；选择标记为 untrusted 或 modified 的事件并按 Enter；确认命令与来源后，按界面提示的小写 t 授予当前哈希信任。显示 Trust Trusted 后退出并重跑 doctor。若没有显示 "Press t to trust"，不要猜测按键，按 Esc 返回并人工排查。

**SC-013 复测条件**：F275 修复 ship 后按同款隔离流程重跑三态（untrusted/modified 两态可无 UI 断言；trusted 态需一次 UI 授信 ≈5min）。复测绿之前 **A4 达标条件（tasks.md §5）不闭合**。

## T063 — F239 T039 Codex 桌面 managed worktree 同步验证

**未完成**（2026-08-31）：交回的报告文件为空，/tmp 原件不存在——测试未产出记录，需按派发 prompt 重做（桌面客户端建 managed worktree + worktree 内会话四项观察 + 桌面版本号）。
