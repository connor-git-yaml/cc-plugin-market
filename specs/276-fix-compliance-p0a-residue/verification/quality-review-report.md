# Phase 4b · 代码质量审查报告（F276 卡 C）

> 审查对象：`5bb8526b` + `7c7cb8ed`（基线 `e01611b2`）；审查者：spec-driver:quality-review（opus，亲跑 test:plugins 1721/1719/0/2 + repo:check）；主编排器落盘（子代理无 Write）。

已完成审查。亲跑验证：`npm run test:plugins` = **1721 tests / 1719 pass / 0 fail / 2 skipped**；`npm run repo:check` pass（唯一 warn 是 graph 产物 stale，与本卡源码无关）。**承重验证确为 `test:plugins`**——三处改动全在 `.mjs`，`npm run build`（tsc）对其零覆盖，不构成本卡的构建阻断面。

## 结论

**PASS**（CRITICAL 0 / WARNING 5 / INFO 4）

改动最小且聚焦根因：C1+C2 仅动 core（2 常量 + 1 纯函数，零既有签名改动）、io（`tryWriteState`→`writeStateOrThrow` + 3 个新私有函数 + 失败面 `errors[]`）、judge（1 事实字段透传 + `routeBlock` 第 5 参 + 2 个新私有函数）；C3 确为纯删（2 常量 + `routeNonBlock` + 其 JSDoc，净 −127 行），删后 `recordWorkflowRun`/`PREFIX_WARN`/`loadBlockState` 等六符号在本文件均仍有消费点，**无孤儿 import**，全仓无残留引用。成功面副作用未变（mkdir recursive / 载荷 / `utf8` 编码逐字不变，且由 `Object.keys` 深等 + E-c/E-e 的 sha256 A/B 双重钉住）。测试无恒真断言：E-a 断的是退出码序列 2,2,0 + 首行 token + `/fix_compliance:\s*\n\s{2,}enforcement:/` 缩进正则 + 挡路对象在盘且非目录，P-2 逐条论证四条 fixture 的排除理由各自成立（防"被改成自证"）。

| # | 级别 | 位置 | 现象 | 处置建议 |
|---|---|---|---|---|
| 1 | WARNING | `plugins/spec-driver/scripts/fix-compliance-judge.mjs:728-801` | **JSDoc 锚定错位**：`buildStorageUnavailableFeedback` 那段 ~35 行 JSDoc 后面紧跟的是另一段 JSDoc 和 `const PATH_SEGMENT_RENDER_LIMIT = 512`（:771），真正的函数在 :801 ⟹ 该文档块悬空；`renderPathSegment` 的 JSDoc 又挂在了 `PATH_SEGMENT_RENDER_LIMIT` 上（函数在 :787）。本卡最承重的两段设计留痕都归错了符号 | 把 `buildStorageUnavailableFeedback` 的 JSDoc 下移到 :801 紧前；`renderPathSegment` 的 JSDoc 下移到 :787 紧前；给 `PATH_SEGMENT_RENDER_LIMIT` 单独留一行说明（其理由目前只在 :796 的行内注释里） |
| 2 | WARNING | `fix-compliance-io.mjs:466`（`saveBlockState` `@returns`）+ `fix-compliance-judge.mjs:687`（`routeStorageUnavailable` `@param opts.errors`） | **合同文档漏字段**：`describeWriteFailure` 实际返回 `{path,stage,code,blocker}` 四字段，两处消费侧类型声明只写了三字段。`blocker` 是 IW-2/IM-1 新增的承重项（补救口的删除对象由它指定），文档面却看不见 | 两处类型补 `blocker:string\|null`；`describeWriteFailure` 的 `@returns` 已正确，以它为准 |
| 3 | WARNING | `fix-compliance-judge.mjs:609-620` vs `plan.md:128` / `fix-report.md:111` | **设计口径反转未落进偏差登记**：plan §4 C2 第 2 条明写第 5 参「F238 纪律：**无默认值**」，实现改成 `counts = {}` + 非有限数归 0。反转理由（顶层 `catch{return 0}` 让"忘传即炸"等价于"忘传即放行"）成立且有 M-14/E-r 实证，但只落在 mutation-log「计划外新增」与代码 JSDoc，**没进 `implementation-notes.md` 的「已知偏差」**（该节只到 C1 轮，IW-1/IW-2/IM-1/IM-2/IM-4/IL-1 六项一个都没登记）。更要紧的是它同时推翻了 `fix-report.md:111` 给**卡 A/B** 开的处方「统一为无默认值 fail-loud（F238 纪律）」——那条处方所依赖的前提已被本卡在同一调用链上实证为反的，handoff 却未标注 | ① `implementation-notes.md`「已知偏差」补 IW/IM/IL 六项（尤其 IW-1 与 plan §4 C2 第 2 条的显式冲突）；② 在 `handoff/` 或 fix-report:111 行加一句「该处方方向已被卡 C 的 IW-1 实证为反，卡 A/B 接手前须重审」，否则卡 A/B 会照着写出静默放行 |
| 4 | WARNING | `verification/mutation-log.md:3-22` | **变异日志数字口径对不齐**：编号跳过 **M-5 / M-9** 且全文无说明（读者无从判断是"计划里被撤回"还是"漏跑"）；表头声明"全部 **10 条**变异跑完后三文件 sha256 与变异前一致"，而表内有 **12 行**——M-14 明写在 `/tmp` 副本跑，**M-13 没说明在哪跑、是否纳入 sha256 还原校验** | 补一行说明 M-5/M-9 的去向（plan §6 修订记录里应有对应撤回）；把表头改成「M-1..M-12 共 10 条在工作树上跑并逐字节还原，M-13/M-14 在副本上跑」的精确口径 |
| 5 | WARNING | `fix-compliance-io.mjs:411-437`（`findPathBlocker`）· `tests/fix-compliance-io.test.mjs:620-703` | **新增最复杂的一个函数零直接单元覆盖**：U-4 三条用例里 `blocker` 一个断言都没有；该函数只由 judge-cli 的 E-s(a/b/c) 端到端间接覆盖，且只覆盖 ENOTDIR / env 指文件 / EISDIR 三形态。**256 步上限、悬空软链降级（JSDoc 已登记为盲区）、`existsSync`/`lstatSync` 抛错降级、相对路径收敛到 `.`** 四条分支零覆盖。这四条恰是"解释路径反成新失败源"的风险面 | 在 io.test 补一组直调探针（可把 `findPathBlocker` 导出，或经 `describeWriteFailure` 走公开面）：悬空软链 ⟹ `blocker:null`、第一个存在节点是目录 ⟹ `null`、相对路径 ⟹ `null` 不死循环。E-s 保留为端到端 |
| 6 | INFO | `fix-compliance-judge.mjs:787-798` | `renderPathSegment` 先转义后 `slice(512)`，可能把 `\u202e` 截成 `\u20` 之类残片 | 纯可读性、零判定消费，可不改；若改则先截原串再转义 |
| 7 | INFO | `tests/fixtures/fix-compliance/real-stop-hook-feedback-entries.jsonl:1` + `README.md` | fixture ① 的正文是「环境故障，非制品问题，模型无法修复；请向用户报告」，与生产实际首行「阻断计数无法持久化…」不一致；README 称其为"真实 harness 回灌条目"，实为骨架真实 + 正文旧稿。谓词只看 token 故不影响判定，但重录者易误判"生产文案变了" | README 该行补一句「①③ 的正文为构造/旧稿，只有 envelope 与两个判定串取自真实录制」（④ 已有此类标注，①③ 缺） |
| 8 | INFO | `specs/208-.../contracts/fix-compliance-verdict-event.schema.json:33` | C3 后三个 `nonblock-*` 码成为"已登记零产出"，破坏 R-12 的双向不变量 | **处置已恰当**：新增 `description` 显式登记残余，并说明为何刻意不加"enum ⊆ 已产出码"的反向守卫（属卡 A canonical 表范围）。仅作已知合同债记录 |
| 9 | INFO | 性能复核（我方实测） | 新增计数趟在 **20000 条 entry × 每条 400 字符、且全部条目都通过 `startsWith`** 的最坏构造下实测 **0.58 ms/趟**（实现自述的 0.066 ms 对应真实场景，两者不矛盾）；`findPathBlocker` 最坏 256 次 `existsSync`，只在两级写入皆败时触发、每次裁决至多 2 次调用 | 同步 Stop hook 上无性能风险，无需处置 |

