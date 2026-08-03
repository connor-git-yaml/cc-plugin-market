# Spec 合规审查报告 — F252 collector-surface 同族深收敛批次三项修复

> 审查子代理（spec-driver:spec-review，sonnet）无 Write 工具，本文件由主编排器按其返回原文落盘（内容零改写，仅此说明为编排器添加）。

## 审查方法说明

本次为 fix 模式审查，无独立 spec.md，制品为 fix-report.md + plan.md + tasks.md。逐项对照 tasks.md 声明与当前工作区实际代码状态（Read/Grep 静态核验，未执行 `npx vitest run` / `npm run build` / `npm run repo:check`，因当前工具集不含 Bash）。

## 逐条 Task 状态

| Task | 描述 | 状态 | 证据 |
|------|------|------|------|
| T001 | ignore-oracle.ts 改 `surfaceMatchesFile` 四连 + 注释重写 | 已实现 | L148-154 `ignoreDirsForPath` 四个 `surfaceMatchesFile(...)` 调用，import 列表（L30-36）已换成 `surfaceMatchesFile`，无 `extractExtension`/`surfaceHasExtension` 残留；L119-147 注释块已按 W-004 合同重写，含行为变化点论证 |
| T002 | generic-language-skeleton-collector.ts 两处收敛 | 已实现 | `resolveAdapterForFile`（L50-62）与 `walkFiles`（L67-102）均改为构造 case-insensitive `CollectorPipelineSurface` + `surfaceMatchesFile`，无 `path.extname` 提取残留 |
| T003 | file-scanner.ts 一处收敛，`ext` 变量保留 | 已实现 | `walkDir`（L254-336）判定行（L307）改 `surfaceMatchesFile(surface, entry.name)`；`ext`（L306）保留供 L316/L323/L331 languageStats/unsupported 统计使用，与声明逐字一致 |
| T004 | grep 前置确认 `extractExtension` 归零 | 已实现（结果层面可验证） | 全仓 `grep -rn "extractExtension\|collector-extname" src/ tests/` 无任何匹配，符合 T004/T009 双重确认后的预期终态 |
| T005 | ignore-oracle.test.ts 新增 3 条用例 | 已实现 | L152-166：`vendor/.go`→false、`.gradle/.java`→false、`vendor/foo.go`→true（对照组），措辞与 plan 一致 |
| T006 | `isValidCollectorFingerprint` 签名改 boolean | 已实现 | collector-fingerprint.ts L331-333，无 `is CollectorFingerprint` 类型谓词残留 |
| T007 | pinned-asset-loader.ts 迁移 `parseCollectorFingerprint` | 已实现 | `loadPinnedModuleGraphAsset`（L99-126）改用 `parseCollectorFingerprint`，null 时 throw，返回 parse 出的 snapshot；注释同步"防御性拷贝"表述 |
| T008 | guardrail 测试删除 `as never` | 已实现 | 全文 grep `as never` 零匹配；改为 `parseCollectorFingerprint` + `if (pinnedSnapshot === null) throw` 真实 control-flow narrowing，`isValidCollectorFingerprint` 布尔断言保留（双重覆盖） |
| T009 | 删除 collector-extname.ts + 测试 | 已实现 | Glob `src/panoramic/graph/collector-extname*` 零匹配，文件已物理删除 |
| T010 | source-commit.ts 注释同步 | 已实现 | L61-67 已改为"该消费方已在 F252 迁移至 `surfaceMatchesFile`……随之零消费方退役并删除"表述，历史事实未改写 |
| T011 | collector-surface.ts 注释同步 | 已实现 | `surfaceHasExtension` 文档注释（L160-170）已如实记账"零生产消费方"，函数本体（L175-183）未改 |
| T012 | `npx vitest run` 全量绿 | **无法验证**（本子代理无 Bash 工具） | 静态代码审查未发现明显编译/引用断裂；需编排器实际执行确认 |
| T013 | `npm run build` 零错误 | **无法验证**（同上） | 无遗留对 `collector-extname.ts` 的 import、唯一收窄依赖方已迁移，静态上无编译期风险信号 |
| T014 | `npm run repo:check` 零漂移 | **无法验证**（同上） | 本批次未触及 contract/wrapper 文件，静态上预期无漂移 |
| T015 | 提交前 Codex 对抗审查 | **未完成**（tasks.md 复选框为 `[ ]`） | 按 CLAUDE.local.md 约定为提交前硬性前置，当前尚未执行/记录结果 |

## 影响范围核验（与 fix-report 声明比对）

**范围内改动**：7 处生产文件 + 2 处测试改动 + 1 处新增测试 + 2 处删除 + 2 处注释同步——全部与 fix-report「同源问题」「派生清理」表逐项对应，**未发现范围蔓延**。

**范围外"不动"清单核验**（逐一实读源码确认）：
- `src/adapters/language-adapter-registry.ts::getAdapter`（L86-89）：仍为原始实现，未触碰 ✓
- `src/adapters/ts-js-adapter.ts`（L77-78）：仍为原始实现，未触碰 ✓
- `src/panoramic/cache/cache-key-builder.ts`（L88）：仍为原始实现，未触碰 ✓
- `specs/249-graph-collector-fingerprint/` 历史文档：目录内 11 个文件均为既有制品，未发现本批次改写迹象

**结论**：范围外清单声明属实，无 CRITICAL 范围蔓延问题。

## 行为保真承诺证伪尝试

1. **第 2 项"逐字等价"声明**：`surfaceMatchesFile` case-insensitive 分支实现（collector-surface.ts L209）与三处原判定式字符级相同，且 `extensions`/`supportedExtensions` 均为同一个 Set 引用传入 surface 对象。**未找到反例**，声明成立。
2. **第 1 项行为变化点声明**：反例构造尝试均未击穿——复合扩展名歧义（`component.d.ts`/`foo.ts.bak`）在 TSJS/PY 全部单段扩展名集合下新旧一致；路径中间段含点号目录（`vendor.go/foo`/`pkg.v2/README`）两侧均不产生假阳性；目录名字面为 `test.go` 的边界是既存设计且两侧结果相同。**未发现反例**，"唯一行为变化点局限于 case-insensitive 族纯 dotfile"经静态推演成立。

## Spec 更新判定核验

fix-report 判定"无需更新 spec"合理：本批次是 F249 scope 裁决的后续落地，`specs/249-*` 历史文档不改写，fix 模式不强制 spec.md。**不构成问题**。

## 问题分级汇总

- **CRITICAL**：0 个
- **WARNING**：1 个——T015（提交前 Codex 对抗审查）尚未执行，是阻断提交的前置缺口，需在 commit 前补跑
- **INFO**：1 个——T012-T014 本次仅静态审查，建议编排器提交前实际重跑三条命令做终态确认

## 总体结论

**PASS（有条件）**——T001-T011 全部真实落地，与 fix-report/plan 声明逐条比对未发现不一致或范围蔓延；两条行为保真承诺未被证伪；范围外三文件确认未触碰。唯一缺口是 T015 Codex 对抗审查（主编排器随后执行）与 T012-T014 终态复核。
