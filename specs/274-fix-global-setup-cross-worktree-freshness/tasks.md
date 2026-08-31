---
feature: 274-fix-global-setup-cross-worktree-freshness
mode: fix
phase: tasks
status: draft
based_on: ./plan.md（方案 A：sidecar 绑定 dist 内容指纹 + 按 PROJECT_ROOT 分键）
---

# 任务列表 — global-setup 跨 worktree 假新鲜盲区收口

> Feature 274 · fix 模式 · 基于 `plan.md` 的文件级变更清单（改动 1-6 + 新增测试文件）。全部改动限于 `tests/global-setup.ts` 单文件 + 1 个新测试文件，无 User Story 拆分，任务按依赖顺序线性排列。

**输入**：`plan.md`（required）、`fix-report.md`（required）
**产出**：`tests/global-setup.ts`（修改）、`tests/integration/global-setup-cross-worktree-freshness.test.ts`（新增）

## Format: `[ID] [P?] Description`

- **[P]**：可并行（不同文件、无依赖）；本次修复改动高度集中于单文件内部顺序依赖，[P] 标记较少
- 每个任务附文件路径 + 验收标准（AC）

---

## Phase 1: Schema 与路径分键基础设施

**目的**：先落地 v2 schema 类型定义与 PROJECT_ROOT 分键路径推导，作为后续 dist 绑定校验的前置依赖

- [ ] **T001** 在 `tests/global-setup.ts` 导入 `hashDistTree`（从 `../scripts/lib/spectra-version-gate.mjs`），新增 `DIST_DIR` 常量（`join(PROJECT_ROOT, 'dist')`）
  **验收标准**：`import { BUILD_INPUT_PATHS, BUILD_META_NAME, hashDistTree } from '../scripts/lib/spectra-version-gate.mjs';` 编译通过（`npm run build` 无类型错误）；`hashDistTree` 未被重新实现，确认为直接复用既有导出

- [ ] **T002** 新增 `deriveSidecarPath(projectRoot: string): string` 纯函数（按 `sha256(projectRoot).slice(0, 12)` 生成 keyed 文件名 `test-build-inputs-<key>.json`），`TEST_INPUTS_SIDECAR` 常量改为 `deriveSidecarPath(PROJECT_ROOT)`，新增 `LEGACY_SHARED_SIDECAR` 常量指向旧固定文件名 `test-build-inputs.json`（依赖 T001）
  **验收标准**：`deriveSidecarPath('/a')` 与 `deriveSidecarPath('/b')` 返回不同路径；`TEST_INPUTS_SIDECAR` 不再是固定字符串常量而是函数调用结果；`sha256Hex` 复用本文件已有实现，未新增第二套哈希函数

- [ ] **T003** `TestInputsSidecar` interface 升级：`schemaVersion: 1` → `schemaVersion: 2`，新增 `distSha256: string` 字段（依赖 T002）
  **验收标准**：接口定义与 plan.md 改动 4 逐字节一致；`npm run build` 类型检查通过

**Checkpoint**：Schema 与路径基础设施就绪，可开始改造读写函数与判定逻辑

---

## Phase 2: 核心判定逻辑改造

**目的**：实现 dist 内容指纹计算、sidecar 读写改造、`isDistFresh` 第四重绑定校验——这是本次修复的核心行为变更

- [ ] **T004** 新增 `computeDistFingerprint(distDir: string = DIST_DIR): string | null` 导出函数，内部调用 `hashDistTree(distDir).sha256`，try/catch 包裹（失败返回 null + console.warn，同 W1 TOCTOU 处置模式）（依赖 T001）
  **验收标准**：正常 dist 目录返回 sha256 字符串；dist 目录不存在或不可读时不抛异常、返回确定性结果（不一定是 null，见 plan.md 风险点 3——需在测试中显式验证"不抛异常"而非强制断言 null）

