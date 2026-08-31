---
feature: 274-fix-global-setup-cross-worktree-freshness
mode: fix
phase: plan
status: draft
based_on: ./fix-report.md（推荐方案 A：sidecar 绑定 dist 内容指纹 + 按 PROJECT_ROOT 分键）
---

# 技术修复计划 — global-setup 跨 worktree 假新鲜盲区收口

> Feature 274 · fix 模式 · 基于 `fix-report.md` 推荐方案 A（双管齐下：dist 内容指纹绑定 + sidecar 按 PROJECT_ROOT 分键）

## Summary

`tests/global-setup.ts` 的 `isDistFresh()` 判据只见证"构建输入 src 的内容指纹"，不见证"这份指纹对应的是哪一份 dist 产物"。当多个 worktree 的 `node_modules`（含 sidecar 所在的 `.cache/`）软链共享同一物理文件、而各自 `dist/` per-worktree 独立时，worktree A 的构建见证会被 worktree B 误采信，B 的陈旧 dist 被判新鲜、被跳过重建——实证见 fix-report（2026-08-31，worktree funny-driscoll-fc77bb，6 用例假红）。

修复方案（fix-report 方案 A，双管齐下，均在 `tests/global-setup.ts` 单文件内完成）：

1. **dist 内容绑定**：sidecar schema 升 v2，新增 `distSha256` 字段。构建成功后现算 `hashDistTree(dist)`（复用 `scripts/lib/spectra-version-gate.mjs` 既有实现，不重新实现）落盘；`isDistFresh()` 检查时同样现算当前 dist 内容指纹与 sidecar 记录比对，不信任 build-meta 的转述。
2. **按 PROJECT_ROOT 分键**：sidecar 文件名从固定的 `test-build-inputs.json` 改为 `test-build-inputs-<sha256(PROJECT_ROOT) 前 12 位>.json`，每个 worktree 持有独立见证文件，从根上消除共享导致的互相覆写。

保持既有保守偏置不变：任何指纹现算失败/sidecar 缺失/schema 不匹配/字段缺失 → 判不新鲜 → 重建；C1"先删后写"序列、W1 构建前后指纹一致才落盘、fail-loud/watch 容错语义全部原样保留，本次修复不触碰这些既有代码路径。

## 范围边界

### 纳入（1 个源文件 + 1 个新测试文件）

| 文件 | 类型 | 变更类型 |
|------|------|----------|
| `tests/global-setup.ts` | 源文件（测试守护基础设施） | 修改：sidecar schema v2 + dist 绑定 + PROJECT_ROOT 分键 + 关键函数参数化导出 + 文件头"已知边界"注释同步 |
| `tests/integration/global-setup-cross-worktree-freshness.test.ts` | 测试文件 | 新增：跨 worktree 假新鲜复现测试（构造陈旧 dist + 匹配 sidecar） |

### 不纳入（明确排除，理由见 fix-report 影响范围扫描）

- `tests/helpers/dist-cli-guard.ts`：评估为 [安全]，只做 `DIST_CLI`/`BUILD_META` 存在性断言，不消费 sidecar，无共享态，**不改**。
- `scripts/lib/spectra-version-gate.mjs`：`hashDistTree` 是既有实现，本次修复**复用而非重写**；`stampBuild`/`verifySpectraVersion` 的 build-meta 场景本身不存在跨 worktree 共享（meta 落在 per-worktree 的 `dist/` 内），**不改**。
- 任何 `beforeAll` 消费 dist 的测试文件：F251 已把构建职责收拢到 globalSetup，这些文件不触发构建、也不消费 sidecar，本次修复对它们透明，**不改**。
- 无独立 `spec.md`：F251 制品为历史 fix 记录，`tests/global-setup.ts` 文件头注释即 canonical 行为文档，随本次实现同步更新。

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件 | 1 个源文件 + 1 个新测试文件 |
| 间接受影响 | 全部依赖 globalSetup 保证 dist 新鲜的测试套件（本次修复只让判据更准确，不改变"dist 在测试执行前已就绪"这一消费契约）；`tests/helpers/dist-cli-guard.ts`（读同一批 `DIST_CLI`/`BUILD_META` 常量，纯存在性断言，行为不受影响） |
| 跨包影响 | 无（改动完全限于 `tests/` 测试基础设施内部，不触碰 `src/`/`plugins/`） |
| 数据迁移 | sidecar schema v1→v2，但 sidecar 是 `node_modules/.cache/` 内的临时状态文件（非入库产物，不进 git、不进 npm 发布包），无需 migration 脚本——`readSidecar()` 对 v1/旧共享文件一律返回 `null`，触发一次重建即完成"迁移"，这本身就是既有保守偏置的自然结果 |
| API/契约变更 | 否——`isDistFresh`/`writeSidecar`/`readSidecar`/`computeDistFingerprint`/`deriveSidecarPath` 新增 `export` 关键字使其可被测试文件 import，但均为测试基础设施内部函数，不进 `dist/`、不进 `package.json` 的 `exports`，不构成任何面向用户的公共 API |
| **风险等级** | **LOW**（影响文件 2 个 < 10，无跨包，无数据迁移，无公共契约变更）。但本文件是测试守护基础设施，失效即静默放行假绿，按 `CLAUDE.local.md` 门禁类改动对待，implement/commit 阶段须走异构对抗审查档位（Codex 配额暂停期），plan 阶段不代为出具审查结论 |

