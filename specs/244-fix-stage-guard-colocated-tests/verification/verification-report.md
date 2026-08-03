# 验证报告 — F244 F220 stage 依赖矩阵守护对共置测试的结构性误报（终态版）

**模式**: fix（完整路径：首轮实现 → Codex 对抗审查轮 → 重验裁断收尾 → 本次独立终态复核）
**验证时间**: 2026-08-03（终态复核，覆盖首轮 2026-08-03 轻量版）
**改动范围**: `tests/unit/batch/f220-export-surface.test.ts`（唯一代码改动文件，`git diff HEAD` 实测 +186/-31 行）+ `specs/220-batch-orchestrator-decomposition/refactor-plan.md`（§4.2 一行 F244 增补注记，+2 行）

## 三轮演化摘要

| 轮次 | 动作 | 结论 |
|------|------|------|
| 首轮实现 | T001-T011：收窄 `listStageFilesRecursive` 排除共置测试 + 提取 `collectStageViolations` 纯函数 + 新增绿/红①/红②三用例 + T008 手动红/绿双向核对 + 全量/构建验证 | 目标文件 7/7 通过，全量 `npx vitest run` 零失败，`npm run build` 零错误 |
| Codex 对抗审查轮 | 0 CRITICAL / 2 WARNING（W1：共置测试豁免可被生产文件反向 import 利用，拖入编译闭包与 dist 产物；W2：`.spec.ts` 豁免范围与仓库当前实际执行面/注释表述有出入） | W1 **已修**：新增 `collectTestNamedImportViolations` 合同函数 + F220 真实源码树回归 it + 红③/红④两个 fixture 用例；W2 **部分采纳**：保留双后缀豁免（理由：安全性已由 W1 新合同兜底），修正注释表述，绿用例补 `.spec.ts` fixture 断言 |
| 重验裁断收尾 | T012 落地 W1/W2 处置增量；4a spec-review 制品回填（0C/2W，已补）；4b quality-review（0C/0W，GOOD） | 用例数由首轮 7 个扩至 10 个（F220 describe 5 个 + F244 describe 5 个：绿 + 红①②③④） |
| **本轮（终态独立复核）** | 独立重跑目标文件测试、build、目录级抽查测试；独立复现 T008 红/绿双向验证（临时还原收窄前逻辑→绿用例先失败→恢复→10/10 转绿）；残留扫描 + 文档一致性核查 | 全部通过，详见下方 Layer 逐项记录 |

## Layer 1: Spec-Code 对齐

- fix-report.md 根因（Root Cause Reached at Why 5）：`listStageFilesRecursive` 未排除共置测试文件，判定逻辑内联不可测，且守护自身无法用 fixture 独立驱动红/绿回归。
- tasks.md：**12/12** 任务全部勾选（T001-T012，含审查轮增量 T012），覆盖率 100%。
- 覆盖率：100%（1/1 修复点已实现：收窄收集器 + 提取纯函数 + 新增红/绿回归 + W1/W2 审查轮增量处置）。

## Layer 1.5: 验证证据核查

- **状态**: COMPLIANT
- 本轮独立复核实际执行的命令（非引用性描述，均含真实输出）：
  - `npx vitest run tests/unit/batch/f220-export-surface.test.ts` → **10/10 通过**（1.24s，见下方 Layer 2）
  - `npm run build` → `tsc` 零错误退出（`[postbuild:stamp] 盖章: commit=264338be (dirty)`）
  - `npx vitest run tests/unit/batch/`（目录级抽查）→ 4 files / **40 tests** 全过（较首轮报告的 37 增加 3 个，因 T012 审查轮新增 1 个真实源码树 it + 2 个 fixture 用例）
  - 红/绿双向验证独立复现（见下节，非引用首轮记录）
- 未检测到"should pass"/"looks correct"等推测性表述。

## Layer 1.75: 深度检查

