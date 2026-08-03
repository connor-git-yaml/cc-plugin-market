# Tasks: collector-surface 同族深收敛批次三项修复

**输入**：`fix-report.md`（5-Why 诊断 + 影响范围扫描）、`plan.md`（方案 A：三项一次收敛 + 派生死代码清理）
**模式**：fix（精简任务清单，不按 User Story 组织，按"SSoT 消费方 → 类型收紧 → 死代码删除"的强制顺序排列）

## 排序硬约束

先改 SSoT 消费方（ignore-oracle / generic-collector / file-scanner），再做类型收紧（collector-fingerprint / pinned-asset-loader / guardrail 测试），最后执行 `collector-extname.ts` 删除；注释同步随对应改动完成——避免中间态出现 `extractExtension` 悬空引用导致编译失败。

## Format: `[ID] [P?] 描述 + 文件路径`

- **[P]**：可并行（不同文件、无依赖）
- 本批次为 fix 模式，无 User Story 标记

---

## Phase 1：SSoT 消费方收敛（对应 plan 变更 1 / 2a / 2b）

**目标**：ignore-oracle 分派语义化 + 三处 producer matcher 收敛为 `surfaceMatchesFile`，`extractExtension` 归零生产消费方。

**⚠️ 依赖顺序**：T001 必须先于 T005（新增测试依赖 T001 的行为变化落地）；T002/T003 与 T001 各自独立可并行；三者均须在 Phase 2 之前完成。

- [x] T001 改写 `src/panoramic/graph/quality/ignore-oracle.ts`：删除 `extractExtension`/`surfaceHasExtension` import，改为 import `surfaceMatchesFile`（来自 `../../../collector-surface.js`）；`ignoreDirsForPath` 函数体四个判定改为 `surfaceMatchesFile(surface, relativePath)` 四连；函数上方注释块按 W-004 合同重写（交代"手上持有完整相对路径，不再需要先提取扩展名"+ 大小写不敏感族纯 dotfile 的行为变化点 + 大小写敏感族零变化的等价性论证）
- [x] T002 [P] 改写 `src/batch/generic-language-skeleton-collector.ts`：新增 import `surfaceMatchesFile` + `CollectorPipelineSurface`（来自 `../collector-surface.js`）；`resolveAdapterForFile`（L44-53）改为逐 adapter 构造 case-insensitive `CollectorPipelineSurface` 后用 `surfaceMatchesFile` 判定，移除 `path.extname` 提取；`walkFiles`（L58-91）在函数体首行把入参 `extensions` 包成 surface（函数签名不变），判定行替换为 `surfaceMatchesFile(surface, entry.name)`
- [x] T003 [P] 改写 `src/utils/file-scanner.ts`：新增 import `surfaceMatchesFile` + `CollectorPipelineSurface`；`walkDir`（L253-263 签名不变）在循环前构造一次 case-insensitive surface；判定行 `supportedExtensions.has(ext)` 改为 `surfaceMatchesFile(surface, entry.name)`；`ext` 变量保留在原位（供 L308/L315/L322 languageStats/unsupported 统计使用）
- [x] T004 全仓 `grep -rn "extractExtension\|collector-extname" src/ tests/` 确认变更 1 落地后 `extractExtension` 仅剩自身模块（`collector-extname.ts`）与其自身测试引用（`collector-extname.test.ts`），为 Phase 3 删除做前置确认；验证方式：grep 输出仅两处自引用
- [x] T005 在 `src/panoramic/graph/quality/ignore-oracle.test.ts` 现有"按语言分派（FIX-5）"describe 块内追加 3 条新用例（钉住变更 1 唯一行为变化点）：
  - `vendor/.go → 不 ignored`（Go 纯 dotfile 从误分派改为 union 兜底）
  - `.gradle/.java → 不 ignored`（Java 纯 dotfile 同上）
  - `vendor/foo.go（真实 Go 文件）→ 仍 ignored`（对照组，锚定非纯 dotfile 场景零变化）
  验证方式：`npx vitest run src/panoramic/graph/quality/ignore-oracle.test.ts` 3 条新用例 + 全部既有用例通过

