# Phase 4c 验证闭环报告（verify 子代理产出 + 主编排器修复重验收口）

## 第一轮（verify 子代理实跑，2026-08-04）

### 工具链验证结果表

| 命令 | 结果 | 关键计数 | 耗时 |
|------|------|---------|------|
| `npx vitest run`（全量） | ❌ FAIL | 6964 passed / **9 failed**（1 file failed） | 63.4s |
| 隔离重跑 `tests/e2e/f220-decomposition-charter.e2e.test.ts` | ❌ FAIL（稳定复现，非 flaky） | 3 passed / 9 failed | 7.8s |
| 新增用例（file-scanner + 一致性集成） | ✅ PASS | 34 passed | 0.68s |
| `npm run build` | ✅ PASS | tsc 零错误 | ~5s |
| `npm run repo:check` | ✅ PASS（exit 0） | 仅预存 graph stale warn（本地旧图，与本卡无关） | ~10s |
| `release:check` | ⏭️ 跳过 | 未触及 release contract / plugin / marketplace 面 | — |

### 第一轮总结论：CRITICAL（阻断项 1）

**根因（plan/tasks 未覆盖的遗漏）**：`BEHAVIOR_VERSION` 1→2 的下游消费面除护栏 pinned 资产外，还有 `tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap`（F249 提交中最后写入，含 9 处硬编码 `behaviorVersion: 1` 冻结字面量）。9 处失败 diff 逐一核对**均只有 behaviorVersion 一行差异**，是纯"遗漏更新 pinned 快照"，非行为 bug。

**流程审计发现**：4b 报告的"全量回归 4124 通过"只覆盖 `tests/unit` 子集未含 `tests/e2e`，"全量"措辞有误导性——4a/4b 因此均未捕获该遗漏；[Spec 合规] 复核降级为 WARNING（plan「同步更新清单」范围界定不足），[代码质量] 对核心实现的结论维持（34/34 + self-host 零断言改动实证支持）。

## 修复重验（主编排器执行）

**修法**：按快照测试文件自带维护合同（F223/F232 先例："`.snap` 做外科式定点替换字面量，**严禁 `vitest -u`**"）对 9 处 `"behaviorVersion": 1,` 外科式替换为 `2`；diff 恰好 ±9 行。全仓扫描确认 guardrail 资产之外**再无**其他 behaviorVersion 冻结面（`grep -rln behaviorVersion tests/ --include=*.snap --include=*.json`）。

**降级通道记录**：本项属原 implement Task 范围内的联动同步遗漏；该 Task 因 API 断连（Connection closed mid-response）在收尾复验时失败（失败证据在主 transcript），主编排器按委派硬约束的唯一降级通道 inline 完成本项收尾。

### 重验结果（主编排器实跑留证）

| 命令 | 结果 | 关键计数 |
|------|------|---------|
| `npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts` | ✅ PASS | 12 passed（9 失败全部转绿） |
| `npx vitest run`（全量，T016） | ✅ **PASS** | **517 files passed / 6973 tests passed / 0 failed**（18 skipped / 21 todo 均预存） |
| `npm run build` | ✅ PASS | tsc 零错误 |
| `npm run repo:check`（T017） | ✅ PASS（exit 0） | 全规则 pass |

### Dogfood 端到端实证（超出最低验证面的加固证据）

- `spectra batch --mode graph-only` 重建本 worktree 图（7414 节点 / 12473 边 / 5.2s）
- 新图 `graph.graph.fingerprint.behaviorVersion === 2`（指纹链真实落盘）
- `repo:check` 的 `graph-quality:freshness` 由重建前的 stale warning 转 **pass**（F249 指纹机制 + 本卡 bump 端到端工作）
- 图内无 `graph-quality-{java,go}/generated` 节点（嵌套 `.gitignore` 覆盖路径；磁盘上 stub 本就不存在，符合 F249 残留 ④ 现状认知）

## 验证证据核查（fix 合同完备性）

| 项 | 状态 |
|---|------|
| fix-report「同步更新清单」四项 | ✅ 全部落地（BEHAVIOR_VERSION bump / 护栏资产再生 / 新增测试 34 用例 / 注释矫正零残留）+ 追加第五项：charter e2e 快照 9 处外科替换 |
| 先红后绿证据 | ✅ 主线程 A/B stash 红测：旧实现下一致性集成测试 2/3 失败（失败断言 = "sub/foo.go 采集面 true vs dirty 观测面 false"，正是漏报本体）；修复后 3/3 绿 |
| 4a WARNING（T016-T018 收尾留证） | T016/T017 本轮闭合（上表）；T018 对抗审查随后执行 |
| 改动面核对 | ✅ 无 plan 清单外意外文件（快照替换已作为清单追加项记录） |

## 最终结论

**[Spec 合规]**: PASS（第一轮 WARNING 项——同步清单范围遗漏——已修复并留证）
**[代码质量]**: PASS（0 CRITICAL / 0 WARNING / 2 INFO：降级不对称已登记 fix-report 已知边界；file-scanner 行数观察项不处理）
**工具链**: PASS（全量 vitest 6973/0 + build 零错误 + repo:check exit 0）

**总结论：PASS**（待 T018 提交前对抗审查后进入 commit）

## Rebase 后重验补录（F250-F254 基座，2026-08-04）

master 交付窗口内前移 7 commit（详见 fix-report「Rebase 合并适配」节）。重编 F255 + rebase 后：

| 命令 | 结果 | 关键计数 |
|------|------|---------|
| `npm run fixtures:regen:collector-fingerprint` | ✅ 判"无需更新" | 合并资产与新基座重建逐字节一致（含 F250 `.pyi` 新 surface + 本卡 behaviorVersion 2） |
| `npx vitest run src/batch/generic-language-skeleton-collector.test.ts`（F253 相撞适配后） | ✅ PASS | 12 passed（适配前 6 failed） |
| `npx vitest run`（全量） | ✅ PASS | **522 files / 7110 tests 零失败**（18 skipped / 21 todo 预存） |
| `npm run build` | ✅ PASS | tsc 零错误 |
| `npm run repo:check` | ✅ PASS（exit 0） | graph-only 重建（7501 节点）后含 freshness 全 pass；重建前 warning 精确报 `collector-fingerprint` stale——bump 作废旧图的端到端自证 |

F253 相撞适配的 delta 自查（内部对抗视角）：翻转断言均带 `git ls-files --error-unmatch` tracked 前置守卫（样本被移出追踪时 fail-loud，防正向断言静默倒挂回旧语义）；新增临时仓库用例带 `check-ignore` 前置守卫 + F253 原始精确计数（5/4）恢复；`vendor/`/`build/` 内置目录剪枝断言保持 false 方向不变（tracked 无关性显式化）。
