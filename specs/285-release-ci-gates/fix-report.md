# F285 · 发布 / CI 门补齐：prepublishOnly 接 typecheck:tests + test:plugins、覆盖率阈值接 CI、tests/scripts 类型门只报不阻断、mjs 面二跑清理、删 claude-review.yml

> 模式：spec-driver-story（小需求，主线程实施）。类别：发布合同 + CI 配置（治理链）——改动面是 package.json scripts / ci.yml / 新 tsconfig / 新守护测试；主线程自审 + 门禁实跑 + verify 子代理；Codex 配额暂停期。来源：M10 §12.3 W-1 / W-6 / W-7 + INFO（mjs gate 二跑、claude-review 失效）。

## 1. 问题与证据（改动前，9362f1a8）

| # | 缺口 | 证据 |
|---|---|---|
| W-6 | `prepublishOnly = release:check && build && repo:check && vitest` —— **不跑 `test:plugins`（1840 用例：1838 pass / 2 skipped）也不跑 `typecheck:tests`** | `package.json`；发布前 mjs 判定器面与三份类型契约资产零门禁 |
| W-7 | `vitest.config.ts` 写着全局 80% + 六文件 per-file 95% 阈值（F150 SC-001 四个 extractor / F171 SC-005 两个 file-nav），**无任何门禁执行 `--coverage`** | CI 与 prepublishOnly 均无 coverage 步骤 |
| W-1 | 根 tsconfig 只 include `src/`：`tests/` 553 + `src/**/*.test.ts` 13 + `scripts/*.ts` 零类型门 | 本卡实跑 `tsconfig.tests.json`（根严格度 + allowJs）：**1022 处错误 / 147 文件**（TS2532 272、TS2339 242、TS2322 115、TS18048 111、TS2345 92、TS18047 61；tests/unit 835、integration 84、panoramic 75） |
| INFO | CI「Test」步跑 `npm test`（= vitest && test:plugins），后面又有独立「Test Plugins (mjs gate)」`if: always()` —— mjs 面**二跑** | `ci.yml` |
| INFO | `claude-review.yml`（PR 触发、API key 型 claude-code-action）**可见 ≥8 连败**（`gh run list` 可见的 8 条全部 failure，最近 2026-05-09），且与订阅优先凭据策略相悖、主线走直推 master 从不触发 | `gh run list --workflow=claude-review.yml` |

## 2. 修复

1. **prepublishOnly**：`release:check → build → repo:check → typecheck:tests → vitest → test:plugins`（新增两步；`typecheck:tests:full` **不进**发布门——1022 处错误会堵死发布路径，见 4）。
2. **覆盖率阈值接 CI**：新增独立 `coverage` job（与 `test` 并行；build + 建图 + `VITEST_MAX_FORKS=1` + `npm run test:coverage`）。本机全量实跑 All files **88.13 / 85.52 / 94.78 / 88.13**（stmts / branches / funcs / lines；branches 两次实测 85.52/85.53 属运行间噪声）且六个 per-file 95% 阈值全部达标（vitest 未报任何 `does not meet`）。**退出码口径如实**：本机 9 worker + coverage 采集复现一次「8205 全过却 exit 1」——F235/F269 的 birpc `onTaskUpdate` 60 s 超时假红，与阈值无关；job 钉 `VITEST_MAX_FORKS=1` 缓解，CI 首跑才是真验证（见 §4）——阈值未达时 vitest 非零退出即红。F150 SC-001 / F171 SC-005 的口径**不改**：它们从"ship 时点达成"变成"CI **持续可见**"——如实口径（对抗复审 A-W3）：本仓无分支保护、直推 master、coverage 既不在 `prepublishOnly` 也不在交付硬性顺序第 (3) 步，所以它是**事后通知（advisory）**而非拦截门；要变成拦截须把 `npm run test:coverage`（1-fork 8 min 40 s）写进交付顺序，这是成本 / 收益取舍，留用户拍板（见 push report）。
3. **tests/scripts 类型门（只报不阻断）**：新增 `tsconfig.tests.json`（extends 根、`allowJs`+`!checkJs` 让静态 import 的 `.mjs` 按推断类型参与、排除 `tests/type-tests/`（各自更严配置由 `typecheck:tests` 跑）与 `tests/fixtures/`）+ `npm run typecheck:tests:full`；CI 步骤 `continue-on-error: true`，打印 `exit / errors / files` 与错误码 Top5。**燃尽基线 1022 / 147** 登记为 M11 输入（§12.4「tests 类型零覆盖」条目数字更正：543 是临时配置口径，根严格度 + allowJs 实为 1022）。
4. **mjs 面二跑**：CI「Test」步改跑 `npx vitest run`（保留 VITEST_MAX_FORKS 诊断行），`test:plugins` 只由独立 gate 步跑一次。
5. **删 `claude-review.yml`**。
6. 守护：`tests/unit/release-ci-gates.test.ts`（prepublishOnly 顺序与不含 full / tsconfig.tests.json 覆盖面与排除 / CI Test 步不调 `npm test`、`run: npm run test:plugins` 恰 1 行且 `if: always()` / full 类型门 continue-on-error + 计数 / coverage job / claude-review 缺席）。