**检查点**：`npx vitest run` 跑 `ignore-oracle.test.ts` / `generic-language-skeleton-collector.test.ts` / `tests/unit/file-scanner.test.ts` 全绿；SSoT 消费方收敛完成，`extractExtension` 归零生产消费方。

---

## Phase 2：类型层收紧（对应 plan 变更 3 / 4 / 5）

**依赖**：无需等待 Phase 1（改动文件互不重叠），但按 plan 排序约定放在 Phase 1 之后执行，降低认知切换成本；三个任务之间有顺序依赖（T006 先行，T007/T008 依赖 T006 的签名变更）。

- [x] T006 改写 `src/panoramic/graph/collector-fingerprint.ts` L331-333：`isValidCollectorFingerprint` 签名从 `value is CollectorFingerprint` 改为 `boolean` 返回，函数体逻辑不变（`return parseCollectorFingerprint(value) !== null`）
- [x] T007 改写 `tests/helpers/pinned-asset-loader.ts`：import 把 `isValidCollectorFingerprint` 换成 `parseCollectorFingerprint`（`CollectorFingerprint` 类型 import 保留供接口标注）；`loadPinnedModuleGraphAsset` 函数体改为 `parseCollectorFingerprint(parsed['fingerprint'])`，`null` 时 throw 明确错误信息，返回值使用 parse 出的 snapshot；上方文档注释同步改为"额外获得外部 JSON 防御性拷贝收益"表述
- [x] T008 改写 `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` L132-144：import 追加 `parseCollectorFingerprint`；唯一 `as never` 用例改为经 `if (pinnedSnapshot === null) throw` 的真实 control-flow narrowing 获取强类型 snapshot，删除 `as never` 类型断言；`isValidCollectorFingerprint` 布尔断言保留不删（形成双重覆盖）

