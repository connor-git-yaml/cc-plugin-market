# 异构对抗切入角 #2（泄漏 / 伪造与欺骗面）— 主线程裁决表

> 战报：2 CRITICAL / 5 WARNING / 5 INFO；C1 脱敏纪律五组 canary 全路径零命中（未构造出泄漏）。
> 裁决人：主编排器（2026-08-30）。

## CRITICAL 裁决

| # | 发现 | 裁决 |
|---|---|---|
| C-1 | `server_build_info` 如实回传 `dirty:true`，doctor 消费端**零引用**该位 → 脏树 build 被渲染成「同一个 commit / ok」（开发期主路径） | **修（mcp-server 侧全量）**：io 读 `payload.dirty`；`DETAILS_SCHEMA['mcp-server']` 加 `buildDirty:'boolean'`；`match && dirty` 走新 summaryCode `mcp-server-commit-match-dirty`（status=warning，措辞「commit 相同但该 build 编自未提交的工作树」）。**global-cli 侧分流 follow-up**：`--version` 输出加 dirty 后缀 = 改 F240 版本行受限语法合同（VERSION_LINE_RE + 多处测试面），本卡不动，fix 报告如实登记「global-cli 结构上无法感知 dirty」 |
| C-2 | summary 声称「**正在运行的** MCP server」，实际探的是 doctor 自己按自身 PATH 新拉起的进程——客户端未重连的旧进程（本卡要抓的头号失效态）结构性探不到 | **修（措辞降到能证成的范围）**：summary/docstring 改「PATH 上的 `spectra` 二进制所构建」；`details` 加 `probeTarget:'path-binary'` 枚举；`reload-mcp-client` remediation 措辞对齐（提示「客户端在跑的进程需重连后才与此结论相关」）。真判在跑进程只能由客户端侧调 `server_build_info`——写进 docstring，不用文案盖过去 |

## WARNING 裁决

| # | 发现 | 裁决 |
|---|---|---|
| W-1 | `unreadable`（对方回传了 commit 但形态不合法）套用 `absent`（无 commit 信息）文案——同文件 PROBE_OUTCOMES 自己写过这条纪律 | **修**：拆 `…-commit-absent` / `…-commit-unreadable` 两 summaryCode |
| W-2 | `compareCommits` 双方都 slice(0,7)（28bit）+ 全链零完整性绑定 | **修**：按较短一方长度做前缀比较且较短方 ≥7；双全长时全长比较；`probeMcpServerBuild` docstring 补「结论完全来自被测方自述」信任边界一句 |
| W-3 | `mcp-server.details.semver` 由无界子进程输出抽取（实测 200KB version 串进报告）——F240 整行闸只护 global-cli | **修**：io 摄入点先做整串校验（长度 ≤32 且全串匹配受限形态）再 `normalizeVersion`；不改全局 `SEMVER_RE`（影响面大） |
| W-4 | census 把全机第三方 MCP server/工具名（含客户标识/UUID connector/注入构造文本）原样吐出 + 家目录绝对路径双通道 | **修**：`unknownDetail` 默认只出聚合计数，逐名清单挪 `--verbose`；verbose 下名字过 `[A-Za-z0-9_-]` 白名单 + 64 字符截断；`sourceDirs` 与 stderr hint 改 `~/…` 形式 |
| W-5 | 逐行缓冲无界：单个 40MB 无换行文件 → 560MB RSS，「绝不抛异常」承诺在行长维度不成立 | **修**：`pending` 超 8MB → 丢当前行、`unparsableLines+=1`、重置缓冲 |

## INFO 裁决

- I-1 `repo-version.commitComparison` 恒 match（自比）与真实比对渲染无差别 → **修**：repo-version 改独立键 `baselineCommit:'available'|'absent'`，不再占用 commitComparison
- I-2 `unrecognizedSpectraTools` 把命中短名重写成 `mcp__spectra__*`（抹掉漂移证据）→ **修**：保留 transcript 原始全名
- I-3 `seenCallIds` 跨源共享 Set 的理论污染（实测真实 id 零碰撞）→ **报告登记**，不改
- I-4 `errorClass` 进 schema 后 `sanitizeDetails` 补写分支的新耦合（当前不可达）→ **报告登记**
- I-5 tsx 直跑时 version（live package.json）与 commit（上次 build 的 dist）可属不同提交 → **报告登记**（server.ts 注释已述，doctor 消费后变承重，follow-up 观察）

## 未构造出（原样留档，≠ 安全）

C1 脱敏五组 canary（commit/version/额外键/JSON-RPC error/--version 行尾）全路径零命中；buildMetaPath 劫持、errorClass 带原串、findRpcResponse id 混淆均未打通——尝试路径见对抗代理原始战报。