## 3. 实测教训（写进 ci.yml 注释）

- **tsc 遇语法错误会跳过全部语义检查**：`tests/fixtures/spec-drift/parser-degrade/broken.ts` 是刻意坏死的样本，不排除时 tsc 只报 1 个 TS1109、其余 1021 处语义错误**一个不报**（假绿）。
- **只看 `tail` 会把 1022 看成 1**——首稿据此把 full 类型门写成阻断步骤并塞进 prepublishOnly，被完整计数纠正。
- `.mjs` 静态 import 的 TS7016 用 `allowJs` 解决，不用 `@ts-expect-error`（directive 对多行 import 的落点不稳定，实测两次放错）。

## 4. 影响范围与边界

- prepublishOnly 新接的 `typecheck:tests` 在本卡基线 `9362f1a8` 上是**红**的（F280 的 type-only import 把 5 个 src 文件拖进 `exactOptionalPropertyTypes` 严格程序闭包，64 错；`1112e18a` 已修）：接门 ≠ 门已绿，rebase 到 `≥1112e18a` 后复跑 `npm run typecheck:tests` 确认 exit 0 再 push。
- coverage job 在 CI 上尚无一次实跑证据：push 后首个 run 才是这条 job 的真验证；若首跑出现 birpc 假红（8205 全过却非零退出），按 F269 路径处理，该 job 不在 test job 关键路径、不连坐。
- 发布路径变慢约 +1 min（test:plugins 32 s + typecheck:tests）；CI 多一个并行 job（覆盖率，4 vCPU 估 15–25 min，不在 test job 关键路径上）。
- 不做：修 1022 处测试类型错误（M11 燃尽）；把 full 类型门做成阻断；`npm test` 脚本本身不改（本地仍 vitest && plugins）；`fixture-isolation.yml` / `baseline-collect.yml` 不动；Python pinned 恒 unverifiable / perf anchor 停 4.3.0 / 慢测试收敛（§12.3 其它 INFO）另卡。

## 5. 审查档位

治理链配置：主线程自审 + 全量门禁实跑（build / vitest / test:plugins / repo:check / release:check / typecheck:tests / coverage）+ verify 子代理（PASS，0C/3W/4I，15/15 变异红）+ **异构对抗复审 ×1（两切入角：治理链接线 fail-open 面 / 守护测试绕过与假红面）**——首稿写「异构对抗档位不适用（无判据逻辑可绕过）」是错的：守护测试本身就是判据，复审 22 个绕过形态 21 个成立（角 A 0C/3W/5I，角 B 5C/3W/2I + 13 条假红）。处置见 §6。Codex 审查暂停，异构档位缺席（release/repo check 类）。

## 6. 工具使用反馈（Dogfooding）

- Spectra MCP：未用（配置文件改动，无代码结构问题）。Spec Driver：主线程按 story 骨架推进。无实质反馈，不落账。