- [ ] **T005** 将 `readSidecarFingerprint()` 改造为导出函数 `readSidecar(sidecarPath: string = TEST_INPUTS_SIDECAR): TestInputsSidecar | null`：校验 `schemaVersion === 2`、`inputsSha256`/`distSha256` 均为 string 才返回完整对象，否则一律返回 `null`（旧 v1 sidecar 自动判 null）（依赖 T003）
  **验收标准**：解析失败/schemaVersion≠2/字段类型不符/文件不存在 → 均返回 `null`（保守偏置不变）；用手写 `{schemaVersion: 1, inputsSha256: 'x'}` 文件调用返回 `null`

- [ ] **T006** 将 `writeSidecar(inputsSha256)` 改造为导出函数 `writeSidecar(inputsSha256: string, distSha256: string, sidecarPath: string = TEST_INPUTS_SIDECAR): void`：写入 v2 payload；仅当 `sidecarPath === TEST_INPUTS_SIDECAR`（即生产默认路径）时才 `rmSync(LEGACY_SHARED_SIDECAR, { force: true })` 清理遗留共享文件（依赖 T004、T005）
  **验收标准**：传入临时 `sidecarPath` 调用时不触碰 `LEGACY_SHARED_SIDECAR`（测试隔离约束）；生产路径调用时遗留文件被清理（best-effort，清理失败不抛异常）

- [ ] **T007** 改造 `isDistFresh` 为导出函数，签名扩展为 `isDistFresh(currentFingerprint, opts?: { distCli?, buildMeta?, sidecarPath?, distDir? })`：在既有三重检查（fingerprint 非空 → DIST_CLI/BUILD_META 存在 → sidecar.inputsSha256 匹配）之后追加第四重检查——现算 `computeDistFingerprint(distDir)` 与 `sidecar.distSha256` 比对，两者非空且相等才判新鲜（依赖 T004、T005）
  **验收标准**：既有三重检查顺序与短路逻辑零改动（人工 diff 核对）；新增第四重检查为最后一步；`runBuild()` 内 `fingerprintAfterBuild` 与 `distFingerprint` 均非 null 时才调用 `writeSidecar`（改动 6，同一任务内一并完成），确保"只删不写"语义在 dist 指纹计算失败时保持

**Checkpoint**：核心判定逻辑改造完成，`setup()`/`onTestsRerun()` 沿用默认参数调用，行为对单 worktree 场景保持等价

---

## Phase 3: 文件头文档同步

- [ ] **T008** 更新 `tests/global-setup.ts` 文件头"已知边界"注释，追加第三条边界说明（跨 worktree 假新鲜的成因摘要 + 修法摘要 + 指向 `specs/274-.../fix-report.md`），不删除/不改写 F251 原有两条边界说明
  **验收标准**：新注释内容与 plan.md 改动 2 一致；原有两条边界说明逐字节保留

---

## Phase 4: 回归测试与变异验证

**目的**：新增跨 worktree 假新鲜复现测试，并做变异验证确认测试确实具备守护力（这是本次修复能否被信任的核心证据）

- [ ] **T009** 新增测试文件 `tests/integration/global-setup-cross-worktree-freshness.test.ts`，包含 5 个用例（依赖 Phase 1-2 全部改动已 export 到位）：
  1. 复现 bug：inputsSha256 匹配但 dist 实际内容与 sidecar 绑定不同 → `isDistFresh` 判 `false`
  2. 同 worktree 内 dist 与 sidecar 绑定一致 → 判 `true`（正常路径不受影响）
  3. 旧 schemaVersion 1 sidecar（无 distSha256）→ `readSidecar` 返回 `null`，`isDistFresh` 判 `false`
  4. `deriveSidecarPath` 对不同 PROJECT_ROOT 产生不同文件名
  5. dist 目录不存在时 `computeDistFingerprint` 不抛异常
  全程仅操作 `mkdtempSync` 临时目录，通过显式参数覆盖隔离，不触碰本 worktree 真实 `dist/`、`node_modules/.cache/`
  **验收标准**（对应 plan.md AC-1~AC-4）：`npx vitest run tests/integration/global-setup-cross-worktree-freshness.test.ts` 5/5 通过；`afterEach` 清理临时目录，用例间无共享可变状态