## 关键设计决策

### D1 — dist 内容绑定：复用 `hashDistTree`，现算而非信任 build-meta 转述

**决策**：sidecar 新增 `distSha256` 字段，值来自 `scripts/lib/spectra-version-gate.mjs` 已导出的 `hashDistTree(distDir).sha256`（该函数已被 `stampBuild`/`verifySpectraVersion` 使用，遍历 `dist/` 下全部 `.js` 文件做 merkle-ish 内容指纹）。写入时机（`runBuild()` 内）与检查时机（`isDistFresh()` 内）都**独立现算**，不读取 `dist/.spectra-build-meta.json` 里已经算好的 `distSha256`。

**为什么不信任 build-meta 的转述**：`stampBuild`（`postbuild-stamp.mjs` 调用）在非 git 环境会抛错，postbuild 脚本捕获后跳过盖章——此时 `dist/.spectra-build-meta.json` 若有更早遗留的旧 meta 会原样保留在磁盘上（`tests/global-setup.ts` 现有注释 L144-149 已记录这一行为）。若 sidecar 的 `distSha256` 取自这份可能陈旧的 meta，绑定关系本身就不可靠。现算是唯一诚实的证据源；`dist` 现有 329 个 `.js` 文件，现算开销数十毫秒量级，相对一次 `npm run build`（分钟级）可忽略，不构成需要缓存/复用的性能约束。

**为什么不重新实现**：`hashDistTree` 已是仓库内 F176 版本门禁的既有权威实现，与 `verifySpectraVersion`（gate-time 校验）用的是同一函数——本次修复只是新增一个"build 成功后立即现算一次、判定时再现算一次比对"的消费方，不新增第二套哈希逻辑。

### D2 — sidecar 按 PROJECT_ROOT 分键 + 遗留共享文件清理

**决策**：新增纯函数 `deriveSidecarPath(projectRoot: string): string`，返回 `join(projectRoot, 'node_modules', '.cache', 'spectra', 'test-build-inputs-<sha256(projectRoot).slice(0,12)>.json')`；`TEST_INPUTS_SIDECAR` 常量改为 `deriveSidecarPath(PROJECT_ROOT)`。写入新 keyed 文件时（`writeSidecar()` 内），若写入目标恰是模块默认路径（即生产调用路径，非测试注入的临时路径），顺带 `rmSync(旧共享文件, { force: true })` 清理遗留——不做实质迁移，仅为不留死文件（schemaVersion 校验本就会拒读旧格式）。

**为什么不能只做 dist 绑定而不分键**：若只做 D1、仍共享单一 sidecar 文件，A/B 两 worktree 会持续互相覆写对方的见证——A 重建后写入自己的 `distSha256`，B 下次检查时（B 的 dist 与 A 刚写入的 `distSha256` 不符）判不新鲜再重建，重建后又写入 B 自己的 `distSha256` 覆盖 A 的记录，A 下次又被打回重建……在 tsc 输出存在任何非确定性（时间戳、路径大小写等）时会退化为跨 worktree 每次互相打回的重建 thrash。分键从根上消除共享，是比"只加绑定校验"更彻底的修法；D1 的绑定校验则守住"同一 worktree 内 dist 被外力替换/半成品"这一 D2 单独做不到的更强不变量——两者互补，缺一不可（fix-report 方案 B 单独评估过"只分键"，因缺证据绑定被否决）。

