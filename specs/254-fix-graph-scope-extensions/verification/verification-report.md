# Verification Report: 254-fix-graph-scope-extensions

**特性分支**: `254-fix-graph-scope-extensions`
**验证日期**: 2026-08-03（环境系统日期在验证过程中滚动至 2026-08-04，不影响结果）
**验证范围**: Layer 1（fix 模式：Task 完成判据对齐）+ Layer 1.5（验证证据核查）+ Layer 1.75（深度检查）+ Layer 2（原生工具链，亲自实跑）

## Layer 1: Task-Code 对齐（fix 模式，无 spec.md FR 清单，以 tasks.md T1-T5 完成判据为准）

| Task | 完成判据 | 状态 | 说明 |
|------|---------|------|------|
| T1 | `readEmbeddedGraphMeta` 新增导出 + `readEmbeddedSourceCommit` 薄壳化 + 仓根转发壳带出 | ✅ 已实现 | `graph-bootstrap-status.mjs` L116 定义 `readEmbeddedGraphMeta`，L160 `readEmbeddedSourceCommit` 内部调用它做投影；`graph-consumption-cli.mjs` 已改为 `import { checkFreshness, readEmbeddedGraphMeta }`（不再导入 `readEmbeddedSourceCommit`，说明该函数被 T3 的新读取路径完全替代，属合理演进，非缺陷） |
| T2 | `GRAPH_SCOPE_EXTENSIONS` 12 扩展 + `annotateImpactCaveat` 第 4 参 `scopeExtensions` | ✅ 已实现 | `decision.mjs` L70-74 确认值为 12 扩展全并集；注释已改写为"静态 fallback + SSoT 锚点 + 合同测试守护"语义，无旧措辞残留 |
| T3 | `graph-consumption-cli.mjs` 图自述面优先消费改造（`deriveScopeExtensionsFromFingerprint` / `scopeExtensionsSource` / `AUDIT_SCHEMA_VERSION=3`） | ✅ 已实现 | `AUDIT_SCHEMA_VERSION = 3` 确认（L57）；`FINGERPRINT_SURFACE_KEYS` 已导出（L238）；端到端抽查（见下）实测 `.mjs` 改动在带合法 fingerprint 的图下判 `in-graph-scope` + `scopeExtensionsSource: "graph-fingerprint"` |
| T4 | 跨语言合同测试 `tests/unit/graph-scope-extensions-contract.test.ts` | ✅ 已实现 | 文件含 5 个 `it` 用例（并集一致性 / 逐管线定位 / fallback 不超集 / FINGERPRINT_SURFACE_KEYS 一致性 / 形态约束），超出 tasks.md 最低要求（W-2 修复追加的第 4 条用例已落地） |
| T5 | 全量验证 + Codex 对抗审查处置 | ✅ 已实现（本轮亲跑复核，见 Layer 2） | 四门禁本轮亲自实跑全部零失败，与 implement 声称一致；Codex 内部对抗复审已在 fix-report「审查处置与残留登记」节记录（配额未恢复，走内部对抗复审路线，非常规 codex-rescue 调用——按 fix-report 登记的既有先例处理，不在本轮验证范围内重复) |

### 覆盖率摘要

- **总 Task 数**: 5（T1-T5）
- **已实现**: 5
- **未实现**: 0
- **覆盖率**: 100%

## Layer 1.5: 验证铁律合规

implement 返回声称「test:plugins 1321/1321、vitest 6971 passed / 0 failed、build exit 0、repo:check exit 0（仅 1 条既有 graph-stale warning）」——本轮已**逐条亲自重跑**四门禁（见 Layer 2），实测计数与退出码与声称**完全一致**，未见"should pass"/"looks correct"等推测性表述。

**状态**: COMPLIANT
**缺失验证类型**: 无
**检测到的推测性表述**: 无

## Layer 1.75: 深度检查

- **调用链完整性**：追踪 `decide` 子命令完整链路 `collectGraphAvailability`（读 `readEmbeddedGraphMeta`）→ `deriveScopeExtensionsFromFingerprint`（五管线 key 全有全无核验）→ `collectCoverageScope(files, scopeExtensions)` → `payload.scopeExtensionsSource`，链路无断点，参数逐层显式传递（无 `**kwargs` 式隐式透传）。`annotate-caveat` 子命令独立重读 `readEmbeddedGraphMeta` 一次，未复用 decide 阶段的值——与 T3 第 6 点设计一致（两个独立进程各自求值）。
- **数据持久化验证**：本 fix 无数据库写入，审计事件走 JSONL append（`auditWritten` 字段），不适用 commit/flush 检查。
- **配置贯穿验证**：`FINGERPRINT_SURFACE_KEYS` 常量在 CLI 侧手写、合同测试第 4 条用例断言其与 `computeCollectorFingerprint().extensionSurface` 的 key 集合一致（SSoT 貫穿路径：`collector-surface.ts` → fingerprint 计算 → CLI 手写副本 → 合同测试守护），本轮 vitest 亲跑该测试已过（`graph-scope-extensions-contract.test.ts` 5 tests 全绿）。

