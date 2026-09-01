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

### T062 复测（F275 修复后，2026-08-31）— 状态：**PENDING-user（2/3 段绿）**

F275（`specs/275-fix-codex-doctor-hook-trust/`）已落地 doctor hook-trust 对齐插件主路径：app-server `hooks/list` 探针 + FR-009 三情形合同 + remediation 实测回填（与本文件 §T062 记录逐字节一致，直引号口径）。

| SC-013 段 | 状态 | 证据 |
|---|---|---|
| 1. untrusted 观察 + remediation | **PASS（自动化）** | 单测覆盖（`tests/unit/codex-runtime-doctor.test.ts` 终版矩阵用例）+ 真实 `~/.codex`（F264 主路径，5 条 plugin hook 全 untrusted）端到端实跑：doctor 报 `warning` / `trustStatus: untrusted` / `remediation.code=grant-hook-trust`，文案为实测回填文本 |
| 2. modified 观察 | **PASS（自动化断言口径）** | 单测覆盖（native entries 含 `modified` → warning + grant-hook-trust；聚合取严 `['trusted','modified']→modified`）；无 UI 自动化断言按 F275 卡面约定 |
| 3. untrusted→trusted 真实迁移（含 UI 授信 + 无 bypass 真实事件） | **PENDING-user** | 需一次用户 UI 授信（≈5min）：在真实（或隔离）CODEX_HOME 按 doctor remediation 文案操作（/hooks → 选事件 → Enter → 小写 t → Trusted），随后重跑 `node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --project-root . --format json`，观察 hook-trust 转 `ok` / `trustStatus: trusted`。做完后把本行翻 PASS 并在下方登记输出摘要 |

**回填区（用户授信后填写）**：

- [ ] 授信后 doctor 输出：`status=____ / trustStatus=____`（期望 `ok / trusted`）
- [ ] 授信日期与 codex 版本：____

三段全绿后本节转绿，即闭合 M9 A4 达标条件（tasks.md §5）。

## T063 — F239 T039 Codex 桌面 managed worktree 同步验证

**第一轮已执行（2026-08-31 00:21，codex-cli 0.151.0，managed worktree `1a26`）→ 总体 UNEXPECTED，部分闭合**：
一手记录 [../239-worktree-local-state/verification/t063-manual-report-round1-2026-08-31.md](../239-worktree-local-state/verification/t063-manual-report-round1-2026-08-31.md)
（首轮交回文件为空的原因已定位：报告写进了 Codex 沙箱自己的 /tmp，宿主机不可见；第二轮由用户从会话取回全文）。

| 项 | 结论 |
|---|---|
| (a) `.worktreeinclude` copy-if-absent | **PASS**——`.env.local` 在 worktree 为常规文件（非 symlink）、与主仓逐字节一致；只读限定下未测"目标已存在不覆盖"生命周期，与语义一致 |
| (b) `AGENTS.override.md` 同层取代 | **UNEXPECTED = fixture 缺席观察无效**——观测时主仓根本没有探针文件（只有 .gitignore:51 规则），worktree 无从复制；会话加载 AGENTS.md 与"override 缺席时回退"语义一致，**既不能判 PASS 也不能判 FAIL** |
| (c) 0.149+ 指令文件沙箱可读 | PASS（限定）——AGENTS.md 可读、turn setup 无报错；#39653 的 override 形态因缺席未覆盖 |
| (d) 环境记录 | PASS——桌面客户端版本号仍待用户补填 |

**第二轮（只补第 2 项）前置已就绪**：主仓探针已建（AGENTS.md 副本 + `T063-OVERRIDE-MARKER-20260831` 注释行，24356 字节 ≤ 32768 预算，gitignored 不入库）。步骤：桌面客户端**新建**一个 managed worktree（override 复制发生在创建时，旧 worktree 补测无效）→ 新 worktree 会话观察文件层 + 生效层 marker → 记桌面版本号 → 删探针与 worktree。T039 在第二轮闭合前保持未勾选。