**升级成本（一次性，非回归）**：本次修复上线后，所有既存 worktree 的旧共享 sidecar 文件名不再被任何 worktree 读取（各自改读自己的 keyed 路径），每个 worktree 首次运行会因"sidecar 不存在"触发一次强制重建。这是预期的、一次性的迁移成本，之后各 worktree 独立维持自己的见证，不再互相踩踏。verify 阶段需如实记录这一现象，不得误判为性能回归。

### D3 — 测试切入方式：参数化导出（同文件），不新建独立 core 模块

**决策**：把 `computeDistFingerprint` / `readSidecar` / `writeSidecar` / `isDistFresh` / `deriveSidecarPath` 五个函数加 `export` 关键字并参数化（每个接受可选的路径参数，默认值绑定到模块内真实的 `PROJECT_ROOT` 派生常量），继续留在 `tests/global-setup.ts` 内，不拆分到新的 `tests/helpers/dist-freshness-core.ts`。

**为什么不新建独立 core 模块（被否决的替代方案）**：拆分模块会让"谁是权威实现"产生新的间接层——`tests/global-setup.ts` 变成薄壳转发，新增一个文件、一次额外的 import 关系需要维护；对于修复范围仅 5 个函数的量级，这个额外的架构层没有回报，且扩大了本次 fix 的 diff 面（与"最小化变更范围"的 fix 模式约束相悖）。

**为什么参数化导出可行且安全**：
- 生产调用路径（`setup()`/`onTestsRerun()`/`runBuild()` 内部）继续用零参数或双参数调用（`isDistFresh(snapshot)`、`writeSidecar(fingerprintAfterBuild, distFingerprint)`），走默认值绑定到真实 `PROJECT_ROOT`/`DIST_DIR`/`TEST_INPUTS_SIDECAR`/`DIST_CLI`/`BUILD_META`，**行为与改造前逐字节一致**。
- 测试文件通过显式传参（临时目录构造的 `distCli`/`buildMeta`/`sidecarPath`/`distDir`）完全隔离，不会读写本 worktree 真实的 `dist/`、`node_modules/.cache/`，满足"不能真的破坏本 worktree 的 dist"的硬约束。
- `computeInputsFingerprint()`（构建输入指纹计算，含 FULL_BUILD_INPUT_PATHS 遍历）**不参与本次改造**——它的实现逻辑与本次 bug 无关（bug 出在"指纹匹配之后要不要信任""sidecar 存在于哪"，不在指纹本身怎么算），保持私有、不导出、不改动，进一步收窄 diff 面。

### D4 — `isDistFresh` 语义扩展：新增一重绑定校验，不改变既有短路顺序

**决策**：`isDistFresh` 的既有检查顺序（`currentFingerprint === null` → `DIST_CLI`/`BUILD_META` 存在性 → sidecar `inputsSha256` 匹配）保持不变，只在最后追加第四重检查：现算 `computeDistFingerprint(distDir)` 与 sidecar 记录的 `distSha256` 比对，两者都非空且相等才算新鲜。这一重检查正是堵住跨 worktree 假新鲜的关键——即便 `inputsSha256` 因 sidecar 跨 worktree 共享/同 commit 而"恰好匹配"（旧 bug 场景），只要本 worktree 实际 dist 内容与那次见证不同，第四重检查就会拦下。

### D5 — 文件头"已知边界"注释同步

`tests/global-setup.ts` 文件头（L1-29）的"已知边界"是本文件的 canonical 行为文档。本次修复新增一条边界说明，交代"sidecar 与 dist 同域"这一 F251 隐含假设被 worktree 软链惯例打破的事实、以及双管齐下的修法摘要，并指向 `specs/274-.../fix-report.md` 获取完整 5-Why。不删除/不改写 F251 原有的两条边界说明（跨进程并发 build 窗口、`npm ci`/先手动 build 场景），它们与本次修复正交，继续成立。

## 文件级变更清单

### 修改：`tests/global-setup.ts`

**改动 1 — 导入 `hashDistTree`（L37 附近）**

```diff
-import { BUILD_INPUT_PATHS, BUILD_META_NAME } from '../scripts/lib/spectra-version-gate.mjs';
+import { BUILD_INPUT_PATHS, BUILD_META_NAME, hashDistTree } from '../scripts/lib/spectra-version-gate.mjs';
```

**改动 2 — 文件头"已知边界"注释追加第三条（L28 之后，`*/` 之前）**

