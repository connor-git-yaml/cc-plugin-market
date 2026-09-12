# F284 外部语料 A/B（图解析类验收）

- 方法：同一份语料源码副本，分别用 **master 9362f1a8 的 dist**（A）与**本卡 dist**（B）跑 `batch --mode graph-only`，
  去掉 `graph.generatedAt / builder / sourceCommit / fingerprint` 后（首稿脚本删的是不存在的 `collectorFingerprint` 键，对抗复审 I-7 更正；本卡指纹未变，A/B 结论不受影响），节点按 id 排序、边按稳定序列化排序，逐字节比对。
- 重算器：`external-corpus-ab.sh <distA> <distB> <out>`（语料从 `~/.spectra-baselines/<corpus>` rsync 副本，排除既有 `specs/_meta`）；
  self-dogfood 用 `git worktree add --detach origin/master` 的同一棵源码树跑两份 dist。
- 日期：2026-09-13（用户会话限额重置后主线程实跑）。

| 语料 | 管线 | A nodes/links | B nodes/links | 结论 |
|---|---|---|---|---|
| GORM @688e8ea0 | #3 go adapter | 1717 / 1753 | 1717 / 1753 | 逐字节相同 |
| HikariCP @ea81bfb5 | #3 java adapter | 1269 / 1211 | 1269 / 1211 | 逐字节相同 |
| micrograd | #2 pyWalk + #11 pythonSymbolScan | 33 / 38 | 33 / 38 | 逐字节相同 |
| self-dogfood | #1（#7/#8 不进 graph-only 产物，见下） | 7824 / 13349 | 7824 / 13349 | 逐字节相同 |

结论：忽略目录 SSoT 化在四条语料上**零行为变化**（A 侧 dist = 9362f1a8 / sourceDirty:false）⇒ 不 bump `BEHAVIOR_VERSION`（F252「不 bump 裁决制品化」先例）。

**证明力如实（对抗复审 W4）**：本 A/B 对忽略目录改动几乎空转——外部三语料里命中忽略名、非 gitignore、含相关扩展名的目录只有 micrograd `test/`；self-dogfood 跟踪树只有 `vendor / build / dist / tests` 有样本，66 个条目可被观察 ≤ 6 个；`#7/#8` file-scanner 集不进 graph-only 产物（TS 模块节点来自 #1 walk），故「self-dogfood 覆盖 #7/#8」不成立。逐名等价的主证据是 `tests/unit/collector-surface-ignore-dirs-behavior.test.ts`（6 消费方 × 事实源全部目录名 + 5 对照名，正反两向），本 A/B 只承担「图解析类改动必带外部语料 A/B」的合规动作与 dist 身份记录。
