# F217 图质量门机器化 — 独立验证报告

**验证对象**: HEAD = `0f72d4a`（`feat(F217): 图质量门机器化 — graph-quality CLI + 六指标门禁 + 四语言回归矩阵`）
**验证方式**: 独立子代理全部命令实跑，未引用 implement 子代理的任何达标声明
**验证时间**: 2026-07-20（工作树状态：clean，`git status --porcelain` 为空）

## 执行摘要

**总体判定：READY-FOR-GATE（无阻塞项）**

四道门全绿（build/vitest/repo:check/release:check 均 exit 0），spec.md 14 条 Success Criteria 逐条实跑核验通过，CONSTRAINT-002~005 全部满足。`repo:check` 中 `graph-quality:freshness` 子检查报 `warn`（本仓库图产物未在本次 commit 后重建，`sourceCommit` 落后于当前 HEAD）——这是**预期的、按 spec 设计的行为**（FR-010/FR-019 stale 态本就应为 warning 而非 error），不构成阻塞。

---

## 四门全量验证

| 门禁 | 命令 | 实测 exit code | 关键输出 |
|------|------|---------------|---------|
| 1. 构建 | `npm run build` | **0** | `tsc` 零错误；postbuild 盖章 commit=0f72d4a5 |
| 2. 全量测试 | `npx vitest run` | **0**（复跑两次均 0） | 461 test files passed / 4 skipped；5397 tests passed / 18 skipped / 21 todo；**0 failed**，未触发已知 flaky 清单中的任何隔离重跑场景（本次全绿，无需隔离） |
| 3. repo 自检 | `npm run repo:check` | **0** | status=**warn**（非 fail）；80 项子检查中仅 `graph-quality:freshness` 为 warn，其余 79 项含 `graph-quality:duplicate-canonical-id`/`dangling-edge`/`contains-coverage`/`orphan-ratio`/`legacy-ignored-nodes` 五项全 **pass** |
| 4. 发布契约 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

**说明**：`repo:check` warn 内容为：
```
[graph-quality] 图产物记录的 sourceCommit（1445edff9efd3f308c5abb53d75f0c89cd590473）与当前 HEAD（0f72d4a5cd402bd3d2a31b583ee70e57f469832c）不一致（commit 级 stale），请重新建图。
```
这是本仓库自身图产物（`specs/_meta/graph.json`）尚未在 F217 落地 commit 之后重新建图导致，属 spec 明确设计的 `stale`→warning 语义（FR-010/FR-019），**不是代码缺陷**。

---

## SC-001~SC-014 逐条核验

| SC | 验证方式 | 实测结果 | 判定 |
|----|---------|---------|------|
| SC-001 | 本仓库自身 graph-only 产物实跑 `node dist/cli/index.js graph-quality --json` | 六指标 `duplicateCanonicalId/containsCoverage/orphanRatio/danglingEdges/legacyAndIgnoredNodes` 全 `pass`（5016 symbol 节点，contains 覆盖率 100%，全节点 zero-degree 率 1.84%）；`freshness=stale`（如实反映未重建）；`overallVerdict=pass-with-warnings`；exit 0 | ✅ PASS |
| SC-002 | `npx vitest run tests/integration/graph-quality-lang-matrix.test.ts` 全跑 + 手工抽验 Java fixture | 8/8 通过，exit 0；手工用 `node -e` 直接重新解析 `graph-quality-java-graph/graph.json`，独立复算得 nodes=18、links=13、symbolNodes=13，与测试断言值和 README 手推值完全一致 | ✅ PASS |
| SC-003（重复 canonical ID） | `npx vitest run tests/integration/graph-quality-adversarial.test.ts`（19/19 通过）+ 手工单独跑 `duplicate-canonical-id.json` | CLI 手跑：exit **1**，`overallVerdict=fail-strong-invariant`，精确列出三元组 `{filePath:"src/a.ts", symbolName:"Foo", kind:"component"}` 与冲突 ID `["src/a.ts#Foo","src/a.ts::Foo"]` | ✅ PASS |
| SC-004（悬空边） | 手工单独跑 `dangling-edge.json` | exit **1**，`overallVerdict=fail-strong-invariant`，精确报告 `{source:"src/a.ts::Foo", target:"src/missing.ts::Bar", relation:"calls"}` | ✅ PASS |
| SC-005（ignored 路径节点） | 随 adversarial 套件跑通（`ignored-path-node.json` 为其中一个 fixture，19 项全过） | 未逐一手工复验此项（已通过整体套件 19/19 及两项抽验代表性验证，抽验规则要求 2 个，已满足） | ✅ PASS（套件覆盖，未单独手跑） |
| SC-006（遗留 `#` 节点） | 同上（`legacy-hash-node.json` 为其中一个 fixture） | 同上，套件覆盖 | ✅ PASS（套件覆盖，未单独手跑） |
| SC-007（commit stale） | adversarial 套件 `stale-commit.json` + SC-010 独立复验（见下） | 套件通过 + 手工复验一致 | ✅ PASS |
| SC-008（contains 覆盖率坍塌） | adversarial 套件 `coverage-gap.json` | 套件通过（19/19） | ✅ PASS（套件覆盖） |
| SC-009（orphan 超标） | adversarial 套件 `orphan-excess.json`（另含 `entrypoint-orphan.json`/`pure-type-orphan.json`/`test-export-orphan.json` 三个豁免分类 fixture） | 套件通过（19/19） | ✅ PASS（套件覆盖） |
| SC-010（HEAD 前进后 stale） | **独立手工搭建**：`mktemp` 临时 git 仓库 → init+commit（记录 sourceCommit）→ 再 commit 推进 HEAD → 手工构造 GraphJSON（含正确 `graph.schemaVersion`/`graph.sourceCommit` 字段）→ 跑本仓库 `dist/cli/index.js graph-quality --json` | 首次尝试因手工 fixture 缺 `graph.schemaVersion` 字段导致 `cannot-assess`（exit 2，"图产物损坏"），排查后确认是本次验证脚本自身 fixture 结构错误（非产品 bug），修正字段路径后重跑：`freshness.state="stale"`，`recordedSourceCommit`≠`currentHead`，exit **0**，`overallVerdict=pass-with-warnings` | ✅ PASS |
| SC-011（next-step 建议） | 抽验 dangling-edge 与 SC-010 手工产物的 `nextSteps` 字段 | 均非空数组，含面向维护者的具体修复建议文本（如"请检查边生成逻辑是否引用了已被剔除的节点 id"） | ✅ PASS |
| SC-012（repo:check 三态） | `npx vitest run tests/unit/graph-quality-core.test.ts`（10/10 通过，含 4 个场景：图缺失 skip / JSON 解析失败 warning / schemaVersion 过旧 cannot-assess→warning / 强不变量→error / 非强指标→warning / dirty 不告警 / stale 告警） | 全通过，exit 0 | ✅ PASS |
| SC-013（TDD + 四门） | 见上方"四门全量验证"表格 | 四门全绿；测试先行开发过程未独立复核（属实现阶段过程性要求，非可事后验证的产物状态），仅能确认交付时刻四门状态达标 | ✅ PASS（四门达标部分已验证；TDD 过程本身按诚实原则标注"未实跑复核，仅信过程声明"） |
| SC-014（dirty 态） | `npx vitest run tests/integration/graph-quality-cli.test.ts`（17/17 通过，含"dirty 态验证（SC-014 前半）"专项用例：sourceCommit 与 HEAD 一致但工作树有未提交改动 → dirty 提示 exit 0；"SC-010 独立复验"用例：真实 `batch --mode graph-only` 建图后再提交一次 → stale） | 通过 | ✅ PASS |

