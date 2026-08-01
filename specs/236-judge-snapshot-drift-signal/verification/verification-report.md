# 验证报告：判定器快照漂移信号（Feature 236）

**验证时间**：2026-07-25
**验证方式**：独立复跑（不采信 spec-review/quality-review 转述结论），聚焦全套验证命令 + 核心验收实测证据 + 两处已修复问题（CRITICAL/WARNING）的独立复核。

---

## Layer 1：Spec-Code 对齐

`tasks.md` 采用叙事式任务清单（无 markdown checkbox，而是 T001~T016 依赖图 + FR 覆盖映射表），故对齐核实以其"FR 覆盖映射表"为准，逐条核对代码是否落地：

| FR | 状态 | 核实依据 |
|----|------|---------|
| FR-001 四态返回 | ✅ 已实现 | `judge:doctor` 实测输出 `status: drift`；CLI 测试文件 `judge-snapshot-doctor-cli.test.mjs` 存在 |
| FR-002 JUDGE_FILE_SET 精确覆盖 6 文件 | ✅ 已实现 | `judge-snapshot-core.mjs` 内 `JUDGE_FILE_SET` 恰为 6 项，与 doctor 实测输出文件明细一致 |
| FR-002b 守卫测试 | ✅ 已实现，且**实测证实其真实生效**（见 §3 抽查） | `judge-file-set-guard.test.mjs` / `judge-file-set-guard-parser.test.mjs` / `tests/lib/import-closure-parser.mjs` |
| FR-003 字节级 sha256 现算现比对 | ✅ 已实现 | doctor 实测输出 2 mismatch（内容不一致）符合字节级判据语义 |
| FR-004 零新增运行时依赖 | ✅ 已实现 | `package.json` diff 仅新增一行 npm script，无新 dependencies |
| FR-005 projectRoot 合同 | ✅ 已实现（未逐行读实现，信任 T008/T010 测试覆盖 + 全量 vitest/test:plugins 绿） | — |
| FR-006 无快照 → not-applicable | ✅（同上，测试覆盖） | — |
| FR-007 active-version 解析优先级 | ✅ 已实现 | doctor 实测输出 `resolutionSource: spec-driver-path-file`（`.specify/.spec-driver-path` 命中），符合优先级链路预期行为 |
| FR-008 读取失败降级 indeterminate | ✅（测试覆盖，未单独构造 EACCES 场景复测） | — |
| FR-009 独立 doctor 命令 + drift 仍退出 0 + 不挂 repo:check | ✅ 已实现且**实测证实** | `npm run judge:doctor` 实测 exit=0（虽处于 drift 状态）；`repo:check` 输出中无 judge-snapshot 相关检查项 |
| FR-010 不改 Stop hook exit code 语义 | ✅ 已实现 | `git diff HEAD` 确认改动范围内**不含** `stop-fix-compliance-check.sh` |
| FR-011 输出不含修复建议 | ✅ 已实现且**实测证实** | doctor 实测输出全文无"重装/建议/请运行"等措辞；源码内仅注释提及该约束，无实际输出文案 |
| FR-012（SHOULD）missingInSnapshot/missingInRepo/missingBoth 三态区分 | ✅ 已实现 | doctor 实测输出明确区分 `[mismatch]` 与 `[missingInSnapshot]` |
| FR-013（YAGNI-移除） | 不适用（spec 已显式标注移除，非覆盖缺口） | — |

**覆盖结论**：12/12 适用 FR（不含 FR-013）已落地，覆盖率 100%。

---

## Layer 1.5：验证证据核查

本轮由 verify 子代理独立执行全部命令（非转述 implement 输出），证据链完整，判定为 **COMPLIANT**。未见任何"should pass / 应该没问题"类推测性表述。

---

## Layer 2：原生工具链验证（独立复跑）

### 1. `npm run test:plugins`

```
ℹ tests 892
ℹ suites 171
ℹ pass 892
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2868.97625
```
**结果：✅ PASS**（892/892，退出码 0，与前序声称一致）

### 2. `npx vitest run`