**安全面单独说明（均可接受，不计入上表）**：`err.path` 渲染进 stderr 会随 harness 回灌进 transcript，但同一条 stderr 的 ② 本就渲染 `projectRoot`，未引入新的泄露面；`renderPathSegment` 的消毒集覆盖 C0/DEL/C1（含 NEL）/LS/PS/零宽/双向控制/BOM，E-q′ 用 `U+2028` + RLO 实测并断言 stderr 无裸残留，是本卡唯一新增的注入面且已收口。`markWriteStage` 对**冻结错误对象**用 try/catch 兜住 `defineProperty` 抛错、失败时按原对象返回只丢 `stage`（不吞掉 `path`/`code`），方向正确。`findPathBlocker` 用 `lstatSync`（不跟随软链）判目录、`existsSync`（跟随）判存在，两者语义差异已在 JSDoc 登记为盲区且降级方向保守（`blocker=null` 退回原措辞）。

**六维度**：架构合理性 GOOD（无跨层扩散，errno 严格隔离在解释面、判定侧零消费并由 E-p 源码守卫钉住）；设计模式 GOOD；安全性 GOOD；性能 EXCELLENT；可读性 NEEDS_IMPROVEMENT（问题 1 的 JSDoc 错位；另本文件注释密度已高到 JSDoc 单块 35 行，`buildStorageUnavailableFeedback` 的设计约束建议下沉到 `docs/` 或 plan，函数头只留指针）；可维护性 GOOD（问题 2/3/4/5 是文档与覆盖面的欠账，非结构问题）。

关键文件绝对路径：
- `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/atomic-write-defects-fix-5606c8/plugins/spec-driver/scripts/fix-compliance-judge.mjs`
- `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/atomic-write-defects-fix-5606c8/plugins/spec-driver/scripts/lib/fix-compliance-io.mjs`
- `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/atomic-write-defects-fix-5606c8/plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
- `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/atomic-write-defects-fix-5606c8/specs/276-fix-compliance-p0a-residue/implementation-notes.md`
- `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/atomic-write-defects-fix-5606c8/specs/276-fix-compliance-p0a-residue/verification/mutation-log.md`