```text
 * - F274 修订：上述 sidecar 曾隐含假设"一份 sidecar 只对应一份 dist"，但本仓库多
 *   worktree 惯例是 `node_modules` 软链到主仓（sidecar 物理路径共享），`dist/` 却
 *   per-worktree 独立——这打破了该假设，会让 worktree A 的构建见证被 worktree B
 *   误采信，B 的陈旧 dist 被判新鲜（详见
 *   specs/274-fix-global-setup-cross-worktree-freshness/fix-report.md 的 5-Why）。
 *   修法双管齐下：(1) sidecar 文件名按 `sha256(PROJECT_ROOT)` 分键，每个 worktree
 *   持有独立见证文件；(2) sidecar schema 升 v2，新增 `distSha256` 字段，绑定"这份
 *   见证对应的是哪一份 dist 内容"（用 hashDistTree 现算，不信任 build-meta 的转述）。
```

**改动 3 — sidecar 路径推导按 PROJECT_ROOT 分键（原 L42-48 整段替换）**

```diff
-// 内部对抗复审后修订（I4）：sidecar 从 `dist/.spectra-test-inputs.json` 迁到
-// `node_modules/.cache/`。why：`dist/` 在 package.json 的 `files` 白名单内，
-// `prepublishOnly` 会跑一次 vitest，若 sidecar 留在 `dist/` 里会被一并打进 npm 发布包
-// （测试基础设施的内部状态不应该出现在发布产物里）。`.cache/` 天然不入包、不入库；
-// `npm ci` 清空 `node_modules` 时 sidecar 随之消失，触发一次保守重建，方向正确。
-// dist 本身的完整性判定不受影响——仍由 DIST_CLI + BUILD_META 的存在性单独锚定。
-const TEST_INPUTS_SIDECAR = join(PROJECT_ROOT, 'node_modules', '.cache', 'spectra', 'test-build-inputs.json');
+// 内部对抗复审后修订（I4）：sidecar 从 `dist/.spectra-test-inputs.json` 迁到
+// `node_modules/.cache/`。why：`dist/` 在 package.json 的 `files` 白名单内，
+// `prepublishOnly` 会跑一次 vitest，若 sidecar 留在 `dist/` 里会被一并打进 npm 发布包
+// （测试基础设施的内部状态不应该出现在发布产物里）。`.cache/` 天然不入包、不入库；
+// `npm ci` 清空 `node_modules` 时 sidecar 随之消失，触发一次保守重建，方向正确。
+// dist 本身的完整性判定不受影响——仍由 DIST_CLI + BUILD_META 的存在性单独锚定。
+//
+// F274 修订：`.cache/` 随 `node_modules` 软链在多 worktree 间物理共享，若固定单一
+// 文件名会导致跨 worktree 互相踩踏见证（见文件头"已知边界"）。改为按 PROJECT_ROOT
+// 分键，每个 worktree 持有独立见证文件。`deriveSidecarPath`/`computeDistFingerprint`/
+// `readSidecar`/`writeSidecar`/`isDistFresh` 均导出并参数化，供
+// tests/integration/global-setup-cross-worktree-freshness.test.ts 用临时目录隔离验证，
+// 生产调用路径（本文件内 setup()/onTestsRerun()/runBuild()）均使用默认参数，行为不变。
+const DIST_DIR = join(PROJECT_ROOT, 'dist');
+
+export function deriveSidecarPath(projectRoot: string): string {
+  const key = sha256Hex(projectRoot).slice(0, 12);
+  return join(projectRoot, 'node_modules', '.cache', 'spectra', `test-build-inputs-${key}.json`);
+}
+
+const TEST_INPUTS_SIDECAR = deriveSidecarPath(PROJECT_ROOT);
+// F274 之前版本使用的固定共享文件名；仅用于升级后一次性清理遗留死文件。
+const LEGACY_SHARED_SIDECAR = join(PROJECT_ROOT, 'node_modules', '.cache', 'spectra', 'test-build-inputs.json');
```

（`sha256Hex` 是本文件已有的 `function` 声明（原 L62-64），TS/JS 的函数声明整体提升，`deriveSidecarPath` 在其之前调用安全，不需要调整两者的文本顺序。）

**改动 4 — `TestInputsSidecar` interface 升 v2 + `readSidecarFingerprint`/`writeSidecar` 改造为 `readSidecar`/`writeSidecar`（原 L116-137 整段替换）**

