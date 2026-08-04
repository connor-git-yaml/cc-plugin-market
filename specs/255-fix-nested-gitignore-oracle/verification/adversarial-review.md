# T018 提交前对抗审查记录（F255）

## Codex 通道状态

- 已实际发起 `codex:codex-rescue` 后台任务 task-mse38l19-vhs9y6（2026-08-04）
- 任务 26s 后 failed：`You've hit your usage limit … try again at Aug 8th, 2026 1:53 PM`（ChatGPT 周配额耗尽，与 F249/F251 记录一致）
- 按 F249/F251 先例降级为**内部对抗复审**（主线程实跑反例构造，非纸面推演）；Codex 配额恢复后如需可对本卡补跑交叉验证

## 内部对抗复审（多轮视角）

### 第 1 轮：语义同向性攻击（实跑探针 adversarial-probes.mts，6/6 PASS）

| 探针 | 构造 | 结果 |
|------|------|------|
| P-a negation 重包含 | 根 `*.log` + 嵌套 `!keep.log` | filter=false 且 status 可见（同向收录）；对照 drop.log 两侧同隐 ✓ |
| P-b 排除父目录内 negation 无效 | 根 `gen/` + `gen/.gitignore` `!keep.go` | 两侧同判不可见（git"父目录被排除不可重包含"规则同源生效）✓ |
| P-c `.git/info/exclude` | exclude 写 `*.secret` | filter=true 且 status 盲（同向忽略）；对照 b.go 同向可见 ✓ |
| P-d 大小写变体 | 嵌套 `*.go` vs `FOO.GO` | 两侧同向（macOS ignorecase 下同判忽略；同引擎必同向，不预设方向）✓ |
| P-e 空仓库（无 commit） | git init 后不 commit | 不崩且规则生效（freshness 侧本就 unknown-provenance 短路，无错配面）✓ |
| P-f walkBase 不存在 | 传入不存在目录 | execFileSync cwd ENOENT → 回退根解析，不崩 ✓ |

### 第 2 轮：消费面完备性攻击

- 全仓扫描 `behaviorVersion` 字面量（src/scripts/docs/plugins + tests 的 .snap/.json）：除 guardrail 两份资产与 charter e2e 快照（均已联动更新）外**无第三冻结面**
- `tests/fixtures/micrograd-baseline-graph/graph.json`（F215 pinned）无 fingerprint 字段（pre-F249 fixture），其消费测试不走 evaluateFreshness——全量 vitest 6973/0 佐证

### 第 3 轮：既有审查链回收

- 4a spec-review（PASS 0C/1W/1I）：WARNING（T016-T018 留证）已闭合
- 4b quality-review（PASS 0C/0W/2I）：INFO-1 降级不对称已登记 fix-report 已知边界；INFO-2 行数观察项不处理
- 4c verify（第一轮 CRITICAL）：charter 快照 9 处 behaviorVersion 冻结字面量遗漏——已按 F223/F232 外科式替换先例修复，全量重验 6973/0；同时修正 4b"全量"措辞误导的流程教训（审查报告须标注测试子集范围）

## 结论

- CRITICAL：1（4c 发现，已修复重验闭合）
- WARNING：1（4a 收尾留证，已闭合）
- INFO：3（1 采纳登记、2 记录不处理）
- 内部对抗复审新发现：0 CRITICAL / 0 WARNING

**处置完毕，进入 commit。**

## Delta 轮：rebase 适配改动复审（2026-08-04）

适配改动面 = `src/batch/generic-language-skeleton-collector.test.ts` 单文件（F253 相撞收敛）。对抗自查：

- **翻转断言的倒挂风险**：两处正向断言（StubOnly.java / stub.go 被采集）若样本未来被移出 git 追踪，会静默变成"untracked 却断言被采集"→ 已配 `git ls-files --error-unmatch` tracked 前置守卫 fail-loud
- **新增 temp-repo 用例假绿风险**：staging 后若 cpSync 失败/fixture 空目录，`check-ignore` 前置守卫与存在性守卫会先红；计数断言（5/4）非空洞
- **`git init` 依赖**：与 file-scanner 新用例同构（本地 git config，CI 自足）；afterEach 清理对称
- **未触碰生产代码**：`git diff` 确认适配仅测试文件 + specs 制品
- 结论：0 CRITICAL / 0 WARNING
