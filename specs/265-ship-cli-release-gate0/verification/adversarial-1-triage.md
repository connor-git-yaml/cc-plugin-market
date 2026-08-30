# 异构对抗切入角 #1（fail-open / 静默失效面）— 主线程裁决表

> 对抗代理战报：5 CRITICAL / 10 WARNING / 4 INFO / 5 未构造出（全部带可执行构造，实测复现）。
> 裁决人：主编排器（2026-08-30）。修复项统一派单一 fix 代理执行；报告项进 push report / fix-report。

## CRITICAL 裁决

| # | 发现 | 裁决 | 理由 |
|---|---|---|---|
| C-1 | `git rev-list --count` 默认 history simplification，`-s ours` merge 可把 N 归零成假 pass | **修**：加 `--full-history` | 一行改动；线性历史下 N 不变（当前 18 不动）；仓库 rebase-only 政策不是代码约束 |
| C-2 | 只量 `src/` 而 tarball 有 7 个 path root；纯 `plugins/` 断层（实测 24 commit）判据看不见 | **部分修 + 上报拍板**：evidence 里记录实际 pathspec；warning 文案改为如实说「仅量 src/」；**量测面扩到 plugins/ 等发布路径 = 改卡面口径（SSoT G0-2 明写 src commit），提请用户在 push report 拍板** | 卡面/spec/变异测试全部以 src 口径锚定，主线程无权单方面改度量语义 |
| C-3 | pathspec 匹配不到任何东西 = 0 = pass，与真没断层不可区分（src 改名/--project-root 错位即触发） | **修**：count 前验证 `HEAD:src` 存在（`git cat-file -e HEAD:src`），缺失 → `indeterminate('pathspec-empty')` 可见 | 单点最高杠杆，同时收 C-2 的「src 消失」半边 |
| C-4 | `SPECTRA_PUBLISHED_REF=HEAD` 伪造 ok+pass 且人可读输出零痕迹；模块注释的「误用收口」声称被证伪 | **修**：`refSource==='env-override'` 时无条件追加一条 override 提示 warning（与 gap warning 不同串）；改写 :29-30 的不实注释；变异测试 (b) 改为断言「无 gap warning」而非「warnings 为空」 | 注释与代码不符是 F245「沉默门禁」同型病 |
| C-5 | ci.yml 注释声称「顺序颠倒会必红」——实测 graph-quality 缺图是**静默 skip，CI 照绿**（graph-quality-core FR-017 优雅跳过） | **修**：注释改写为事实；`Repo Check` step 前加一行 `test -f specs/_meta/graph.json`（缺图 fail-loud 的哑守卫） | F258「新门禁自己 fail-open」在 CI 层复现；哑守卫比 jq 断言链更稳 |

## WARNING 裁决

| # | 发现 | 裁决 |
|---|---|---|
| W-1 | warn 分支 title 写「在阈值内」（反话） | **修**：warn 分支 title 改「发布断层领先量超阈值」 |
| W-2+W-8 | 三种病因共用 `unreachable-commit` 且文案钉死 fetch-depth 误导；git stderr 被 ignore 全吞 | **修**：拆 `git-unavailable` / `revlist-failed` / `count-unparseable` 三 reason，各自文案；**不**把原始 stderr 放进 warnings/evidence（stderr 会含 ref 原串，违反与 FR-015 同口径的脱敏），只放 reason 枚举 |
| W-3 | E404 等被统称「网络不可达」；包名硬编码 | **修**：包名从 `package.json` name 读；从 err.stdout 的 JSON `error.code` 区分 `E404`（package-not-found）与网络类 |
| W-4 | warning 只走 stderr，CI 上绿灯观感与判据坏死完全一致 | **修（小）**：`GITHUB_ACTIONS` 环境下对每条 warning 额外输出 `::warning::` annotation；分支过滤/step summary 记 follow-up 不做（YAGNI） |
| W-5 | M10 SSoT 验收句「推 1 个 src commit → warn」与阈值 5 不自洽 | **报告**：SSoT 文档句在发布后语境下失真，push report 提请用户改 SSoT 验收句为 A/B 注入式（不由本卡单方面改里程碑文档） |
| W-6 | npm 本地缓存/offline 也报 `ok`，无新鲜度字段 | **报告**：登记 follow-up；niche 环境，不加码 |
| W-7 | 治理两步在 Test 之前，治理红会吞掉整个 vitest 信号 | **修**：两步移到 `Test` 之后（Build Graph → Test → Repo Check → Release Check → Test Plugins(always)）；建图前置依赖不变，测试信号不再被治理失败遮蔽 |
| W-9 | 集成测试 7 处 runNode 真打 npm view（+35s/离线红） | **修**：那 7 处 runNode 注入 `SPECTRA_PUBLISHED_REF=HEAD`（已有机制，零新代码，离线确定性）；核对其断言不受 C-4 新增 override warning 影响 |
| W-10 | fetch-depth:0 翻转 shallow 探测让 incremental 路径 CI 首跑；PR 事件 HEAD 是合成 merge 节点 | **报告**：登记观察项；graph-only 每次全量重建，无消费该路径的即时风险 |

## INFO 裁决

- I-1 `publish-gap:publish-gap` 冗余 id → **修**（模块内 id 改 `gap`，测试同步）
- I-2 相邻合并块 `?? []` 防御不一致 → **修**（补齐）
- I-3 Windows `npm.cmd` → 不做（M10 明示不承诺 Windows），fix-report 登记
- I-4 execFileSync 缺 `maxBuffer`（仓内 graph-quality-core 有 FIX-2 先例） → **修**（两处补，跟随先例）

## 未构造出（5 项，原样留档）

镜像剥 gitHead / npm view 数组形态 / 消费方升级 warn→error / 合并层降级 error→warn / env 注入命令参数——尝试路径见对抗代理原始战报（fix-report 附录收录）。
