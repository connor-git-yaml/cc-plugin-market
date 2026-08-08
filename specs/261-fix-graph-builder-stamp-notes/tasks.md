# 任务清单 — F261 图产物 builder build stamp + implement 每 Phase 落 notes

**输入**：`fix-report.md`（5-Why 根因）、`plan.md`（八项决策已拍板，方案 A）
**模式**：fix（问题修复）。缺陷① = D1（图 builder stamp），缺陷② = D2（implement.md notes 约定）。
**格式**：`[ID] [P?] [D1/D2?] 描述 + 文件路径 + 验收判据`。`[P]` = 不同文件可并行；同文件任务不标 `[P]`，按列出顺序执行。
**红先行纪律**：Phase 1 全部任务 MUST 在对应 Phase 2/3 实现任务之前完成，且 MUST 先跑一次确认失败（红），把红的输出记入 `implementation-notes.md`。

---

## Phase 1：红先行测试（写测试，确认失败）

### D1 — builder-stamp 单元测试（同文件，按序执行，不可并行）

- [x] **T001** [D1] 新建 `src/panoramic/graph/builder-stamp.test.ts`，写入 **T-R1a**：临时目录构造 `<tmp>/dist/panoramic/graph/` + `<tmp>/dist/.spectra-build-meta.json`（含 `stampBuild` 真实 7 字段形态），断言 `resolveBuilderStamp('<tmp>/dist/panoramic/graph')` 返回对象且 `Object.keys(r).sort()` 精确等于 `['commit','dirty','distSha256','formatVersion','sourceDirty']`。
  **此时应失败**：`builder-stamp.ts` 模块不存在，import 报错 / 用例直接失败。

- [x] **T002** [D1] 同文件追加 **T-R1b**：零时间戳不变量——`'builtAtIso' in r === false` 且 `'note' in r === false`，即便 meta 里两者都存在。
  **此时应失败**：同 T001（模块不存在）。

- [x] **T003** [D1] 同文件追加 **T-R1c**（最关键反例）：构造 `<tmp>/src/panoramic/graph/` **且** `<tmp>/dist/.spectra-build-meta.json` 存在 → 断言 `resolveBuilderStamp('<tmp>/src/panoramic/graph')` 必须返回 `null`（只查祖先本身，不查 `<祖先>/dist`）。
  **此时应失败**：同 T001。

- [x] **T004** [D1] 同文件追加 **T-R1d**：有界性——meta 放在第 3 级祖先（超出 `MAX_ASCENT=2`）→ `null`；meta 畸形（非 JSON / `commit` 非 string / 缺 `distSha256`）→ `null` 且不抛异常。
  **此时应失败**：同 T001。

- [x] **T005** [D1] 同文件追加 **T-R1e**：深度不变量——`assertDistBuilt()` 后断言 `path.relative(<repo>/dist, path.dirname(<repo>/dist/panoramic/graph/builder-stamp.js)).split(path.sep).length === MAX_ASCENT`。
  **此时应失败**：同 T001（模块与其编译产物均不存在）。

### D1 — 写盘出口注入测试

- [x] **T006** [P] [D1] 新建 `src/panoramic/graph/graph-builder.test.ts`（当前不存在），写入 **T-R2**：直接调 `writeKnowledgeGraph(minimalGraph, tmpOutDir)` → 读回 JSON → 断言 `'builder' in parsed.graph === true`；vitest 跑 src 场景下值为 `null`（诚实降级）；并断言注入不影响既有 nodes 按 id 排序。
  **此时应失败**：`graph.graph` 无 `builder` 键，`in` 断言为 false。

### D1 — 消费面（graph-quality advisory）红测试

- [x] **T007** [P] [D1] 新建 `tests/unit/graph-quality-builder-advisory.test.ts`，写入 **T-R5a**：`describeBuilderStamp` 三态（一致 / 不一致 / unstamped）各产出预期文案；并循环 `ALL_STALE_REASONS` 断言三种文案都不含 `[source-commit]` / `[collector-fingerprint]` / `[collector-fingerprint-unrecorded]` / `[collector-fingerprint-invalid]` 四个方括号字面量。
  **此时应失败**：`describeBuilderStamp` 函数不存在，import 报错。

- [x] **T008** [P] [D1] 新建 `tests/integration/builder-stamp-e2e.test.ts`，写入 **T-R3**：`assertDistBuilt()` → 读 `dist/.spectra-build-meta.json` → 临时项目跑 `node dist/cli/index.js batch --mode graph-only` → 读产物 → 断言 `graph.graph.builder.commit === meta.commit` 且 `builder.distSha256 === meta.distSha256`；meta 不存在时（非 git 环境）断言 `builder === null`（不 skip）。
  **此时应失败**：产物无 `builder` 字段。