- **调用链完整性**: `collectStageViolations`、`collectTestNamedImportViolations` 均为纯函数、无外部依赖注入断链风险；三处调用点（导出面用例 L192、依赖矩阵 it 块 L230-231、生产文件测试命名导入 it 块 L237-238）均实测使用收窄后的 `listStageFilesRecursive`。
- **逐行核对**：读取 `tests/unit/batch/f220-export-surface.test.ts` 全文（325 行），确认：
  - `COLOCATED_TEST_RE = /\.(test|spec)\.ts$/`（L63）与 plan.md 记录的"实施时收敛为不含 `.mts` 分支"一致，注释（L58-62）已说明死分支处置理由
  - `collectStageViolations`（L109-144）与 `collectTestNamedImportViolations`（L157-179）两个纯函数职责边界清晰：前者判"stage 间/facade 依赖边"，后者判"生产文件反向 import 测试命名模块"，互不重叠、互为补充
  - W1 修复实质核查：`collectTestNamedImportViolations` 同时覆盖相对路径（`resolveSpecifier` 归一化后缀匹配，L169-172）与非相对路径（裸包名/别名字面量后缀匹配，L173-175）两类 specifier，红③（facade 经 `./stages/evil.spec.js` 反向拉测试图）、红④（`../shared/helper.test.js` 落在 stages 目录外的第二盲区）分别验证两条判定路径均可达
  - 检测侧 `/i` 大小写不敏感 vs 豁免侧 `COLOCATED_TEST_RE` 大小写敏感的不对称设计（L159-160 注释已说明：保护面扩大 vs 保守 fail-closed），逻辑自洽
- **facade 短路风险复核**：红②用例 `spec = '../facade.js'` 以 `.` 开头进入相对路径分支，不会被"非相对路径裸包名放行"分支短路，`resolved === facadeResolved` 字符串比对成立——本轮已通过独立重跑验证命中 `"a.ts: import facade"` 前缀断言。
- 无数据持久化 / 配置贯穿相关改动（纯测试逻辑收窄 + 审查轮合同函数新增）。

## Layer 1.8: 残留扫描

- 全仓 `grep -rn "listStageFilesRecursive\|STAGES_DIR\|collectStageViolations\|collectTestNamedImportViolations"`（排除 node_modules）仅命中：
  - `tests/unit/batch/f220-export-surface.test.ts`（唯一实现文件，符合预期）
  - `specs/244-fix-stage-guard-colocated-tests/{fix-report,plan,tasks}.md`（设计文档记录，符合预期）
  - 无其他生产代码 / 其他测试文件 / 文档存在残留引用或过期表述，与 fix-report.md「全仓 grep 仅此一个文件命中」结论一致。
- T008 手动红/绿双向验证性质核查：`git diff --stat` 显示唯一改动文件行数变化（+186/-31）与预期一致，工作树内无还原调试代码或临时分支残留。本轮独立复现同等操作（见下节），复现完成后 `git diff --stat` 再次核对与操作前完全一致，确认无残留。

## Layer 1.9: 文档一致性

- 本次改动不涉及公共接口变更、无新增/删除模块（所有函数均为测试文件内私有函数，未导出）。
- 唯一架构文档触达：`specs/220-batch-orchestrator-decomposition/refactor-plan.md` §4.2 追加一行 F244 增补注记（`git diff` 实测 +2 行），准确概述本次修复（收窄共置测试豁免 + 新增第 4 条合同）并指向 fix-report.md，无过期表述或遗漏更新。
- fix-report.md 明确「无需更新 spec」「文档：无需更新」，核查符合（本 feature 无独立 spec.md，走 fix 模式标准链路）。

## Layer 2: 原生工具链验证（本轮独立执行）

| 检查项 | 命令 | 结果 |
|--------|------|------|
| 目标文件测试 | `npx vitest run tests/unit/batch/f220-export-surface.test.ts` | ✅ PASS（**10/10**，1.24s：F220 describe 5 个 + F244 describe 5 个） |
| 构建 | `npm run build` | ✅ PASS（`tsc` 零错误，postbuild 盖章成功） |
| 目录级抽查 | `npx vitest run tests/unit/batch/` | ✅ PASS（4 files / **40 tests** 全过，5.09s） |

**红/绿双向验证证据（本轮独立复现，非引用首轮记录）**：

1. 备份当前实现（`cp` 到 `/tmp`），将 `listStageFilesRecursive` 收集条件临时还原为收窄前的全收集逻辑（去掉 `&& !COLOCATED_TEST_RE.test(entry.name)` 条件）
2. 重跑 `npx vitest run tests/unit/batch/f220-export-surface.test.ts`：
   - **绿用例先失败**（复现 F243 遇到的误报场景）：`AssertionError: expected [ …(3) ] to not include '/var/folders/.../a.test.ts'` —— 证实收窄前逻辑确实会把共置测试文件混入 stage 文件收集结果
   - 其余 9 个用例（含红①②③④）仍通过，符合预期（红用例本就不依赖收窄逻辑，测的是矩阵外边/facade/测试命名反向导入的拦截行为）
   - 结果：1 failed / 9 passed