## Layer 1.8 / 1.9：残留扫描 + 文档一致性

本次改动为存量函数扩展参数化 + 常量值更新，未涉及模块删除/重命名/公共接口删除，故不适用残留扫描与文档一致性检查两项。`git status` 确认 `skills/` 与 `skills-codex/` 下无改动文件，符合 fix-report「SKILL.md 零改动」声明。

## Layer 2: 原生工具链（TypeScript/Node.js monorepo，亲自实跑）

**检测到**: package.json（npm）+ 本次改动为 `.mjs`（Node 直跑）+ `.ts`（vitest/tsc）混合

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| 单测（plugins 侧 Node test runner） | `npm run test:plugins` | ✅ PASS | tests 1321 / pass 1321 / fail 0 / duration 45.3s |
| 单测（vitest 全量） | `npx vitest run` | ✅ PASS | Test Files 517 passed \| 4 skipped (521)；Tests 6971 passed \| 18 skipped \| 21 todo (7010)；耗时 70.37s；**未出现** F235 flaky `Timeout calling "onTaskUpdate"` Errors 行，本轮无需甄别、无需复跑 |
| Build | `npm run build` | ✅ PASS | `tsc` 零错误；postbuild 盖章 commit=68eb7e5f (dirty)，exit 0 |
| 仓库级合同校验 | `npm run repo:check` | ✅ PASS（status=warn，非阻断） | 全部子检查 pass，仅 1 条 `graph-quality:freshness` warning：图 sourceCommit 落后于当前 HEAD 且缺 collector fingerprint 记录（**本地开发环境预期常态**——本次改动未重建 `specs/_meta/graph.json`，非本 fix 引入的回归；提示重跑 `spectra batch --mode graph-only`） |

无工具链未安装项；无 Monorepo 子项目需单独验证（单一 npm workspace）。

## 端到端抽查（临时 sandbox，未污染 worktree）

在 scratchpad 下构造独立 git 仓库 + 手写 `specs/_meta/graph.json`（含 `formatVersion:1`、五管线 `extensionSurface`，覆盖 `.mjs`），提交后修改 `.mjs` 文件并跑：

```
node plugins/spec-driver/scripts/graph-consumption-cli.mjs decide --project-root . --refresh-policy declined --dry-run --changed-files index.mjs
```

实测输出关键字段：

```json
"inputs": { "coverageScope": "in-graph-scope", ... },
"scopeExtensionsSource": "graph-fingerprint"
```

**结论**：`.mjs` 改动在带合法 fingerprint 的图下被判为 `in-graph-scope`（本 fix 要修复的核心场景），且来源标注为 `graph-fingerprint`（图自述面优先），与修复前"`.mjs` 判 `out-of-graph-scope`"的缺陷行为形成正面对照。（sandbox 中 `freshness` 显示 `unknown-provenance` 是单提交沙箱缺少 `HEAD~1` 导致的构造伪影，与本次验证目标——coverageScope 判定与 scopeExtensionsSource 来源标注——无关，不影响结论。）

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Task Coverage（fix 模式） | 100%（5/5 T1-T5，含第 5 轮增量修复） |
| 验证铁律合规 | COMPLIANT |
| test:plugins | ✅ PASS（第 5 轮终态：1324/1324） |
| vitest | ✅ PASS（第 5 轮终态：6972 passed / 0 failed，无 F235 flaky 信号） |
| Build | ✅ PASS |
| repo:check | ✅ PASS（1 条既有 graph-stale warning，非阻断非回归） |
| 端到端抽查 | ✅ 核心场景（`.mjs` in-scope + graph-fingerprint 来源）实测通过 |
| 第 5 轮增量修复（W-1 矩阵行 2 前提失效） | ✅ 已复核落地，详见文末「第 5 轮修复复核」 |
| **Overall** | **✅ READY FOR REVIEW（终态，含第 5 轮修复）** |

### 需要修复的问题（如有）

无。implement 声称的四项验证结果（含第 5 轮增量修复后终态）本轮亲跑全部复核一致，未发现回归、未发现证据造假、未发现推测性表述。

### 未验证项（工具未安装）

- 无（`npm`/`node`/`tsc` 均已安装且验证通过）

### 备注

- 本地机器无 `timeout`/`gtimeout` 命令，四门禁未附加超时前缀直接执行；均在合理时长内（最长 vitest 70.37s）正常退出，未触发超时风险。
- `repo:check` 的 `graph-quality:freshness` warning 与本次代码改动无因果关系（图产物本身未随本次 commit 更新），维持 warn 级别不阻断，符合"仅 Lint/非阻断类警告不触发暂停"处置原则。