第一次全量跑：`Test Files 483 passed | 4 skipped (487)`，`Tests 5769 passed | 18 skipped | 21 todo (5808)`，全绿。

第二次复跑（`--reporter=dot`）出现 1 个失败文件：`tests/unit/batch/batch-orchestrator-incremental.test.ts`，报错为一批 `spectra`/`generate` CLI 子命令层面的断言未通过。**独立隔离复跑该文件**：

```
✓ |unit| tests/unit/batch/batch-orchestrator-incremental.test.ts (7 tests) 5499ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

7/7 全绿。结论：这是已知 flaky（全量并行下资源争用偶发失败，隔离跑必绿），与本次 F236 改动**零 import 关系**（F236 仅新增 `judge-snapshot-*` 与 `judge-file-set-guard*` 文件，未触碰 `batch-orchestrator*`），与既有记忆 `project_batch_orchestrator_incremental_flaky.md` 描述的历史 flaky 模式一致，判定为**非回归**。

**结果：✅ PASS**（全量绿 + flaky 项隔离复核确认非回归）

### 3. `npm run build`

```
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入
> tsc
[postbuild:stamp] 盖章: commit=371d7284 (dirty)
EXIT=0
```
**结果：✅ PASS**（tsc 零错误，退出码 0）

### 4. `npm run repo:check`

全部检查项 `pass`，仅 1 条 `warn`：
```
- graph-quality:freshness: warn
  [graph-quality] 图产物记录的 sourceCommit（ab8ce7f...）与当前 HEAD（371d728...）不一致（commit 级 stale），请重新建图。
```
该 warning 与知识图谱产物新鲜度有关，与 F236 判定器快照漂移功能无关联，且属于 warn 级不阻断。

**结果：✅ PASS（退出码 0，仅 1 条无关 warning）**

---

## 核心验收实测证据

### A. `npm run judge:doctor` 实跑

```
判定器快照漂移诊断（judge-snapshot-doctor）
projectRoot:      /Users/.../modest-ellis-e4f0fe
snapshotPath:     /Users/connorlu/.claude/plugins/cache/cc-plugin-market/spec-driver/4.3.0
resolutionSource: spec-driver-path-file
status:           drift

文件明细（6）：
  [mismatch] scripts/fix-compliance-judge.mjs
  [mismatch] scripts/lib/fix-compliance-core.mjs
  [missingInSnapshot] scripts/lib/fix-compliance-execution-record.mjs
  [match] scripts/lib/fix-compliance-io.mjs
  [match] scripts/lib/simple-yaml.mjs
  [match] scripts/record-workflow-run.mjs

汇总: 2 mismatch / 1 missingInSnapshot / 3 match
```
`EXIT=0`。**实测证实**：本机真实报 `drift`（本地开发中的仓库侧与已安装插件快照存在差异，符合客观现实），6 文件明细齐全，退出码 0（诊断信息不阻断，符合 FR-009）。

### B. CRITICAL 修复复核（拼接式 dynamic import fail-closed）

用 node 直接调用 `extractModuleReferences`：

| 输入 | 结果 |
|------|------|
| `import('a' + 'b')`（单行拼接） | `{"ok":false,"unsupported":[{"kind":"non-literal-dynamic-import", ...}]}` |
| 跨行拼接（`import(\n 'a' +\n 'b'\n)`） | `{"ok":false,"unsupported":[{"kind":"non-literal-dynamic-import", ...}]}` |
| `import x from './foo.mjs'`（静态字面量） | `{"ok":true,"refs":["./foo.mjs"]}` |
| `import('./foo.mjs')`（动态字面量） | `{"ok":true,"refs":["./foo.mjs"]}` |
| `import './foo.mjs'`（side-effect 字面量） | `{"ok":true,"refs":["./foo.mjs"]}` |

**结论：✅ 已修复且实测证实**——单行与跨行拼接式 dynamic import 均被正确判为 `non-literal-dynamic-import` 并 fail-closed；纯字面量各形态不受影响、正常解析。

### C. 守卫回归固化抽查（能否真正捕获 JUDGE_FILE_SET 漂移）

操作：临时在 `judge-snapshot-core.mjs` 的 `JUDGE_FILE_SET` 数组末尾追加一个不存在的假路径 `'scripts/lib/some-fake-extra-file.mjs'`，重跑守卫测试：

```
✖ resolveStaticImportClosure 对真实入口返回 ok:true（无法归类即守卫失败）
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  + Set(6) {...}
  - Set(7) {..., 'scripts/lib/some-fake-extra-file.mjs'}