```diff
 interface TestInputsSidecar {
-  schemaVersion: 1;
+  schemaVersion: 2;
   inputsSha256: string;
+  /** hashDistTree(dist).sha256 —— 绑定这份见证对应的具体 dist 内容（F274）。 */
+  distSha256: string;
 }

 /** 解析失败/schemaVersion 不匹配/字段缺失/文件不存在一律返回 null（保守偏置）。 */
-function readSidecarFingerprint(): string | null {
+export function readSidecar(sidecarPath: string = TEST_INPUTS_SIDECAR): TestInputsSidecar | null {
   try {
-    if (!existsSync(TEST_INPUTS_SIDECAR)) return null;
-    const parsed = JSON.parse(readFileSync(TEST_INPUTS_SIDECAR, 'utf-8')) as Partial<TestInputsSidecar>;
-    if (parsed.schemaVersion !== 1) return null;
-    return typeof parsed.inputsSha256 === 'string' ? parsed.inputsSha256 : null;
+    if (!existsSync(sidecarPath)) return null;
+    const parsed = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as Partial<TestInputsSidecar>;
+    if (parsed.schemaVersion !== 2) return null;
+    if (typeof parsed.inputsSha256 !== 'string' || typeof parsed.distSha256 !== 'string') return null;
+    return { schemaVersion: 2, inputsSha256: parsed.inputsSha256, distSha256: parsed.distSha256 };
   } catch {
     return null;
   }
 }

-function writeSidecar(inputsSha256: string): void {
-  mkdirSync(dirname(TEST_INPUTS_SIDECAR), { recursive: true });
-  const payload: TestInputsSidecar = { schemaVersion: 1, inputsSha256 };
-  writeFileSync(TEST_INPUTS_SIDECAR, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
+export function writeSidecar(inputsSha256: string, distSha256: string, sidecarPath: string = TEST_INPUTS_SIDECAR): void {
+  mkdirSync(dirname(sidecarPath), { recursive: true });
+  const payload: TestInputsSidecar = { schemaVersion: 2, inputsSha256, distSha256 };
+  writeFileSync(sidecarPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
+  // 仅在写入真实默认路径（生产调用）时才清理遗留共享文件，避免测试用临时
+  // sidecarPath 时误删无关文件。
+  if (sidecarPath === TEST_INPUTS_SIDECAR) {
+    rmSync(LEGACY_SHARED_SIDECAR, { force: true });
+  }
 }
+
+/**
+ * dist 目录内容指纹（F274）：复用 scripts/lib/spectra-version-gate.mjs 既有
+ * `hashDistTree`（与 F176 版本门禁 build-meta 的 distSha256 同一实现），不重新实现。
+ * try/catch 包裹（同 computeInputsFingerprint 的 W1 TOCTOU 处置）：遍历/读取窗口内
+ * dist 被并发改动/不可读时返回 null，调用方按"无法证明新鲜"处理。
+ */
+export function computeDistFingerprint(distDir: string = DIST_DIR): string | null {
+  try {
+    return hashDistTree(distDir).sha256 as string;
+  } catch (err) {
+    console.warn(
+      `[global-setup] dist 内容指纹计算失败（TOCTOU 或不可读），保守判定为不新鲜: ${
+        err instanceof Error ? err.message : String(err)
+      }`,
+    );
+    return null;
+  }
+}
```

**改动 5 — `isDistFresh` 追加 dist 绑定校验 + 参数化（原 L139-156 整段替换）**

```diff
 /**
  * fresh 判定需要 dist 入口 + build-meta + sidecar 三者同时具备，且 sidecar 记录的指纹与
- * 当前现算指纹一致。`currentFingerprint` 为 `null`（指纹计算失败）时直接判不新鲜——
+ * 当前现算指纹一致，且 sidecar 记录的 distSha256 与当前现算的 dist 内容指纹一致
+ * （F274：后一条是本次修复新增的绑定校验，专门堵跨 worktree 假新鲜——即便
+ * inputsSha256 因 sidecar 跨 worktree 共享/同 commit 而"恰好匹配"，只要本 worktree
+ * 的 dist 实际内容与那次见证不同，就不会被判新鲜）。`currentFingerprint` 为
+ * `null`（指纹计算失败）时直接判不新鲜——
  * 无法证明新鲜就不能采信。任何一环缺失/不匹配都判不新鲜（宁可多建，不可漏建）。
  *
  * 关于 build-meta：...(原文保留不变)...
  */
-function isDistFresh(currentFingerprint: string | null): boolean {
-  if (currentFingerprint === null) return false;
-  if (!existsSync(DIST_CLI) || !existsSync(BUILD_META)) return false;
-  const sidecarFingerprint = readSidecarFingerprint();
-  return sidecarFingerprint !== null && sidecarFingerprint === currentFingerprint;
-}
+export function isDistFresh(
+  currentFingerprint: string | null,
+  opts: { distCli?: string; buildMeta?: string; sidecarPath?: string; distDir?: string } = {},
+): boolean {
+  const { distCli = DIST_CLI, buildMeta = BUILD_META, sidecarPath = TEST_INPUTS_SIDECAR, distDir = DIST_DIR } = opts;
+  if (currentFingerprint === null) return false;
+  if (!existsSync(distCli) || !existsSync(buildMeta)) return false;
+  const sidecar = readSidecar(sidecarPath);
+  if (sidecar === null || sidecar.inputsSha256 !== currentFingerprint) return false;
+  const currentDistFingerprint = computeDistFingerprint(distDir);
+  return currentDistFingerprint !== null && currentDistFingerprint === sidecar.distSha256;
+}
```