- [ ] **T010** 变异验证：临时将 `isDistFresh` 还原为修复前逻辑（只比对 `inputsSha256`，去掉第四重 dist 绑定校验），重跑 T009 的用例 1，确认转红；验证完成后恢复修复后逻辑（依赖 T009）
  **验收标准**（对应 plan.md AC-1 变异验证要求）：还原后用例 1 从 `expect(fresh).toBe(false)` 断言失败（即 `isDistFresh` 返回 `true`，证伪成功）；验证后代码状态与 T007 完成态一致，无残留改动

**Checkpoint**：测试新增完成且守护力已验证，可进入全量回归

---

## Phase 5: 全量验证与收尾

- [ ] **T011** 跑全量验证命令链，确认零失败/零错误：
  ```bash
  npx vitest run tests/integration/global-setup-cross-worktree-freshness.test.ts
  npx vitest run
  npm run build
  npm run repo:check
  ```
  **验收标准**（对应 plan.md AC-5、AC-6）：全部命令零失败/零错误；人工 diff 核对 `setup()`/`onTestsRerun()`/`runBuild()` 的既有调用顺序、日志文案、C1（先删后写）/W1（前后指纹一致才落盘）/W3/W4（watch fail-loud/容错语义）未被改动，未出现既有代码块删除/重排

- [ ] **T012** 门禁类改动异构对抗审查（Codex 配额暂停期，按 CLAUDE.local.md 约定）：启动独立子代理，至少 2 个不同切入角（"绕过分键构造同名冲突"面 / "TOCTOU 窗口内 dist 被并发改动"面），对本次改动做证伪式审查；修复 critical/warning 发现后重跑 T011；commit message 中显式标注"Codex 审查暂停，异构档位缺席"
  **验收标准**：审查结论记录（几条 critical/warning，已修复几条）；commit message 含标注文案；重跑 T011 全绿

---

## Dependencies & Execution Order

### Phase 依赖

- **Phase 1（Schema/路径）** → 无前置依赖，最先开始
- **Phase 2（核心判定逻辑）** → 依赖 Phase 1 全部完成
- **Phase 3（文档同步）** → 依赖 Phase 2 完成（注释内容需引用最终实现细节），可与 Phase 4 并行
- **Phase 4（测试与变异验证）** → 依赖 Phase 2 全部函数已 export
- **Phase 5（全量验证与收尾）** → 依赖 Phase 3、Phase 4 全部完成

### 任务内部依赖链

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008/T009（可并行）→ T010 → T011 → T012

### 并行机会

本次修复改动高度集中在单文件 `tests/global-setup.ts` 内部且存在强顺序依赖（schema 定义先于读写函数、读写函数先于判定逻辑），[P] 并行空间有限：
- T008（文档同步）与 T009（新增测试文件）可并行（不同文件，均依赖 Phase 2 完成后的最终函数签名）

### 实现策略

**单线顺序推进**：本次修复非多 User Story 结构，推荐按 T001→T012 顺序线性完成，每个 Phase 结束做一次 checkpoint 确认（Phase 1/2 结束跑 `npm run build`；Phase 4 结束跑聚焦测试 + 变异验证；Phase 5 为最终全量收尾）。

---

## FR/AC 覆盖映射表

| plan.md 验收标准 | 对应任务 |
|------|------|
| AC-1（复现 bug 用例 + 变异验证） | T009, T010 |
| AC-2（正常同 worktree 场景不受影响） | T009 |
| AC-3（旧 schemaVersion 1 安全拒绝） | T005, T009 |
| AC-4（deriveSidecarPath 分键） | T002, T009 |
| AC-5（全量 vitest + build 零失败） | T011 |
| AC-6（既有调用顺序/语义未改动） | T007, T011 |
| AC-7（真实场景复现，可选） | 未纳入任务清单（plan.md 标注"可选"，需另一已 clone worktree 环境，非本次任务强制项） |
| 文件头已知边界文档同步 | T008 |
| 门禁类改动异构对抗审查 | T012 |
