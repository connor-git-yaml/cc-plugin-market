---
feature: 209-fix-dataset-build-test-venv-flaky
mode: fix
phase: plan
based_on: fix-report.md
---

# 修复规划 — F209 dataset-build 单测 venv 环境耦合 flaky

## 修复方案（方案 A：测试注入不存在的 `--venv` 路径）

不改动生产源码（`scripts/lib/swebench-dataset-build.mjs` 的 `--venv` 参数为 F187 既有能力，L117-121），仅修改测试文件 `tests/unit/feature-187-dataset-build.test.ts` 中"单一一致标签"用例（L105-113），让 `spawnSync` 显式传入一个挂在 `mkdtemp` 临时目录下、任何机器上都必然不存在的 `--venv` 路径，使 fetch 阶段的失败路径不再依赖"本机是否存在 `scripts/.swebench-venv`"这一环境假设。

### 行级 diff 预期

```diff
   it('单一一致标签 → 通过标签推导守卫（不报标签错），继续走 fetch（datasetName 已透传，非默认 Lite 由 datasetTagToHfId 保证）', () => {
     const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w1-cli-'));
     const v = writeFixture(dir, 'v.json', 'verified');
-    // 无 venv → fetch 阶段失败（非 0），但绝不应命中 W-1 守卫的"标签不一致"/"未知 dataset tag"分支
-    const res = spawnSync('node', [BUILDER_CLI, '--fixture', v, '--out', path.join(dir, 'out.json')], { encoding: 'utf-8' });
+    // 显式注入不存在的 --venv 路径（挂在本用例专属 mkdtemp 临时目录下，避免依赖本机是否存在
+    // scripts/.swebench-venv 这一环境状态，见 F209 fix-report）→ fetch 阶段快速失败（非 0），
+    // 但绝不应命中 W-1 守卫的"标签不一致"/"未知 dataset tag"分支
+    const venvPath = path.join(dir, 'nonexistent-venv');
+    const res = spawnSync(
+      'node',
+      [BUILDER_CLI, '--fixture', v, '--out', path.join(dir, 'out.json'), '--venv', venvPath],
+      { encoding: 'utf-8' },
+    );
     expect(res.status).not.toBe(0); // fetch 失败（venv 不存在）
     expect(res.stderr).not.toMatch(/dataset 标签不一致/);
     expect(res.stderr).not.toMatch(/未知 dataset tag/);
   });
```

- `venvPath` 复用该用例已有的 `dir`（`fs.mkdtempSync` 生成，本用例独占，测试结束不清理是既有模式的既定行为，不新增变更面），追加子路径 `nonexistent-venv` 保证任何机器上必然不存在（比硬编码 `/nonexistent` 更稳妥，规避极端情况下该绝对路径真实存在或权限异常）。
- 同步修正 L108 注释，去掉"无 venv → fetch 阶段失败"的环境假设表述，改为说明"显式注入不存在的 --venv"。
- L110 注释同步由"（无 venv）"改为"（venv 不存在）"，保持语义准确（原注释暗示环境天然无 venv，现在是主动构造）。

## 变更清单

| 文件 | 改动类型 | 范围 |
|------|---------|------|
| `tests/unit/feature-187-dataset-build.test.ts` | 修改 | L105-113 内，新增 1 行局部变量 + spawnSync 调用追加 `--venv` 参数 2 项 + 2 处注释文案调整 |

无生产源码改动、无 spec 改动、无文档改动（fix-report.md 已确认）。

## 回归风险评估

**风险等级：低**

理由：

1. **改动面极小且已实测验证**：仅 1 个测试文件的 1 个用例，改动限于 spawnSync 调用参数追加与注释文案，不涉及任何生产代码路径。fix-report.md 中已在本 worktree 手跑验证：传入不存在的 `--venv` 路径后，CLI 0.026s 快速失败（exit=1，`fetchOfficialRows` 因 python ENOENT 抛出未捕获异常），远低于 unit project 默认 5000ms 超时。
2. **不改变被验证的行为语义**：
   - `expect(res.status).not.toBe(0)` — 不存在的 venv 同样导致非 0 exit（ENOENT → uncaught throw），断言保持成立。
   - `expect(res.stderr).not.toMatch(/dataset 标签不一致/)` 与 `expect(res.stderr).not.toMatch(/未知 dataset tag/)` — 已实测 stderr 内容为 `swebench_fetch_rows.py 失败 (status=null)`，不含这两个字符串，两个反向断言均满足。
   - 用例的测试目的（验证 W-1 标签推导守卫在单一一致标签下放行、不拦截）未变：错误来自 fetch 阶段本身即证明已越过 W-1 守卫。