- [x] **T009** [D1] 在既有 `tests/integration/graph-quality-cli.test.ts` 追加 **T-R5b**：构造临时 git 仓 + 手写 graph.json（`graph.builder = {formatVersion:1, commit:'a'.repeat(40), dirty:false, sourceDirty:false, distSha256:'0'.repeat(64)}`，`sourceCommit=<真实 HEAD>`），text 模式下断言 stdout 含 `[builder]`、含 `aaaaaaa`、含"不一致"措辞。
  **此时应失败**：`formatReportText` 不产出 `[builder]` 行。

- [x] **T010** [D1] 同文件追加 **T-R5c**：同一份图在"有 builder"与"删掉 builder"两种输入下，`exitCode`、`report.overallVerdict`、`report.freshness.state` 逐字相同。
  **此时应失败**（若实现前占位断言先写好会因缺少 advisory 渲染逻辑导致其他相关断言失败；若该用例本身在无 builder 逻辑下已恒等，需与 T009 一并先跑确认整体套件在此改动前处于预期基线，避免误判为"已通过"）。

- [x] **T011** [D1] 同文件追加 **T-R5d**：两种输入的 `--json` 输出均过 `validateAgainstSchema` 且 `violations` 为空，证明未把 `builder` 泄进 `--json`。
  **此时应失败**：因 advisory 渲染逻辑尚未实现，测试文件本身可运行但用于确认改动前 `--json` 契约的基线通过状态；实现后必须继续保持为空。

### D1 — byte-stable 护栏红测试

- [x] **T012** [P] [D1] 在既有 `tests/batch/graph-only-pipeline.test.ts` 的 byte-stable describe 块追加 **T-R4a**：连跑两次后，除既有 Buffer 相等断言外，追加 `expect(second.graph.graph.builder).toEqual(first.graph.graph.builder)`。
  **此时应失败**：`builder` 字段不存在，`toEqual(undefined)` 会在实现后才具备真实校验意义；此步先确认用例可执行且当前处于 `undefined === undefined` 的空校验状态（记入 notes，说明该用例的红/绿判据在实现前后语义不同，需配合 T023 变异测试才能证明其真实守护力）。

### D2 — implement.md notes 约定红测试

- [x] **T013** [P] [D2] 新建 `tests/unit/spec-driver-implement-notes-contract.test.ts`，写入 **T-R6a**：读取 `plugins/spec-driver/agents/implement.md`，断言含 `implementation-notes.md` 字面量 + 四个必含字段名（`当前 Phase` / `已完成任务 ID` / `下一步` / `已知偏差`）。
  **此时应失败**：`implement.md` 当前无这些字面量。

- [x] **T014** [D2] 同文件追加 **T-R6b**（既有约束回归防线）：断言下列既有字面量仍然存在——`MUST 在声称任何任务完成之前`、`禁止的推测性表述`、`完成声明模板`、`严格按 tasks.md 执行`、`不修改 spec.md 或 plan.md`、`Layer 3: 失败路径验证`。
  **此时应通过**（这些字面量当前已存在，属于"防止未来改动误删"的常绿护栏，非本次红先行对象；先跑一次确认当前为绿，作为后续改动的回归基线）。

**Phase 1 checkpoint**：T001-T013 全部确认为预期的红/基线状态，红输出摘要写入 `{feature_dir}/implementation-notes.md`（首次创建，Phase 名记为 `Phase 1 / 共 4`），才可进入 Phase 2。

---

## Phase 2：缺陷① 实现（builder-stamp 模块 → 类型 → 写盘出口注入 → graph-quality 文本行）

- [x] **T015** [D1] 新建 `src/panoramic/graph/builder-stamp.ts`：实现 `GraphBuilderStamp` 接口（`formatVersion: 1` / `commit` / `dirty` / `sourceDirty` / `distSha256`，MUST NOT 含 `builtAtIso`/`note`/路径）、`parseGraphBuilderStamp(value: unknown): GraphBuilderStamp | null`（弱校验：必需 5 键存在 + 类型正确 + `formatVersion===1`，文件头注释写明与 F249 严格校验的差异理由）、`resolveBuilderStamp(startDir: string): GraphBuilderStamp | null`（`MAX_ASCENT=2`，只查祖先本身 3 层，命中第一个即定论不继续上溯，全程 try/catch 兜底不抛）、`getBuilderStamp(): GraphBuilderStamp | null`（以 `dirname(fileURLToPath(import.meta.url))` 为起点，进程内 memoize 含 null）。
  **依赖**：T001-T005 已确认红。**验收**：T001-T005 转绿。

- [x] **T016** [D1] 修改 `src/panoramic/graph/graph-types.ts`：`GraphJSON['graph']` 追加可选字段 `builder?: GraphBuilderStamp | null`（含文档注释：三态语义、不 bump schemaVersion 的理由）；导入 `GraphBuilderStamp` 类型。
  **验收**：类型编译通过，无破坏性变更（其余 9 个既有字段不动）。

