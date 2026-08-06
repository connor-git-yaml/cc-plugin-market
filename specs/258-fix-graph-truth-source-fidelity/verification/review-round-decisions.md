# 审查修复轮决策与实测记录（P1 / P2 对抗复审补记 + 三份审查的逐条处置）

范围：`src/utils/gitignore-oracle.ts`、`src/cli/commands/graph-quality.ts`、
`src/batch/generic-language-skeleton-collector.ts`、`scripts/lib/graph-quality-core.mjs`、
`plugins/spec-driver/scripts/{graph-consumption-cli.mjs, lib/graph-consumption-inputs.mjs,
lib/git-change-classifier.mjs, lib/graph-consumption-decision.mjs}` 及对应测试。

本文件同时**补上 P1 / P2 缺失的对抗复审记录**：P3 有 `p3-decisions.md::T068`，P1 / P2 此前没有
对应落账；本轮的三份独立审查覆盖了 P1（`src/**` 忽略 oracle 链）与 P2（`.mjs` 消费侧口径）两段，
故在此按 T068 的格式统一落账，不再回填两份内容重复的文件。

---

## 审查档位（硬性标注）

> **Codex 审查暂停（配额耗尽，2026-08-03 起），异构档位缺席**。
> 本轮为 `CLAUDE.local.md` 暂停期替代档位：**三份独立审查**——
> ① Spec 合规审查、② 代码质量审查、③ **两个**异构对抗子代理（不同切入角）。
>
> 本批含**门禁 / 判定器类改动**（`repo:check` 的 `ignore-undeterminable` 判据、三态 oracle 的
> 出声通道、fingerprint 严格校验），按暂停期约定，commit message 须显式标注
> 「Codex 审查暂停，异构档位缺席」，配额恢复后**可回补审查**。
>
> ⚠️ **诚实登记残余风险**：F229 实证过"3 个同构子代理全漏、Codex 抓到"。本轮虽已用两个不同
> 切入角的异构对抗，但"零 CRITICAL"在本档位下**不构成安全证据**。本轮的实际产出恰好反证了
> 这一点——审查抓到的 M-1 正是一条**上一轮（P1）内部审查全漏**的可主动触发 fail-open 面。

---

## 审查结论汇总

| 审查 | 切入面 | 结论 |
|---|---|---|
| ① Spec 合规 | spec/plan 承诺 vs 运行时实际行为 | 抓到 M-4（KL-2 承诺与实现相反）、M-5（JSDoc 与后果矛盾）、M-7（over-claim 未撤）、M-8（制品未回填） |
| ② 代码质量 | 判据重复 / 契约一致性 / 严格性下沉 | 抓到 M-2（判据漏两个出口）、M-6（entry 级严格性缺失） |
| ③ 异构对抗 ×2 | fail-open 面 / 绕过构造面 | 抓到 **M-1（CRITICAL：打坏 git 就能让门变绿）**、M-3（L3 破 KL-3 且给出更错的答案）；两个审查者**独立收敛**到 M-3 |

编排器已做分流裁决，下发的是**必修清单 M-1..M-8** 与**明确 defer 清单**。本 agent 未拿到三份
审查的原始全文，故下表按收到的必修项逐条落账；defer 项的登记要求一并执行。

---

## 逐条处置

