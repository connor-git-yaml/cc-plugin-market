# Spec 合规审查报告 — Feature 250 (.pyi 类型 stub 纳入 Python 符号采集面)

> 审查执行：spec-review 子代理（sonnet）；该子代理无 Write 权限，本文件由主编排器按其返回原文代写落盘。

## 逐条 FR 状态

| FR 编号 | 描述 | 状态 | 证据/说明 |
|---------|------|------|----------|
| FR-001 | `PYTHON_SYMBOL_SCAN_SURFACE.extensions` 扩为 `['.py','.pyi']` | 已实现 | `src/collector-surface.ts:121-124`，`matchSemantics` 保持 `case-sensitive` |
| FR-002 | 保持 `scanPyFiles` 消费 SSoT（不回退硬编码）+ 防回归探针 | 已实现 | `src/adapters/python-adapter.ts:171` `surfaceMatchesFile(PYTHON_SYMBOL_SCAN_SURFACE, entry.name)`；防回归探针 `T-FR002`（`tests/adapters/python-adapter.test.ts:768-783`），仅放置 `.pyi` 文件断言仍产出 module 节点 |
| FR-003 | extraction 路（module+component+contains）与 `buildModuleGraph`（ModuleGraph 视图）双产物同步生效 | 已实现 | `extractSymbolNodes`（`python-adapter.ts:238-271`）对 `.pyi` 产出三件套；`T-guard-a-b`（`python-adapter.test.ts:663-692`）断言 `.pyi` 完整进 `modules[]` 且不作为 import 目标 |
| FR-004（护栏 A） | pyModuleMap 显式跳过 `.pyi`（relPySet 收录后、map 写入前）；tryResolveAtDir 候选恒 `.py`/`__init__.py`；两处均配防回归探针 | 已实现（**一处轻微覆盖缺口**） | 落点精确核实：`python-adapter.ts:313-326`，`relPySet.add(rel)`（L316）先于 `if (absF.endsWith('.pyi')) continue;`（L324）；`tryResolveAtDir`（L412-424）候选字面量仍为 `X.py`/`X/__init__.py`，零改动。**但**相对 import 场景的 shadow 对回归探针未见新增（`T-guard-a-b` 仅覆盖绝对 import），相对场景防护仅靠结构性事实——相对 FR-004 原文「两处均 MUST 配备探针」存在轻微覆盖缺口 |
| FR-005（护栏 B） | label 剥离按真实扩展名，两处分支同 helper | 已实现 | `stripFileExtension`（`python-adapter.ts:44-46`）；正常分支 L242、parseError 分支 L224；`T-label-normal`/`T-label-parse-error`/`T-C1-dotfile` 三探针覆盖两分支+纯点文件边界 |
| FR-006 | 探针翻转 + 两面一致改写 + 保留硬编码期望值（禁自证） | 已实现 | `tests/unit/collector-surface.test.ts:368-434`：`mod.pyi` MUST 命中；硬编码期望值 `['mod.py','mod.pyi']`（L416/L429/L430），显式注释"不允许退化为自证断言" |
| FR-007 | fixture 再生 delta 精确匹配契约 3/4 | 已实现 | 实测 `expected-graph-only-graph.json` 与契约 3 逐字段一致（含 `signature:"def mod_fn() -> int"` 实跑值）；`expected-module-graph.json` 仅指纹变化，与契约 4 一致 |
| FR-008 | 三处注释改写为"已裁决设计意图" | 已实现 | `collector-surface.ts:95-124`、`python-adapter.ts:53-65`、`collector-fingerprint.ts:44-47` 三处核实到位，无自相矛盾残留 |
| FR-009 | 指纹自动 stale，无需人工 bump BEHAVIOR_VERSION | 已实现 | `collector-fingerprint.ts:83` `BEHAVIOR_VERSION = 1` 未改动 |
| FR-010 | `.pyi` 解析失败沿用 parseError 降级分支，label 修正同步 | 已实现 | L214-233 保留 `metadata: { parseError: true }` + `stripFileExtension`；`T-label-parse-error` 验证 |
| FR-011（可选） | `@overload` 收敛探针 | 已实现（可选项） | `T-overload`（`python-adapter.test.ts:810+`） |

## 总体合规率

11/11 FR 已实现（100%），其中 FR-004 一处轻微覆盖缺口（见偏差清单）。

## 偏差清单

| FR 编号 | 状态 | 偏差描述 | 修复建议 |
|---------|------|---------|---------|
| FR-004 | 已实现（轻微缺口） | 相对 import 场景（`tryResolveAtDir`）无专门 shadow 对回归探针，仅靠"候选列表字面量不含 `.pyi`"结构性保证。tasks.md T005 将该子项处理为"确认不做改动"（tasks 与 spec 字面之间的边界收窄，非实现偏离 tasks） | 补一条相对 import（`from . import mod`）+ shadow 对显式回归探针，闭合 FR-004 字面要求（**主编排器裁定：本次交付内即补**，见 trace.md Phase 5 处置） |

## 过度实现检测

无范围外新增功能/公共 API/配置项。三处"tasks 未列的连带改动"经核实均为 FR-001/FR-008/FR-009 生效后的必然、机械性连带结果：

| 位置 | 描述 | 风险评估 |
|------|------|---------|
| `tests/unit/collector-surface.test.ts:767` | `surfaceMatchesFile(…,'stub.pyi')` 断言 false→true | 低——FR-001 生效必然连带，trace.md 如实记录 |
| `src/panoramic/graph/collector-fingerprint.test.ts:138-141` | `.not.toEqual` → `.not.toBe`（值等但引用独立） | 低——原断言语义被 FR-001 本身证伪，改写保住"分列保留管线身份"意图，与 FR-008 修订意图一致 |
| charter 快照 9 处 `.pyi` 插入 | 指纹字段快照同步 | 低——FR-009 指纹自动变化的既有资产同步，9 insertions/0 deletions，未触碰非指纹内容 |

## tasks.md T001-T011 完成度核对

全部 11 项勾选并经代码/测试交叉核实（T001 基座 3cdd89f、T002/T003 红探针、T004 常量、T005 护栏 A 落点、T006 signature 实测 `def mod_fn() -> int`、T007 helper 两处、T008 注释三处、T009 契约逐字段+负面清单零命中、T010 抽查相符、T011 vitest 6401/0+build 0+repo:check pass+freshness=dirty）。

## 结论

**PASS_WITH_NOTES**

- CRITICAL: 0
- WARNING: 1（FR-004 相对 import 场景探针缺口，主编排器裁定本次交付内补齐）
- INFO: 3（三处连带改动，均核实为必然结果）