3. **不影响同文件其他用例**：
   - L88-95（混合标签）与 L97-103（未知标签）两个用例在 CLI 到达 fetch 阶段前已 `exit 2`（分别在 L131、L139），不涉及 venv 路径解析，本次改动不触碰这两处，且 fix-report.md 已确认其"安全"结论。
   - 库函数级用例（L44-84，`buildLocalDataset` 直接调用 + 注入 `fetchRows`）与 CLI 子进程完全隔离，不受影响。
4. **不影响生产脚本**：`--venv` 为既有 CLI 参数（F187 原生能力），未改动 `swebench-dataset-build.mjs` 任何一行；`scripts/swe-bench-verified-cohort-batch.mjs` 等生产脚本对默认 venv 路径的依赖不变。
5. **潜在低概率残留风险**：若目标机器上 `dir/nonexistent-venv` 因极端情况被并发进程创建为真实目录（几乎不可能，`mkdtemp` 生成的目录本身具备唯一性，子路径进一步降低碰撞概率），fetch 仍会走真 venv 路径。此风险与原方案相比已大幅降低（原方案依赖"整个仓库根下是否存在 `scripts/.swebench-venv`"这一持久化环境状态，新方案依赖"临时目录下随机子路径是否被并发抢占"这一近乎为零的概率事件），可接受。

## 验证方案

### 命令与预期结果

1. **隔离跑目标测试文件**（确认改动后功能正确）：
   ```bash
   npx vitest run tests/unit/feature-187-dataset-build.test.ts
   ```
   预期：全部用例通过（4 个 describe 块，共 8 个 it），且"单一一致标签"用例耗时应从原先 ~4.1s 降至 <100ms 量级（可从 vitest 输出的单测耗时中直接观察验证 flaky 已消除）。

2. **全量单测跑**（验证零回归 + 提交前置门槛）：
   ```bash
   npx vitest run
   ```
   预期：零失败。重点关注该测试文件在全量并行场景下不再因超时失败（此前 flaky 场景的复现条件）。

3. **构建校验**：
   ```bash
   npm run build
   ```
   预期：零类型错误（本次改动为 `.test.ts` 内的纯逻辑调整，不触及类型定义，理论上不影响构建，仍按规范跑一遍）。

### 如何证明 flaky 已消除

- **根因层面**：修复后该用例不再依赖"本机是否存在 `scripts/.swebench-venv`"这一环境状态（root cause chain 中的关键环节），而是每次运行都注入进程独占、必然不存在的临时路径 → fetch 失败路径变为确定性触发，不再有"真调 venv python + HF datasets"的分支可能。
- **耗时层面**：fix-report.md 已实测新路径耗时 0.026s（≈160x 于原 4.1s），大幅低于 5000ms 默认超时阈值，即使在全量并行 CPU 争抢场景下也有充分安全余量，不会重现"隔离跑 4.1s 险过、全量并行超时失败"的现象。
- **验证覆盖两种场景**：隔离跑（验证功能正确性 + 耗时量级）与全量跑（验证并行场景下不再超时，即原 flaky 复现条件）两者都过，可判定 flaky 已消除。若本机存在 `scripts/.swebench-venv`（如本 worktree 报告场景），也应重新确认该场景下改动后耗时同样落在毫秒级（因为改动后不再读默认 venvPath，与本机是否存在该目录无关）。

## 不涉及事项（与 fix-report.md 一致）

- 不更新 spec：本修复不改变 W-1 守卫行为语义（`datasetTagToHfId` 映射、混合标签禁止、未知标签报错均不动），仅调整测试的失败路径注入方式。
- 不评估方案 B（CLI 增加 `SWEBENCH_VENV` 环境变量）与方案 C（mock fetch）：均已在 fix-report.md 中因"扩大生产面"被否决，方案 A 零源码改动已是最小修复。