| # | 发现 | 判定 | 处置 |
|---|---|---|---|
| **M-1** | `git ls-files` 预取失败 ⇒ `prefetchLookup === null` ⇒ `verdict` 第一行短路成二态 ⇒ **永不产出 `undeterminable`** ⇒ `drainUndeterminable()` 恒 `{count:0}` ⇒ 两个消费方的 `count > 0` 判据均不成立 ⇒ `nextSteps` 无 token ⇒ `ignore-undeterminable` check 报 **pass**（标题还写着"无不可判路径（三态 oracle）"）。**打坏 git 就能让门变绿** | **成立（CRITICAL）** | **已修**：`UndeterminableSummary` 增 `degraded: boolean`（= `prefetchLookup === null && hasGitDirUpward(walkBase)`，粘性、drain 不重置）；两个消费方判据改为 `count > 0 \|\| degraded \|\| budgetExhausted`；诊断文案新增子 token `[oracle-degraded]`，`graph-quality-core.mjs` 据此把 `degraded` 写进结构化 evidence 并报 **warn**。变异 MR-1 / MR-2 / MR-6 三条各杀一段链路 |
| **M-2** | `budgetExhausted` 与 `count` 是两件事，但两处出声判据都只有 `count > 0`；预算恰在最后一次 L2 后耗尽时具名出口 `l2-budget-exhausted` **完全静默** | **成立** | **已修**：并入 M-1 的新判据；`describeUndeterminable` 给 budget-only 情形单独文案。**并补上此前完全没有的守护**——该出口在 E2E 里要真把 L2 预算跑穿才能构造，成本过高正是它长期无断言的原因，故把 `shouldVoiceUndeterminable` / `describeUndeterminable` 两个纯函数导出直测（三形态 + 优先级共 5 条用例） |
| **M-3** | `gitignore-oracle.ts:35`（KL-3）与 L3 分支注释都断言"`dirPrefixes` 仅在盘分支消费"，而 L3 出口调的 `prefetchLookup` 正是消费 `dirPrefixes` 的那个。实证：`col/` 被 `--directory` 折叠但其本身无规则命中，`col/<300 字符>/keep.ts`（ENAMETOOLONG ⇒ L3）命中折叠前缀被判 `ignored`，git 的权威答案是 `not-ignored`，且计数为 0 ⇒ 静默 | **成立（两个审查者独立收敛）** | **已修**：新增 `createGitIgnoredFileLookup`（只查 `files` 的逐条肯定答复），L3 改用它。方向选择的依据：`files` 是 git 自己逐条列出的**肯定**答复、不依赖任何存在性前提；`dirPrefixes` 的可信度依赖"被查询路径在盘"。P1 差分实证里的 EACCES 反例（`weird/secret.log` 是精确条目）因此**保住**，由 M-3b 反向钉住。KL-3 与"为什么换序是安全的"两处文字同步改写为与实现一致 |
| **M-4** | KL-2 白纸黑字写"仓外绝对路径 / `..` 越界 ⇒ 走 L2 得 exit 128 ⇒ undeterminable + 计数出声"，实际**只有离盘**才走 L2；**在盘**同形态被 L1 截住 ⇒ 查表 MISS ⇒ 静默 `not-ignored` | **成立** | **已修**：`computeVerdict` 入口加越界守卫 `isOutsideWalkBase`（绝对路径 或 `path.relative` 结果以 `..` 开头 ⇒ 直接 `undeterminable`），判据**只看输入是否违反"相对 walkBase"这条输入契约、不看盘**，故在盘/离盘同解。**未**采用备选的"改写 KL-2 + 新增 KL-7"分支：修法无副作用（原本这些输入落 L1 查表必 MISS ⇒ 消费方按 not-ignored 处理，与新出口的下游行为逐字节一致，差别只在"多了计数出声"），既然能兑现承诺就不该改承诺。KL-2 与 L 层表同步更新 |
| **M-5** | `graph-consumption-inputs.mjs` 写 porcelain 失败"只需如实标注 `worktreeStatusReadFailed`"，实际 `porcelainOk:false` 会并进 `unrecognized` ⇒ `changeClass='unknown'` ⇒ 命中矩阵行 7 `consume-degraded`、抢在 stale 行 8 之前短路、**根本不刷图** | **成立（文档与实现互相打脸）** | **选（a）改文档，保留行为**。理由：`porcelainOk:false` 意味着工作树变更集**真的拿不到**，判 `unknown` 是对事实的正确读法；选（b）把 porcelain 排除出 `unrecognized` 会让一份**残缺**的变更集冒充完整的——`git diff` 那一路只看得见已提交部分，工作树里的修改型改动被抹掉后整体判 `additive-only` ⇒ **跳过 impact**，那是不安全方向。两处 JSDoc（`collectChangeSet` + `classifyChangeSet` 的 `unrecognized` 行）改为如实说明"不硬失败 ≠ 没有后果"，并**新增用例**把后果钉成机器断言：`M-5: porcelain 读失败的下游后果 —— unknown ⇒ consume-degraded ⇒ allowed+stale 也不刷图` |
| **M-6** | 顶层 key 集合做了精确等值，**entry 内多出未知 key 被静默照单全收**（实证：entry 多一个未知 key → `surfaces=5, src=graph-fingerprint`，应整体回落） | **成立** | **已修**：entry 也做 key 集合精确等值（`extensions` + `matchSemantics`），与顶层同口径、与 TS 侧 `parseSurfaceEntry::keySetEquals` 同口径。新增导出常量 `FINGERPRINT_ENTRY_KEYS` 并加**第四处跨语言合同锚**（对拍 `computeCollectorFingerprint()` 的真实 entry key，并断言五条管线 entry 形状一致，使"用 pyWalk 取样"这一步本身成立）。该漂移方向**不安全**：未来 entry 新增收窄字段而忘 bump `formatVersion` 时，只读两维会算出偏**宽**的面 ⇒ 本该判范围外的改动拿到全信 impact |
| **M-7** | `src/utils/file-scanner.ts:3` 仍写"git 仓库内以 git 本体为事实源"——正是 T022 点名要撤的那句，且与新文件 `gitignore-oracle.ts:10` 自述"这两句笼统表述已删除"互相打脸 | **成立** | **已修**：file-scanner 文件头改为指名两个 oracle 各自回答什么、并指向 `gitignore-oracle.ts` 文件头。同批收口同句残留：`python-adapter.ts`、`source-discovery.ts`（两处）。**额外多收一处**：`collector-fingerprint.ts::BEHAVIOR_VERSION` 的 `2 ← 1` bump 记录里同样有这句原话，改为如实描述该次改动（消费 `git ls-files … --directory` 的在盘枚举）并附注为什么撤——留着它等于把 over-claim 重新种回一个会被人当权威读的位置。全仓 `grep "以 git 本体为事实源"` 现仅剩 4 处，全部是"**不得**这么写"的反面引用 |
| **M-8** | `tasks.md` 勾选态与实际执行不符；`fix-report.md` 缺「验证结果」节；`verification/` 缺 P1 / P2 对抗复审记录 | **成立** | **已修**：见下方"制品回填"节 |