- [x] **T017** [D1] 修改 `src/panoramic/graph/graph-builder.ts` 的 `writeKnowledgeGraph`：在 ① `scanGraphPortabilityViolations` 之后、② `normalizeGraphForWrite` 之前插入 `graph.graph.builder = getBuilderStamp()`；四条写盘链路（`graph-assembly.ts` / `batch-orchestrator.ts` / `cli/commands/graph.ts` / `cli/commands/community.ts`）均不改代码。
  **依赖**：T015、T016。**验收**：T006（T-R2）转绿。

- [x] **T018** [D1] 检查 `src/panoramic/graph/index.ts` barrel 导出：若该文件对外导出本目录的类型/函数，追加 `GraphBuilderStamp` 类型与 `getBuilderStamp`/`parseGraphBuilderStamp`（视既有导出粒度决定是否需要，若既有 barrel 未导出同类模块如 `source-commit.ts` 的对应符号，则保持一致不导出，只在文件头注明核实结论）。
  **验收**：`npm run build` 通过，无未使用/缺失导出报错。

- [x] **T019** [D1] 修改 `src/cli/commands/graph-quality.ts`：新增纯函数 `describeBuilderStamp(graph): string`（三态文案：一致 / 不一致 / unstamped，措辞遵守 §7.3 禁令，`sourceCommit` 写成 `sourceCommit=<7位sha>` 不带方括号），在 `formatReportText` 的 `[freshness]` 行之后追加一行 `[builder] ...`；**不改** `--json`、`--status`、schema、exit code、`overallVerdict`、freshness 四态。
  **依赖**：T007。**验收**：T007（T-R5a）转绿；T008、T009、T010、T011（T-R3、T-R5b/c/d）转绿。

- [x] **T020** [D1] 运行 `npx vitest run src/panoramic/graph/builder-stamp.test.ts src/panoramic/graph/graph-builder.test.ts tests/unit/graph-quality-builder-advisory.test.ts tests/integration/builder-stamp-e2e.test.ts tests/integration/graph-quality-cli.test.ts`，确认 T001-T011 全部转绿；将结果摘要追加进 `implementation-notes.md`。

- [x] **T021** [D1] **变异测试护栏（T-R4b，实施期一次性执行，不入库）**：临时在 `builder-stamp.ts` 把 `builtAtIso` 加回返回对象 → 重跑 `tests/batch/graph-only-pipeline.test.ts:180`（逐字节相等断言）与 `tests/e2e/feature-180-batch-repro.e2e.test.ts` T-010-4 → 断言两者**必须变红**（证明 byte-stable 护栏对本字段确有守护力，T012/T-R4a 非空转）→ 确认变红后**撤回**该临时改动 → 重跑确认全部恢复绿。将"变红/撤回/恢复绿"三段结论逐字记入 `implementation-notes.md`。
  **依赖**：T015、T017、T012。**验收**：变异态必红，撤回后必绿；`git diff` 确认无变异代码残留。

**Phase 2 checkpoint**：`npx vitest run`（限定 D1 相关测试路径）全绿，`implementation-notes.md` 更新为 `Phase 2 / 共 4`，记录 T-R4b 结论后才可进入 Phase 3。

---

## Phase 3：缺陷② 实现（implement.md + repo:sync 重生 + 连带产物提交面）

- [x] **T022** [D2] 修改 `plugins/spec-driver/agents/implement.md`：仅在第 5 节「进度追踪」末尾追加子节「Phase 级进度落盘（默认约定）」（plan.md §8.1 给出的完整文案：四项必含字段——当前 Phase / 已完成任务 ID / 下一步 / 已知偏差；覆盖写入 `{feature_dir}/implementation-notes.md`）。**MUST NOT** 改动其余 7 节任何一字，**MUST NOT** 削弱委派硬约束 / F208 依从性判定 / goal_loop 接线 / 三层验证 / 改动后一致性自检。
  **依赖**：T013、T014 已确认红/基线。**验收**：T013（T-R6a）转绿，T014（T-R6b）保持绿（既有字面量未被误删）。

- [x] **T023** [D2] 运行 `npx vitest run tests/unit/spec-driver-implement-notes-contract.test.ts`，确认 T013/T014 全绿；结果摘要追加进 `implementation-notes.md`。

- [x] **T024** [D2] 运行 `npm run repo:sync`，重生派生产物；执行后立即 `git status --porcelain` 记录完整产出文件清单（**不预设**是否会新建 `plugins/spec-driver/skills-codex/` 与 `.codex/skills/` 镜像副本，以实跑输出为准），清单写入 `implementation-notes.md`。