**关于 SC-005/006/008/009 未逐一手工复验的诚实说明**：任务要求"随机抽 2 个对抗 fixture 手动跑 CLI"，本次已对 `dangling-edge.json`（SC-004）与 `duplicate-canonical-id.json`（SC-003）完成手工 CLI 抽验（满足数量要求），其余 5 个对抗 fixture（ignored-path-node / legacy-hash-node / coverage-gap / orphan-excess 及三个豁免分类 fixture）依赖 `graph-quality-adversarial.test.ts` 套件的 19/19 全绿覆盖，未逐一单独手跑 CLI 复核。

---

## CONSTRAINT 抽验

| CONSTRAINT | 验证方式 | 实测结果 | 判定 |
|-----------|---------|---------|------|
| CONSTRAINT-002（byte-stable，fixture sourceCommit 恒 null） | `node -e` 直接读取四份 pinned fixture 的 `graph.sourceCommit` 字段 | `tests/fixtures/micrograd-baseline-graph/graph.json`、`graph-quality-ts-graph`、`graph-quality-java-graph`、`graph-quality-go-graph` 四份均为 `"sourceCommit": null`（grep 确认字段字面值，非 JS 层 undefined→null 推断） | ✅ PASS |
| CONSTRAINT-003（不改 zod schema） | `git diff 39e4055..0f72d4a -- src/knowledge-graph/unified-graph.ts` | 输出 0 行（无 diff） | ✅ PASS |
| CONSTRAINT-004（不碰 plugins/spec-driver/） | `git diff 39e4055..0f72d4a -- plugins/spec-driver/` | 输出 0 行（无 diff） | ✅ PASS |
| CONSTRAINT-005（不新增 MCP 工具） | `git diff 39e4055..0f72d4a -- src/mcp/` | 输出 0 行（无 diff） | ✅ PASS |

---

## 附带发现（non-blocker）

1. **git 二进制误判（非缺陷，已排查确认）**：`git diff --stat` 中 `src/panoramic/graph/quality/duplicate-id-check.ts` 与 `src/panoramic/graph/source-commit.ts` 显示为 `Bin 0 -> N bytes`（git 认为是二进制文件）。经排查，原因是源码中使用了 `\x00`（NUL 字节）作为字符串模板字面量的分隔符（`${filePath}\x00${symbolName}\x00${kind}` 形式的复合 key，用于避免三元组字段间发生歧义拼接），触发了 git 的二进制启发式判定。文件本身是合法 UTF-8 文本，`tsc` 编译与 `vitest` 测试均正常通过，**不是文件损坏或编码问题**，仅为 git diff 展示层面的误判，不影响功能。建议后续若需人工 code review 该文件的 diff，需用 `git diff --text` 或直接 Read 工具查看，避免误以为文件被截断。

2. **本仓库自身图产物 stale**：如四门表格与 SC-001 所述，`specs/_meta/graph.json` 的 `sourceCommit` 落后于 F217 落地 commit，这是预期状态（尚未在 F217 之后重新建图），非代码缺陷，`repo:check` 按设计仅产生 warning 不阻断。若需要图产物追平最新 HEAD，可另行运行 `spectra batch --mode graph-only` 重建（不属本次验证阻塞项，纯运维动作）。

---

## 结论

**READY-FOR-GATE**：四道门全绿、14 条 Success Criteria 逐条核验通过（其中 SC-005/006/008/009 依赖套件整体绿而非逐一手工复核，已在报告中如实标注）、CONSTRAINT-002~005 全部满足、未发现任何 blocker 级问题。上述"附带发现"均为 non-blocker 性质的排查记录，不影响交付判定。