---

## 明确 defer（编排器裁决，本轮不改行为，只做如实登记）

### D-1 `coverageUnionApplied` 在 `freshness=fresh` 时的第三个方向（P2 对抗 C-1 + W-1）

**病灶**：`refresh-policy=allowed` 时 coverage 判据用 union(图自述面, 静态面) 这个「重建可达面」。
`freshness=fresh` × `allowed` 下，落在 union 内、图自述面**外**的目标不再命中矩阵行 2，却也不会
走到刷新（图是 fresh 的，没什么可刷），于是直接拿到全信 `consume-impact`——手里这份图**根本不含**
该扩展，impact 结果却按"覆盖完整"消费。更糟的是 `annotate-caveat` 时点用的是图自述面（不带 union），
该目标在那边判面外 ⇒ 不注解 ⇒ **两侧同时静默**。

**为什么 defer**：union 分支来自 **F254 W-1**，不是 F258 引入；收敛它要动决策矩阵语义
（在 fresh 分支下让 coverage 判据回到图自述面，或给 union 分支补一条显式 caveat），属独立 fix 卡。

**本轮必做的那件事（已做）**：把两处 over-claim 改写为如实表述——

- `graph-consumption-decision.mjs` 的「C-002（两处判据同一份面）依然成立」→ 改为如实说明该不变量在
  `refresh-policy=allowed` 下**已经不成立**，两侧面不同会导致 decide 不降级 + annotate 不注解的双静默；
- `graph-consumption-cli.mjs` 的「残留风险与修复前**同向**，不会反向」→ 撤回"不会反向"这半句，
  明确登记存在第三个方向（该降级却全信），并指出它与"该刷没刷"方向**相反**。

理由：原文案会让下一轮审查者按"方向安全"放过它——这正是 over-claim 的实际危害，与 M-4 / M-7 同类。

### D-2 4b W-4：诊断走 `nextSteps` 文本前缀契约 vs 加 schema 可选字段

设计取舍，defer。本轮新增的 `[oracle-degraded]` 子 token **加深**了对文本契约的依赖，如实登记：
两个 token 均由 `tests/unit/graph-quality-core.test.ts` 跨侧双向钉住（改任一侧即红），但这条链
天然比 schema 字段脆弱。

### D-3 I 级问题

全部 defer，未逐条落账（本 agent 未拿到审查原始全文，只拿到编排器分流后的必修清单）。

---

## 制品回填（M-8）

| 制品 | 动作 |
|---|---|
| `tasks.md` | 勾选态回填到与实际执行一致，并追加「审查修复轮」任务段（T078–T085） |
| `fix-report.md` | 追加「验证结果」节：五道门禁数字 + 三份审查结论 + 本轮修复清单 + defer 登记 |
| `verification/mutation-evidence.md` | 追加「审查修复轮」段：MR-1..MR-6 六条变异，逐条记变红用例与断言输出，附逐字节撤销复核 |
| `verification/review-round-decisions.md` | 本文件（P1 / P2 对抗复审补记 + 逐条处置 + defer 登记） |

---

## 审查修复轮的全量验证

```
$ npm run build          → exit 0
$ npx vitest run         → Test Files 523 passed | 4 skipped (527)
                           Tests 7154 passed | 18 skipped | 21 todo (7193)
$ npm run test:plugins   → ℹ tests 1528 / ℹ pass 1528 / ℹ fail 0
$ npm run repo:check     → exit 0（87 项 pass，含 graph-quality:ignore-undeterminable）
$ npm run release:check  → exit 0（Release contract valid）
```

净增用例：vitest **+16**（7138 → 7154）、plugins **+1**（1527 → 1528）。