- [x] **T025** [D2] 按 T024 产出的实际文件清单复核并暂存改动（`git add` 精确路径，不用 `git add -A`）；若清单包含 `skills-codex/` 或 `.codex/skills/` 侧文件，逐一核实是否触及 F186 wrapper body-sha256 门禁 / F238 model-literal 门禁的判据面（应为无关的文本重生，不改门禁判据本身）。

- [x] **T026** [D2] 运行 `npm run repo:check`，确认零失败（对应 **T-R6c**）。

**Phase 3 checkpoint**：`implementation-notes.md` 更新为 `Phase 3 / 共 4`，记录 repo:sync 产出清单与 repo:check 结果后才可进入 Phase 4。

---

## Phase 4：全量验证

- [x] **T027** 运行 `npx vitest run`，确认零失败（覆盖全部红先行用例 + 既有回归护栏，含 `tests/integration/spec-drift-repo-check-regression.test.ts` 用于确认 repo:check check id 清单仍精确为 7 项、`tests/unit/contracts/graph-quality-report-schema.test.ts` 用于确认 `--json` 顶层未新增字段）。

- [x] **T028** 运行 `npm run build`，确认零类型错误。

- [x] **T029** 运行 `npm run test:plugins`，确认零失败（覆盖插件侧 `.mjs` 测试，含 repo:sync 产出的派生资产）。

- [x] **T030** 运行 `npm run repo:check`，确认零失败（二次确认，覆盖 Phase 3 之后若有新改动）。

- [x] **T031** 运行 `npm run release:check`，确认零失败（本次不涉及 release contract 字段，预期无需改动即通过；若报错需排查是否误触发布相关字段变更）。

- [x] **T032** **手工验证——连跑两次 graph-only 比对 builder 字段 byte 相等**：确认 `dist/` 已 `npm run build` 后，连续两次执行 `node dist/cli/index.js batch --mode graph-only`（同一 dist、不 rebuild），对比两次产出 `specs/_meta/graph.json` 的 `graph.graph.builder`，确认逐字段相等（`commit`/`dirty`/`sourceDirty`/`distSha256`/`formatVersion` 完全一致），且整份 `graph.graph` 通过既有 byte-stable Buffer 比对；将两次产出的 `builder` 值与比对结论记入 `implementation-notes.md`。

- [x] **T033** 最终更新 `implementation-notes.md` 为收尾状态：`当前 Phase` 记为 `Phase 4 / 共 4（已完成）`，`已完成任务 ID` 列全部 T001-T033，`下一步` 记为"等待对抗复审 + 提交"，`已知偏差` 逐项核对 plan.md §12"明确不做的事"清单，确认无遗漏或显式记录理由。

- [ ] **T034** 对抗复审：按 CLAUDE.local.md 暂停期档位（Codex 配额耗尽）执行——本次改动 advisory-only、不改 exit code、不新增 repo:check check，**不属于**门禁/判定器类，走"一般生产代码"档位：主线程自审 + 1 个独立子代理对抗复审（`general-purpose`，prompt 用"假设有问题、尝试证伪"），产出 critical/warning/info 三档结论，critical/warning 项在提交前修复。

**Phase 4 checkpoint**：T027-T031 五项命令全部零失败，T032 手工验证 byte 相等，T033 notes 收尾，T034 对抗复审结论已处置，方可提交。

---

## 依赖关系速览

- Phase 1（红先行）→ Phase 2（D1 实现）：T001-T012 必须先确认红/基线状态，才能开始 T015-T021。
- Phase 1（红先行）→ Phase 3（D2 实现）：T013-T014 必须先确认红/基线状态，才能开始 T022。
- Phase 2 与 Phase 3 技术上正交（D1/D2 无交叉文件），可并行推进；但为保证 `implementation-notes.md` 的 Phase 序列清晰，建议按 Phase 2 → Phase 3 顺序单线执行。
- Phase 4 依赖 Phase 2、Phase 3 均已 checkpoint 通过。
- 同文件任务（如 T001-T005、T009-T011、T013-T014）必须按列出顺序串行，不可并行；不同文件的 `[P]` 任务（T006、T007、T008、T012、T013）可并行开工。

## 护栏任务追溯表（plan.md 强制项 ↔ task ID）

| 护栏要求 | Task ID |
|---|---|
| 变异测试：加回 `builtAtIso` 验证 byte-stable 用例变红，再撤回 | T021 |
| graph-quality 文案 MUST NOT 含四个 stale reason 方括号字面量 | T007（断言）+ T019（实现遵守） |
| `--json` 输出 MUST NOT 新增顶层字段 | T011（断言）+ T027（schema 契约测试复核） |
| repo:check 检查项 MUST NOT 新增（精确钉死 7 项） | T027（spec-drift-repo-check-regression 复核） |
| implement.md 改动 additive，不削弱既有硬约束 | T014（断言）+ T022（实现自检）|