## 6. 对抗复审处置（异构 ×1，两切入角）

### 6.1 角 A · 治理链接线 fail-open 面（0C / 3W / 5I）

| # | 发现 | 处置 |
|---|---|---|
| A-W1 | 六个 per-file 95% 阈值 key 是 glob：文件改名即空匹配、vitest 按 100% 静默通过，零信号 | **已修**：守护加「阈值 key 与 coverage.include 条目指向真实文件」（6 key + 4 include 逐一 existsSync） |
| A-W2 | 1 个语法坏死文件（含 allowJs 拉入的 .mjs）让 tsc 跳过全部语义检查，燃尽数坍缩成 1 与真燃尽不可区分 | **已修**：report-only 步对 `TS1xxx` 打 `::warning`（守护钉住） |
| A-W3 | 覆盖率「门禁」在本仓交付模型下是事后通知（无分支保护 / 不在 prepublishOnly / 不在交付顺序） | **已改口径**（§2.2 advisory）；是否写进交付顺序第 (3) 步留用户拍板 |
| A-I1 | `files=$files（` 在 bash 5.x UTF-8 下把「（」首字节吞进变量名 | **已修**：`${files}` |
| A-I2 | gate 的 `if: always()` 在 cancel 时也跑，官方建议 `!cancelled()` | **登记**（预存自 F201）：守护同时接受两种写法，改写留后续 |
| A-I3 | 闭包口径：full 1008 文件（tests 554 / src 343 / scripts 69 / plugins 41）；typecheck:tests 三程序各含 1 份契约 | 记录 |
| A-I4 | prepublishOnly 的 repo:check 无 CI 那条 `test -f specs/_meta/graph.json` 哑守卫，发布机缺图时图质量门空转 | **登记 M11**（发布门预存缺口） |
| A-I5 | coverage html/json 报告落盘即丢 | 不做 |

### 6.2 角 B · 守护测试绕过与假红面（5C / 3W / 2I + 13 假红）

| # | 发现 | 处置 |
|---|---|---|
| B-C1 | prepublishOnly 分隔符改 `;` / 追加 `; true` 守护照绿 | **已修**：整串 `toBe` |
| B-C2 | blocking 步加 `continue-on-error` / `\|\| true` / `set +e` 照绿 | **已修**：`continue-on-error` 全文件唯一且只在 report-only 步；npm/npx 调用行无吞退出码形态 |
| B-C3 | coverage job 加 `if: false` 照绿 | **已修**：job 头无 if/needs |
| B-C4 | 三个脚本体（test:plugins / typecheck:tests / test:coverage）改成空转照绿 | **已修**：脚本体整串 `toBe`（+ typecheck:tests:full） |
| B-C5 | 命令行追加参数收窄范围（`--project unit` / 单文件）照绿 | **已修**：Test 步 run 体末行恰为 `npx vitest run`、coverage 步 run 恰为 `npm run test:coverage` |
| B-W1 | tsconfig.tests.json 改成空集 / strict:false 照绿 | **已修**：`tsc --listFilesOnly` 闭包计数（tests ≥ 500 / src ≥ 300 / scripts ≥ 1）+ `--showConfig` strict |
| B-W2 | report-only 步删 `exit $status` 永远绿 | **已修**：钉末行 |
| B-W3 | claude-review.yml 换名复活 | **已修**：遍历 workflows 钉 `claude-code-action` 不出现（评测用 ANTHROPIC_API_KEY 不在此列） |
| B-I1 / B-I2 | 位置窗口断言可被注释冒充；`npm t` 回潮 | **已修**（结构切块取 step 的非注释 if 行）/ 登记 |
| 假红 F2/F8 | `!cancelled()` / 不带 `${{ }}` 的 always() 被判红 | **已修**：两种写法都接受 |
| 假红 F1/F3/F13 等 | 改 step 名 / 键序 / 单双引号 | **部分修**：结构切块按 step 名取块、env 单双引号都接受；step 改名仍须同步改守护（有意的合同锚点） |