**改动 6 — `runBuild` 现算 dist 指纹并一并落盘（原 L204-214 内，`if` 分支替换）**

```diff
 function runBuild(fingerprintBeforeBuild: string | null): void {
   rmSync(TEST_INPUTS_SIDECAR, { force: true });
   execFileSync('npm', ['run', 'build'], { cwd: PROJECT_ROOT, stdio: 'inherit', timeout: 180_000 });
   // W1：只有构建后重算的指纹与构建前的快照完全一致才落盘 sidecar（见函数头注释）；
   // 不一致或重算失败（null）时保持"只删不写"，下次运行会因 sidecar 缺失继续重建。
   const fingerprintAfterBuild = computeInputsFingerprint();
   if (fingerprintAfterBuild !== null && fingerprintAfterBuild === fingerprintBeforeBuild) {
-    writeSidecar(fingerprintAfterBuild);
+    // F274：同时现算本次构建产出的 dist 内容指纹，绑定进 sidecar——不读取
+    // build-meta 里已算好的 distSha256（stampBuild 在非 git 环境会跳过盖章，
+    // 此时旧 meta 可能残留陈旧值），现算才是诚实证据源。计算失败（TOCTOU）时
+    // 同样保持"只删不写"，不落盘半绑定的 sidecar。
+    const distFingerprint = computeDistFingerprint();
+    if (distFingerprint !== null) {
+      writeSidecar(fingerprintAfterBuild, distFingerprint);
+    }
   }
   console.log('[global-setup] npm run build 完成');
 }
```

**不改动的部分（显式确认，防止 implement 阶段范围蔓延）**：
- `computeInputsFingerprint()`（原 L84-114）：逻辑与本次 bug 无关，保持私有、零改动。
- `setup()`/`onTestsRerun()`（原 L220-269）的调用顺序、日志文案、watch fail-loud/容错语义（W3/W4）：零改动，均以 `isDistFresh(snapshot)` 单参调用，走新签名的默认参数。
- `runBuild()` 的 C1"先删后写"时序（`rmSync` 仍在 `execFileSync` 之前）：零改动。
- `FULL_BUILD_INPUT_PATHS`/`sha256Hex`：零改动。

### 新增：`tests/integration/global-setup-cross-worktree-freshness.test.ts`

**测试意图**：在临时目录内构造"陈旧 dist + 匹配的 sidecar"场景，直接调用改造后的参数化函数，断言 `isDistFresh` 判不新鲜——这是本次修复的核心回归契约，若把 `isDistFresh` 还原成修复前的逻辑（只比对 `inputsSha256`），该用例必须转红。

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeDistFingerprint,
  readSidecar,
  writeSidecar,
  isDistFresh,
  deriveSidecarPath,
} from '../global-setup';