3. 恢复原实现（从备份还原），重跑确认转绿：**10/10 全部通过**
4. `git diff --stat` 复现操作前后一致（`tests/unit/batch/f220-export-surface.test.ts | 217 ++++++++++++++++++---`），确认无残留改动

**结论**：红/绿双向验证真实覆盖问题场景（而非只测放行侧）——修复前误报可复现，修复后确认解除，且拦截行为（红①②③④）在收窄逻辑存在与否两种状态下均保持一致（因红用例本身不依赖 `COLOCATED_TEST_RE` 收窄条件）。

注：本轮为 fix 完整路径终态复核，implement 阶段已在首轮 + 审查轮跑过全量 `npx vitest run`（491 files / 6104+ tests 零失败）；本轮按终态验证要求聚焦目标文件 + build + 目录级抽查 + 独立红/绿双向复现，不重复全量跑批。

## [Spec 合规]

**结论: PASS**

- 修复与 fix-report.md 根因（Why 5：判定逻辑内联不可测 + 收集器"目录=生产集合"假设破裂）完全一致：收窄 `listStageFilesRecursive` 排除 `*.test.ts`/`*.spec.ts`，提取 `collectStageViolations` 纯函数供 fixture 驱动，新增红/绿双向回归。
- Codex 对抗审查轮发现的 W1（生产 ESM 图逃逸面）已完整闭合：新增 `collectTestNamedImportViolations` 合同函数 + 真实源码树回归 it + 红③/红④两个 fixture 用例，覆盖"facade 反向 import 测试命名文件"与"测试命名 specifier 解析落在 stages 目录外"两个盲区。
- W2（`.spec.ts` 豁免范围）处置合理：保留双后缀豁免但已有 W1 合同兜底安全性，注释表述已修正，不构成遗留风险。
- 未引入 fix-report 未覆盖的行为变化：`ALLOWED_STAGE_EDGES` 矩阵语义未改，真实 stages/ 目录的既有 it 块断言保持不变（`toEqual([])`）。
- 未引入 spec 未定义的公共 API — 所有新增/改动函数均为测试文件内私有函数（未导出），不产生新的公共行为面。
- 无需同步更新 spec.md（本 feature 为 fix 模式，无独立 spec.md，fix-report.md 已明确记录本判断），架构文档（refactor-plan.md）已同步一条准确的增补注记。

## [代码质量]

**结论: PASS**

- 改动最小且聚焦：代码层面唯一改动文件 `tests/unit/batch/f220-export-surface.test.ts`（+186/-31 行，含首轮实现 + 审查轮增量），无越界改动生产代码（`src/batch/stages/**` 未触及）；文档层面仅追加一行架构注记。
- 命名与风格与周边代码一致：中文注释、命名沿用既有惯例（`STAGES_DIR`/`FACADE_PATH` 风格延续到 `stagesDir`/`facadePath` 形参）；检测侧 `/i` 与豁免侧大小写敏感的不对称设计有明确注释说明理由，非疏漏。
- 无遗留调试代码/死代码：`.mts` 死分支已在收窄时识别并加注释说明不可达原因；T008 类临时还原为一次性验证步骤，本轮独立复现后确认 `git diff --stat` 与操作前完全一致，无还原痕迹残留。
- 测试覆盖完整：F220 describe 5 个用例（原 3 个 + 依赖矩阵改写后 1 个 + 审查轮新增测试命名导入合同 1 个）+ F244 describe 5 个用例（绿 1 + 红①②③④）共 10 个，红/绿双向断言齐全，双盲区（收窄豁免的正向利用 + 反向利用）均有回归锁定。
- 安全隐患核查：`mkdtempSync(join(tmpdir(), 'f243-stage-guard-'))` 生成隔离临时目录，`afterEach` 保证每用例结束后 `rmSync(tmpDir, { recursive: true, force: true })` 清理，无路径逃逸；无构建阻断。
- 跨模块一致性：真实 stages/ 目录的既有依赖矩阵 it 块语义保持不变（仅内部改为调用提取后的函数），本轮实测通过；`resolved.startsWith(stagesDir)` 路径前缀碰撞（同级 `stages-other/` 误判）为 HEAD 预存实现，本次未扩大其判定面，已在 fix-report.md 记录为已知风险留待后续处理，属合理的范围界定。

## 总体结果: ✅ READY FOR REVIEW

- Spec 合规：PASS
- 代码质量：PASS
- 验证铁律合规：COMPLIANT
- 无 CRITICAL / WARNING 项（首轮 Codex 审查的 2 WARNING 均已处置：W1 已修，W2 部分采纳且理由充分）