---

## 第 5 轮修复复核（内部对抗复审抓 3 WARNING，含矩阵行 2 前提失效设计缺陷）

### 背景

内部对抗复审在原报告产出后抓到 3 WARNING，核心一条是"矩阵行 2（`consume-degraded` 早退）在 `refreshPolicy: allowed` 分支下前提失效"——W-1 现状钉住用例揭示的静默丢弃场景，在"允许重建"前提下本应先判"重建后是否进入范围"而非直接沿用当前静态/动态面早退。第 5 轮改动引入 refreshPolicy 分支化 coverage 判据（`allowed` → derived ∪ static 并集）+ 相关强化，文件清单不变（6 改 1 增）。

### 四门禁重跑（终态实测）

| 验证项 | 命令 | 声称值 | 实测值 | 结论 |
|--------|------|--------|--------|------|
| 单测（plugins） | `npm run test:plugins` | 1324/1324 | tests 1324 / pass 1324 / fail 0 | ✅ 一致 |
| 单测（vitest 全量） | `npx vitest run` | 6972 passed / 0 failed | Test Files 517 passed \| 4 skipped (521)；Tests 6972 passed \| 18 skipped \| 21 todo (7011)，exit 0 | ✅ 一致；未出现 F235 flaky `Timeout calling "onTaskUpdate"` Errors 行，无需甄别 |
| Build | `npm run build` | exit 0 | `tsc` 零错误，postbuild 盖章 exit 0 | ✅ 一致 |
| repo:check | `npm run repo:check` | exit 0，仅既有 graph-stale warning | `status=warn`，唯一 warning 为 `graph-quality:freshness`（与本次改动无因果关系，图产物未重建） | ✅ 一致 |

### 第 5 轮声称抽查

| 声称项 | 核实方式 | 结论 |
|--------|---------|------|
| (h)(i)(j) 三条新用例存在且断言形态与声称一致 | `grep` 定位 `graph-consumption-cli.test.mjs` L1632/L1656/L1678 | ✅ 存在：(h) 窄面旧图 + `.mjs` + stale × allowed → 进入刷新链（不早退）；(i) 同构造 + declined → 仍走行 2；(j) 目标落在并集之外时 allowed 下行 2 仍早退。三者分别用 `coverageUnionApplied === true/false` 断言核心行为切换，与声称的"分支化判据"逻辑吻合 |
| (d) 第 9 畸形例 | `grep "畸形"` 定位 L1475 起 `(d) fingerprint 结构畸形 → 整体回落 static-fallback，绝不产出部分并集` | ✅ 存在（原有用例组的畸形分支扩充，"绝不产出部分并集"措辞与 T3 原设计一致，未被第 5 轮破坏） |
| `DECIDE_OUTPUT_KEYS` 含 `coverageUnionApplied` | `grep` 定位测试文件 L104 常量数组 + L568/L624/L1810 三处 `deepEqual` 消费点 + 审计事件封闭键集 L1019 | ✅ 存在，且实现侧（`graph-consumption-cli.mjs` L517-518/592/612/617）同步产出该字段，注释显式声明"annotate 侧无此字段"（语义边界清晰，无跨命令误用风险） |
| 合同测试 6 用例含 `formatVersion` 断言 | `Read`/`grep` `graph-scope-extensions-contract.test.ts` | ✅ 新增第 6 条 `it('SUPPORTED_FINGERPRINT_FORMAT_VERSION 与 computeCollectorFingerprint().formatVersion 一致')`，锚定 `SUPPORTED_FINGERPRINT_FORMAT_VERSION`（cli.mjs L256 导出值 1）与 SSoT 的 `computeCollectorFingerprint().formatVersion` 逐项一致；vitest 实测该文件 6 tests 全绿 |
| `AUDIT_SCHEMA_VERSION` 仍为 3 | `grep` `graph-consumption-cli.mjs` L58 | ✅ 仍为 `3`（第 5 轮为行为修复 + 新增可观测字段，未触发 schema 版本再跳变，符合"审计事件新增字段属 additive，不必然要求版本号递增"的既有惯例） |

### 结论

第 5 轮增量修复的四门禁终态与声称完全一致，(h)(i)(j)/(d) 用例、`coverageUnionApplied` 字段、`SUPPORTED_FINGERPRINT_FORMAT_VERSION` 合同锚定均已如实落地，未发现证据造假或推测性表述。W-1 矩阵行 2 前提失效的设计缺陷已通过 refreshPolicy 分支化判据修复，且新增用例组从正反两面（allowed 进入刷新链 vs declined 仍早退 vs 越界仍早退）覆盖了行为切换的边界。

**总结论：✅ PASS（含第 5 轮修复，终态 READY FOR REVIEW）**