describe('global-setup 跨 worktree 假新鲜盲区回归测试（F274）', () => {
  let tmpRoot: string;
  let distDir: string;
  let distCli: string;
  let buildMeta: string;
  let sidecarPath: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'spectra-f274-'));
    distDir = join(tmpRoot, 'dist');
    mkdirSync(join(distDir, 'cli'), { recursive: true });
    distCli = join(distDir, 'cli', 'index.js');
    buildMeta = join(distDir, '.spectra-build-meta.json');
    writeFileSync(distCli, 'console.log(1);\n');
    writeFileSync(buildMeta, '{}');
    sidecarPath = join(tmpRoot, 'sidecar.json');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('复现 bug：inputsSha256 匹配但 dist 实际内容与 sidecar 绑定不同时判不新鲜', () => {
    const inputsFingerprint = 'fake-inputs-hash-shared-across-worktrees';
    const distHashAtWorktreeA = computeDistFingerprint(distDir);
    expect(distHashAtWorktreeA).not.toBeNull();
    writeSidecar(inputsFingerprint, distHashAtWorktreeA as string, sidecarPath);

    // 模拟 worktree B：checkout 到同一 commit（同 inputsFingerprint），
    // 但本地 dist 是另一次构建（内容不同）的陈旧产物。
    writeFileSync(distCli, 'console.log(2); // stale build from an older commit\n');

    const fresh = isDistFresh(inputsFingerprint, { distCli, buildMeta, sidecarPath, distDir });
    expect(fresh).toBe(false); // 修复前的旧逻辑只比对 inputsSha256，会误判 true
  });

  it('同 worktree 内 dist 与 sidecar 绑定一致时判新鲜（正常路径不受影响）', () => {
    const inputsFingerprint = 'fake-inputs-hash';
    const distHash = computeDistFingerprint(distDir);
    writeSidecar(inputsFingerprint, distHash as string, sidecarPath);
    expect(isDistFresh(inputsFingerprint, { distCli, buildMeta, sidecarPath, distDir })).toBe(true);
  });

  it('旧 schemaVersion 1 sidecar（无 distSha256）一律判不新鲜，强制重建', () => {
    writeFileSync(sidecarPath, JSON.stringify({ schemaVersion: 1, inputsSha256: 'x' }));
    expect(readSidecar(sidecarPath)).toBeNull();
    expect(isDistFresh('x', { distCli, buildMeta, sidecarPath, distDir })).toBe(false);
  });

  it('deriveSidecarPath 按 PROJECT_ROOT 分键，不同 worktree 产生不同文件名', () => {
    const pathA = deriveSidecarPath('/Users/x/worktree-a');
    const pathB = deriveSidecarPath('/Users/x/worktree-b');
    expect(pathA).not.toBe(pathB);
  });

  it('dist 目录为空/不存在时 computeDistFingerprint 仍返回确定性结果，不抛异常', () => {
    rmSync(distDir, { recursive: true, force: true });
    expect(() => computeDistFingerprint(distDir)).not.toThrow();
  });
});
```

**测试隔离说明**：全程只操作 `mkdtempSync` 创建的临时目录（`os.tmpdir()` 下），通过 `isDistFresh`/`writeSidecar`/`computeDistFingerprint` 的显式参数覆盖，不触碰本 worktree 真实的 `dist/`、`node_modules/.cache/`；`afterEach` 用 `rmSync(tmpRoot, { recursive: true, force: true })` 清理，测试用例间无共享可变状态。导入 `../global-setup` 只执行模块顶层的常量声明（无副作用的 `join`/`resolve` 调用），不会触发 `setup()`（该函数只在 vitest 把本文件当作 globalSetup 加载时才被调用）。

## 回归风险评估

### 必须逐字节不变（既有测试必须全绿）

| 路径 | 不变量 |
|------|--------|
| `computeInputsFingerprint()` | 零改动，输入指纹计算逻辑与本次修复无关 |
| `setup()`/`onTestsRerun()` 调用顺序与日志文案 | 零改动，`isDistFresh(snapshot)` 单参调用行为不变（走新签名默认参数） |
| `runBuild()` 的 C1 时序（`rmSync` 先于 `execFileSync`）、W1 前后指纹比对逻辑 | 零改动 |
| watch 模式 fail-loud/容错语义（W3/W4） | 零改动 |
| 单 worktree、无历史遗留 sidecar 场景下的首次构建/后续跳过判定 | 行为与改造前等价（多一重 distSha256 校验，但同 worktree 场景下该校验恒为真） |
| `tests/helpers/dist-cli-guard.ts` | 不改动，不消费 sidecar |

### 新增分支（仅"sidecar 记录的 distSha256 与当前 dist 实际内容不一致"时触发）

- `isDistFresh()` 第四重校验：现算 dist 指纹与 sidecar 绑定值比对，不一致则判不新鲜（这正是本次修复要新增的能力）。
- `writeSidecar()` 签名扩展：新增 `distSha256` 必填参数 + 遗留共享文件清理副作用（仅在写入真实默认路径时触发）。
- `TEST_INPUTS_SIDECAR` 路径变化：升级后所有 worktree 首次运行因"（新路径的）sidecar 不存在"触发一次强制重建（一次性成本，非回归，见 D2）。

### 风险点（按优先级排序）

1. **【中】升级后首次运行的一次性重建成本**：每个既存 worktree 首次跑本次修复后的版本，会因新 keyed 路径下 sidecar 不存在而强制重建一次。verify 阶段需在多个 worktree 各观测一次，如实记录这是预期的一次性成本，不得误判为性能回归；第二次及以后运行应恢复正常的"新鲜则跳过"路径。
2. **【中】`hashDistTree` 只遍历 `.js` 文件**：`dist/` 下非 `.js` 文件（如 `.d.ts`/`.json`/sourcemap）被篡改而 `.js` 不变时，本判据捕获不到。这是 `hashDistTree` 既有实现的设计边界（F176 版本门禁复用同一实现，非本次修复引入的新缺口），本次修复不扩大 `hashDistTree` 的覆盖面（避免 blast radius 扩大），如实记录为已知边界，不在本次修复范围内处理。
3. **【低】`computeDistFingerprint` 对空/不存在的 dist 目录返回确定性的"空树"指纹**（而非 `null`），不是"计算失败"路径。这在语义上是安全的（空树指纹大概率与 sidecar 记录的非空指纹不匹配，仍会判不新鲜，不会误判新鲜），但为避免歧义已在测试用例 5 显式覆盖并断言"不抛异常"。
4. **【低】遗留共享文件清理是 best-effort**（`rmSync(..., { force: true })`），清理失败不影响新逻辑正确性——旧文件即便残留也因 schemaVersion 不匹配/路径不再被读取而是死文件，非风险来源。

## 验证方案

### 验证命令

```bash
# 1. 聚焦新增回归测试
npx vitest run tests/integration/global-setup-cross-worktree-freshness.test.ts