**检查点**：`npm run build` 确认 `isValidCollectorFingerprint` 签名收紧后全仓类型检查零错误（`pinned-asset-loader.ts` 是唯一收窄依赖方，已迁移完成）；`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 全绿。

---

## Phase 3：派生死代码清理 + 注释同步（对应 plan 变更 6 / 7）

**依赖**：必须在 Phase 1 的 T004 确认完成后执行（`extractExtension` 归零生产消费方是删除的前提）。

- [x] T009 删除 `src/panoramic/graph/collector-extname.ts` 与 `src/panoramic/graph/collector-extname.test.ts`；执行前重新跑 `grep -rn "extractExtension\|collector-extname" src/ tests/` 二次确认零残留引用（T004 是首次确认，删除前必须复核，因 Phase 2 可能间接引入新引用）
- [x] T010 [P] 同步 `src/panoramic/graph/source-commit.ts` L61-65 注释：把提及 `collector-extname.ts` 仍被 `ignore-oracle.ts` 引用的表述改为"该消费方已在 F252 迁移至 `surfaceMatchesFile`，`collector-extname.ts` 随之零消费方退役并删除"，历史事实（F248 达成"消除双实现"意图）保留不改写
- [x] T011 [P] 同步 `src/collector-surface.ts` L160-164（`surfaceHasExtension` 文档注释"适用边界（W-004）"段）：把 `ignore-oracle.ts` 的例子改为如实记账——已迁移至 `surfaceMatchesFile`，`surfaceHasExtension` 现零生产消费方，作为 SSoT 公共 API 面合法组成保留（供未来"确实只掌握扩展名字符串"的消费方使用），继续被 `tests/unit/collector-surface.test.ts` 真值表测试锚定；函数本体不改

**检查点**：`npm run build` 确认删除 `collector-extname.ts` 后无遗留 import 报错；`npx vitest run` 确认 `collector-extname.test.ts` 已不再出现在测试清单中。

---

## Phase 4：全量验证与提交前检查

- [x] T012 `npx vitest run` 全量跑通，重点关注 `ignore-oracle.test.ts`（含 3 条新用例）、`collector-fingerprint.test.ts`、`collector-fingerprint-guardrail.test.ts`、`generic-language-skeleton-collector.test.ts`、`tests/unit/file-scanner.test.ts`、`tests/unit/collector-surface.test.ts`、`tests/unit/batch-orchestrator.test.ts`、`tests/panoramic/community-persist.test.ts`、`tests/batch/graph-only-pipeline.test.ts` 零失败
- [x] T013 `npm run build` 零类型错误
- [x] T014 `npm run repo:check` 零漂移（本批次不触及 contract/wrapper，预期零新增问题）
- [x] T015 提交前按仓库约定跑 Codex 对抗审查（`codex:codex-rescue` 子代理，对抗视角审查本批次全部改动）；critical/warning 按仓库处置原则修复后重跑 T012-T014
  > 实际执行形态：Codex 周配额耗尽（task-msdg9tz5-5clns9 failed，08-08 恢复），按 F249 先例改**内部对抗复审**（独立 opus 子代理，证伪视角）——0 CRITICAL / 3 WARNING / 6 INFO，W1/W2/W3 全部处置（注释扩正 + 2 条测试 + BEHAVIOR_VERSION 裁决制品化），处置后 T012-T014 已重跑零失败；详见 fix-report.md《对抗复审处置记录》。配额恢复后可补 Codex 交叉验证

---

## FR 覆盖映射表

| 报告条目 | 对应 Task ID |
|---------|-------------|
| 第 1 项：ignore-oracle 分派改 `surfaceMatchesFile` | T001, T005 |
| 第 2 项：`generic-language-skeleton-collector.ts` 两处 matcher 收敛 | T002 |
| 第 2 项：`file-scanner.ts` 一处 matcher 收敛 | T003 |
| 第 3 项：`isValidCollectorFingerprint` 类型谓词改 boolean | T006 |
| 第 3 项派生：`pinned-asset-loader.ts` 迁移消费 | T007 |
| 第 3 项派生：guardrail 测试清理 `as never` | T008 |
| 派生清理：删除 `collector-extname.ts` + 其测试 | T004（前置确认）, T009 |
| 注释同步：`source-commit.ts` | T010 |
| 注释同步：`collector-surface.ts`（`surfaceHasExtension` 文档） | T011 |
| 全量验证 | T012-T015 |

**100% 覆盖**：fix-report.md 影响范围扫描表列出的 7 处同源修复 + 2 处派生清理 + 2 处注释同步，全部对应到具体 Task ID。

---

## 依赖与执行顺序说明

### Phase 依赖

- **Phase 1（SSoT 消费方收敛）**：无前置依赖，可立即开始；T002/T003 可与 T001 并行（不同文件），T004/T005 依赖 T001 完成
- **Phase 2（类型层收紧）**：不依赖 Phase 1 的文件改动，但按 plan 顺序约定排在其后；T007/T008 依赖 T006 的签名变更
- **Phase 3（死代码清理）**：硬依赖 Phase 1 的 T004 确认（`extractExtension` 归零生产消费方）；T010/T011 可与 T009 并行（不同文件，纯注释）
- **Phase 4（全量验证）**：依赖 Phase 1-3 全部完成

### 并行机会

- Phase 1 内：T002、T003 可并行（不同文件，逻辑独立）
- Phase 3 内：T010、T011 可并行（纯注释改动，不同文件）
- 跨 Phase 不建议并行——本批次风险等级 LOW 且改动面小（<10 文件），顺序执行认知成本更低，无需多人协作调度

### 推荐实施策略

单人顺序执行：Phase 1 → Phase 2 → Phase 3 → Phase 4，全部在同一提交内交付（plan.md 已判定风险等级 LOW，不强制分阶段实现/分次提交）。