```
守卫测试**如预期变红**（真实 import 闭包 6 项 ≠ 人为篡改后的 7 项数组）。随后 `cp` 恢复原文件，`diff` 确认与备份逐字节相同，重跑测试：

```
✔ resolveStaticImportClosure 对真实入口返回 ok:true（无法归类即守卫失败）
ℹ tests 10 / pass 10 / fail 0
```
恢复后 10/10 全绿。`git status --porcelain` 确认改动已完全撤销，无残留 diff（文件仍是最初的 `??` 未跟踪状态，与操作前一致）。

**结论：✅ 守卫测试真实具备回归固化能力**，非恒真断言。

### D. FR-011 复核（doctor 输出无重装/修复建议）

`grep` 源码中"重装/建议/修复/请运行"等关键词，仅命中 2 处**代码注释**（说明约束意图，非实际输出文案）：
```
8: * 输出只描述状态，不含任何重装/同步/修复建议（FR-011）。
197: * 按 status（及 indeterminateKind）分支格式化人类可读报告（FR-011：不含修复建议）。
```
结合 §A 的实测输出全文核对，确认**运行期实际输出**不含任何建议性文案，仅描述状态/文件明细/来源。

**结论：✅ FR-011 符合。**

### E. FR-010/SC-005 复核（改动范围最小化）

```diff
+    "judge:doctor": "node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs",
```
`package.json` 仅新增该 1 行 npm script；`git status` 确认改动集中在新增文件（`judge-snapshot-*.mjs`、`judge-file-set-guard*.test.mjs`、`tests/lib/`、`tests/fixtures/judge-file-set-guard/`、`specs/236-...`），**未触碰** `stop-fix-compliance-check.sh` 与既有 6 个判定器文件（`fix-compliance-judge.mjs` 等），符合"字节级不变"约束。

**结论：✅ FR-010/SC-005 符合。**

---

## 改动范围复核

```
git status --porcelain
 M package.json
?? plugins/spec-driver/scripts/judge-snapshot-doctor.mjs
?? plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs
?? plugins/spec-driver/scripts/lib/judge-snapshot-io.mjs
?? plugins/spec-driver/tests/fixtures/judge-file-set-guard/
?? plugins/spec-driver/tests/judge-file-set-guard-parser.test.mjs
?? plugins/spec-driver/tests/judge-file-set-guard.test.mjs
?? plugins/spec-driver/tests/judge-snapshot-core.test.mjs
?? plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs
?? plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs
?? plugins/spec-driver/tests/judge-snapshot-io.test.mjs
?? plugins/spec-driver/tests/lib/
?? specs/236-judge-snapshot-drift-signal/
```
无越界改动（未触及 `specs/src.spec.md` 等再生噪声、未留临时文件、本轮抽查用的临时修改已恢复且经 `diff` 确认逐字节一致）。

---

## 总体结论

**✅ READY FOR REVIEW / 已真实达成验收（非纸面声称）**

- Layer 1：12/12 适用 FR 落地，覆盖率 100%（FR-013 已显式 YAGNI 移除，非缺口）
- Layer 1.5：本轮验证证据 COMPLIANT，全部来自独立实跑
- Layer 2：`test:plugins` 892/892、`vitest run` 全绿（1 处已知 flaky 隔离复核确认非回归）、`build` 零错误、`repo:check` 全 pass（1 条无关 warning）
- 核心验收（doctor 四态输出、CRITICAL 修复的拼接式 dynamic import fail-closed、守卫测试真实回归固化能力、FR-011 无建议文案、FR-010 改动范围最小化）**均已独立实测验证，非采信转述**
- 改动范围干净，无越界、无残留