# 2. 全量回归（含被 globalSetup 消费的全部测试套件，确认零失败）
npx vitest run

# 3. 类型检查
npm run build

# 4. 仓库同步校验（触及 tests/ 测试基础设施后）
npm run repo:check
```

### 验收标准（Acceptance Criteria）

- **AC-1**：新增回归测试用例 1（复现 bug）断言 `isDistFresh` 在"inputsSha256 匹配但 dist 实际内容与 sidecar 绑定不同"时返回 `false`——若把 `isDistFresh` 还原为修复前逻辑重跑该用例，必须转红（人工验证测试确实具备守护力，implement 阶段完成后须做一次此类变异验证）。
- **AC-2**：正常同 worktree 场景（用例 2）`isDistFresh` 仍返回 `true`，本次修复不误伤合法快路径。
- **AC-3**：旧 schemaVersion 1 sidecar 被安全拒绝（`readSidecar` 返回 `null`），不抛异常（用例 3）。
- **AC-4**：`deriveSidecarPath` 对不同 `PROJECT_ROOT` 产生不同文件名（用例 4）。
- **AC-5**：全量 `npx vitest run` 零失败，`npm run build` 零类型错误。
- **AC-6**：`setup()`/`onTestsRerun()`/`runBuild()` 的既有调用顺序、日志文案、C1/W1/W3/W4 语义未被改动（implement 阶段 diff 人工核对，不得出现这些既有代码块的删除/重排）。
- **AC-7**（真实场景复现，可选但推荐）：在另一个已 clone 本仓库的 worktree 中，用旧版 `tests/global-setup.ts`（改造前）构建一次得到旧共享 sidecar，切到本 worktree（改造后代码），确认首次运行判不新鲜并触发重建（而非误判新鲜跳过）——对齐 fix-report 的原始实证场景。

## 收尾（implement 阶段后）

- 本次修复不新增/不改动 spec（`tests/global-setup.ts` 文件头注释即 canonical 行为文档，已随实现同步，见改动 2）。
- implement 完成后建议更新 Claude memory，记录 F274 已修复"sidecar 跨 worktree 共享导致假新鲜"，并归档到与 F251/F272 相关的既有记忆条目群，便于后续同类"共享基础设施 + per-worktree 独立产物"场景排查时检索到本次修复。
- **门禁类改动提醒**：本文件是测试守护基础设施，失效即静默放行假绿，按 `CLAUDE.local.md` 归类为门禁类改动。当前处于 Codex 配额暂停期，implement/commit 阶段须按约定走异构对抗审查档位（独立子代理、至少 2 个不同切入角：如"绕过分键构造同名冲突"面 / "TOCTOU 窗口内 dist 被并发改动"面），并在 commit message 中显式标注"Codex 审查暂停，异构档位缺席"。plan 阶段不代为出具审查结论。
