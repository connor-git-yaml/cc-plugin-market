# 验证报告：簇④ 引擎 / CLI 小补合集（M11 卡 C）

日期 2026-09-15 · 审查档位：Codex 审查暂停，异构档位缺席 → 内部异构对抗复审 ×2（路径命中 `plugins/spec-driver/scripts/**` / `lib/**` / `agents/**` / `templates/**` / 仓根 `scripts/**` ⇒ 门禁类档位）

## FR 对账（14 / 14 已实现）

| FR | 判定 | 证据 |
|---|---|---|
| FR-001 | 已实现 | `orchestrator-cli-m11c.test.mjs`（gates_* 6 变异全杀；diagnostics 用例：override 抽 GATE_DESIGN ⇒ gate-mounting-lost + base 挂载） |
| FR-002 | 已实现 | `agents-byte-budget-candidates.test.ts`；story / feature SKILL 各一条 |
| FR-003 | 已实现 | `check-fr-matrix.test.mjs`（编号前缀 / 装饰 / Re-check 变体；sectionMissing；fenced / 行内代码 / 引用块不算） |
| FR-004 | 已实现 | 同上（认领列语义、子表不算、tokenizer 六形态、claimColumnMissing、specEmpty、EISDIR exit 2） |
| FR-005 | 已实现 | `gate-class-path-list-parity.test.ts`；`spec-drift-repo-check-regression` 新增 check id；块外换算式副本 5 份删除并入块内 |
| FR-006 | 已实现 | 25 种形态输出文本带引号 / 14 种普通串不带 / 锚点三例（反转判据、删锚、删各支的变异全部会红） |
| FR-007 | 已实现 | `agents/verify.md`「分层索引」节（对抗审查 I-1：首版遗漏，本轮补上） |
| FR-008 | 已实现 | `gate-design-convergence-loop.md`（I-7 补 (a′)，I-8 单位分列） |
| FR-009 | 已实现 | `sync-merge-engine-m11c.test.mjs` C-1 用例（两个字典序方向：FR 4 条不双计、0 冲突、时间线 1 条、warning + finding） |
| FR-010 | 已实现 | W-1 用例（entryCount == 时间线条目数；duplicateMappedIds / duplicateIds） |
| FR-011 | 已实现 | W-5 / M13 用例（非 json 路径 exit 1）；C-2 独立扫描器用例（5 形态 + 排除 6 形态，与抽取器一致 5/5） |
| FR-012 | 已实现 | `product-mapping-consolidation.test.ts` + M16/M17 用例（tie-break 字典序首个） |
| FR-013 | 已实现 | C-3 / M11 用例（`: ~` / `: {}` / `: ""` 已存在；from 出现两次不定位）+ M15（lint / preflight 零写盘） |
| FR-014 | 已实现 | `npx tsc -p tsconfig.tests.json --noEmit` 计数 1071 → 1031（−40 = 全部 TS2578）；`npm run typecheck:tests` 门绿 |

## 对抗审查处置

**sync 引擎侧（3C / 6W / 8I）**：C-1 同编号 fix-report 双计（本仓 133 / 201 实测 49 条虚假冲突）→ 跳过 + 双闸 + finding；C-2 fr-floor 同源自证 → 独立扫描器 + 诚实文案（真实覆盖面：抽取器判据 / flush / 路由；不覆盖约定外写法）；C-3 toLine 光杆判据 → 任意尾部；W-1 preflight 同源；W-2 文案分开数；W-3 第三字面量；W-4 占位指名 + 文案改正；W-5 duplicate-dirs finding；W-6 totalSpecs 旧义 + totalFixReportDirs；I-3 截断标记；I-6 数字校正（identity 33 例）。存活变异 M5 / M11 / M13 / M15 / M16 / M17 / M19 各补用例。
**未采纳 / 记录**：I-2 rootCause 静默 null（null 即「没写或写法不同」，本轮不细分）；I-4 find 取文档序（1/107 抢错节，记录）；I-5 同目录 fix-report 被实质 spec 遮蔽（设计如此）；I-7 收敛护栏词法面（记录）；I-8 新 import 边（无环，记录）。

**CLI / 序列化 / 散文侧（3C / 11W / 8I）**：C-1 接线谓词 → `passed === false` + `sectionMissing` + 标题容忍；C-2 认领列语义 + 首表；C-3 spec-drift 清单补 id；W-1/W-2/W-3 yamlScalar 两向 + 二进制 + 时间戳 + 数字支至少一位数字 + 注释收窄；W-4 陈旧注释；W-5 diagnostics；W-6/W-7 tokenizer + 散文口径 + FR_ID 单源；W-8 specEmpty；W-9 数字校正；W-10 换算式入块；W-11 feature SKILL 补步；I-1 分层索引；I-3 EISDIR exit 2；I-6 标题 15；I-7/I-8 措辞；I-2 FR_ID_SOURCE 复用。**记录**：I-4 `\` 未转义（预存）；I-5 F277 冻结记录行号漂移（冻结制品不改）。

## 门禁

`npm run test:plugins` 2044 例 2042 通过 0 失败（2 跳过）；`npm run repo:check` 全 pass（含新 check id）；`npm run typecheck:tests` 绿。
