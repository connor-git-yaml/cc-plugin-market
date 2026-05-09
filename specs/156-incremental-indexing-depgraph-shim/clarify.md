# Feature 156 — Clarify

## 1. 关键澄清问题（plan 阶段之前必须解决）

### Q1：snapshot 写盘格式（OQ-5）
**问题**：self-dogfood 场景 snapshot 预估 500 KB–1 MB，写盘格式影响 incremental 路径每次的 parse/stringify 延迟，直接关系到 < 30 秒 AC 能否达成。
**候选答案**：
- A. pretty JSON（调试友好，每次读写约 10–30 ms for 1 MB，negligible）
- B. minified JSON（减少 30–40% 体积，同量级延迟）
- C. gzip 压缩（500 KB → ~50 KB，但 Node.js decompress 开销约 5–20 ms，调试不友好）
**推荐**：A — pretty JSON
**理由**：1 MB JSON 在 Node.js 中 parse/stringify < 50 ms，远低于 30 秒门槛，调试和 code review 友好，无需引入 gzip 复杂度。minified 节省的空间意义不大（单机本地文件）。

---

### Q2：snapshot 是否裁剪 symbol 节点（OQ-1）
**问题**：裁剪 symbol 节点（只持久化 `kind === 'module' | 'package' | 'component'`）可将 snapshot 从 ~1 MB 降到 ~100 KB，但 incremental caller expansion 依赖 `calls` 边（symbol → symbol），若裁剪则 caller expansion 只能感知模块级 caller，无法追踪 symbol 级调用链。
**候选答案**：
- A. 不裁剪：snapshot 含完整 UnifiedGraph（含 symbol 节点），caller expansion 可精确到 symbol 粒度
- B. 裁剪：仅持久化 module/package/component 节点，symbol 级 `calls` 边丢弃；caller expansion 退化为模块级
- C. 两套 snapshot：完整版用于 caller expansion，精简版用于快速加载（过度设计）
**推荐**：A — 不裁剪
**理由**：裁剪后 G-5（full vs incremental 边一致性）在 `calls` 边上无法验证（AC-3a/3b 失败）。snapshot 大小问题已由 Q1 结论（pretty JSON + < 50 ms parse）接受，无需引入裁剪复杂度。

---

### Q3：caller expansion 深度是否参数化（OQ-2 / OQ-6）
**问题**：固定深度 1 vs 传递闭包 vs 参数化。影响 incremental.ts 接口设计和 FR-7 的实现复杂度。
**候选答案**：
- A. 固定深度 1，不参数化（spec 当前推荐）
- B. 固定深度 1，但支持 `--caller-depth N` flag 以便未来扩展
- C. 默认深度 1，传递闭包作为可选模式（`--caller-depth=transitive`）
**推荐**：B — 固定默认深度 1 + 预留 `--caller-depth` flag（默认值 = 1）
**理由**：A 不留扩展接口，未来加参数要改 CLI 签名。C 的传递闭包在 self-dogfood 高扇出场景下风险未量化（EC-1）。B 是 YAGNI 边界内的最小设计：接口稳定、行为固定、不增加实现复杂度。

---

### Q4：git hook 安装策略的范围边界
**问题**：FR-15/16 把 post-commit hook 标为 MAY（可选），但没有说明安装入口在哪（CLI 子命令 vs README 手动步骤 vs npm postinstall），影响 plan 阶段任务分解。
**候选答案**：
- A. 只提供 `plugins/spectra/hooks/post-commit.sh` 脚本文件，用户手动 copy 到 `.git/hooks/`，README 说明
- B. 新增 `spectra index --install-hook` 子命令，检测冲突后自动安装
- C. npm `postinstall` 自动安装（非破坏性，检测冲突跳过）
**推荐**：A — 只提供脚本文件 + README
**理由**：本 Feature 核心交付是 incremental indexing + DependencyGraph shim，hook 是锦上添花；A 的实现成本最低，不引入新 CLI 命令，不在用户机器上做隐式操作。B/C 均超出本 Feature YAGNI 边界。

---

### Q5：FR-27 atomic switch 是否允许拆分为两个 commit
**问题**：风险 A 缓解步骤 1–5 隐含一个"先有过渡 helper 再删"的序列，但 FR-27 要求"同一 PR/commit 内 DependencyGraph 引用清零"。若 17 个 consumer 改造不能一次性完成，atomic switch 约束与分步迁移实际操作存在张力。
**候选答案**：
- A. 严格执行：所有 consumer 改造必须在单一 commit 内完成，helper 函数当次同时删除
- B. 宽松执行：允许分为"改造 commit（含私有 helper）+ 删除 helper commit"两个提交，但必须在同一 PR 内（history 不出现 DependencyGraph public export 残留）
- C. 完全分步：每个 consumer 独立 commit（会存在过渡期 DependencyGraph public export）
**推荐**：B — 同一 PR 内两个提交
**理由**：C 违反 NG-7 和 FR-27；A 在 17 个 consumer 改造时回滚风险高（单个大 commit 难以 debug）。B 在 PR merge 前保证 master 上 DependencyGraph 引用清零，且每步可独立验证，是工程可行的最低风险选择。

---

## 2. 可推迟问题（plan 阶段决议）

- [defer-to-plan] Q-D1：`spectra index --watch` 的 chokidar 防抖时间窗口（debounce interval）取多少？影响 FR-12 的边界行为但不影响 spec WHAT 定义。
- [defer-to-plan] Q-D2：EC-7 snapshot 大文件流式写入策略——是否用 `fs.createWriteStream` 替代 `fs.writeFileSync` 降低内存峰值？只在 plan 阶段确认 benchmark 后决策。
- [defer-to-plan] Q-D3：AC-11 baseline 采集的 fixture 文件放在哪里（`tests/fixtures/ts-import-scenarios/`？）以及是否入库？与 CLAUDE.local.md 的"truth-set fixture 不入库"原则需对齐。
- [defer-to-plan] Q-D4：EC-10 shallow clone 降级时，全量 hash stale 检测的并发度（并行 hash 计算还是串行）？影响 CI 性能但不影响正确性。
- [defer-to-plan] Q-D5：`verify-feature-156.mjs` 脚本的调用方式是否加入 `npm run` scripts？影响 CI 集成，plan 阶段确认。

---

## 3. clarify 阶段决议（无需用户介入）

1. **OQ-5 写盘格式**：采用 pretty JSON（Q1 推荐 A），plan 阶段不再重复讨论。
2. **OQ-1 symbol 节点裁剪**：不裁剪（Q2 推荐 A），snapshot 保留完整 UnifiedGraph。
3. **OQ-2 / OQ-6 caller 深度**：默认深度 1 + 预留 `--caller-depth` flag（Q3 推荐 B），传递闭包不在本 Feature 范围。
4. **git hook 安装**：只提供脚本 + README 说明（Q4 推荐 A），不新增 CLI 子命令。
5. **FR-27 atomic switch**：允许"改造 commit + 删 helper commit"两步，但必须同 PR 内（Q5 推荐 B）。
