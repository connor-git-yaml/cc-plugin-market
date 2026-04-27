# Spectra v4.0.0 → v4.x 修复路线图

> **来源**：Spectra v4.0.0 三方对比实测（micrograd + nanoGPT 双数据点）暴露的关键 bug
> **创建日期**：2026-04-27
> **状态**：Feature A 待启动 / Feature B、C 排期中

---

## 背景

v4.0.0 在中等规模项目（nanoGPT，15 文件 / 16,805 词）上的实测发现 11 类问题，覆盖三种性质：
- 🔴 P0 信任崩溃类：ADR hallucination、`--hyperedges` 完全无效、版本字符串回归
- 🟡 P1/P2 体验缺陷类：architecture-narrative template 化、`--include-docs` 半实现、graph.html 不一致、cost 治理
- 🟢 P3 架构演进类：抽象粒度只到模块文件级、缺少 EXTRACTED/INFERRED 内联标注

完整问题清单与证据见 `/tmp/spectra-v4-three-way-comparison-v2.md`，修复方案细节见 `/tmp/spectra-v4-improvement-plan.md`。

---

## 三个 Feature 的范围与节奏

### Feature A — `135-fix-v4-trust-restoration`（v4.0.1 hotfix）

**模式**：`/spec-driver-fix`（4 阶段快速通道）
**工作量**：5-7 人天
**紧急度**：🔴 立即启动

**修复范围**：
1. **ADR pipeline hallucination**：临时禁用默认 ADR 生成；引入 `--enable-adr` 显式开关；为 v4.1 evidence-binding 改造留出接口
2. **`--hyperedges` flag 无效**：CLI 接受时打印 WARNING（fail-loud），并在 batch summary 标注 hyperedges 提取阶段未连通；不假装成功
3. **`generatedBy: spectra v3.0` 版本字符串回归**：建立单一 source-of-truth（统一从 `package.json.version` 读取），lint 规则禁止硬编码版本字面量
4. **Reading mode 文档修正**：`--help` 文字 + CHANGELOG 明确 `reading` 不跳过模块级 LLM；`--mode code-only` 才是真正"快速浏览"

**交付物**：
- `plugins/spectra/` 内修复代码
- 4 类 fixture snapshot 测试（CI 中跨项目断言 ADR 标题集合 distinct）
- v4.0.1 release notes

---

### Feature B — `136-spectra-doc-pipeline-quality`（v4.1.0）

**模式**：`/spec-driver-feature`（完整 5 阶段）
**工作量**：15-20 人天
**紧急度**：🟡 v4.0.1 release 后启动

**范围**：
- ADR pipeline 真正重构：evidence-binding + fail-closed
- `--hyperedges` 数据流补齐 + 集成测试（与 Feature 131 已建的 schema 对接）
- architecture-narrative 重写：基于 module spec 综合，删除 template 化表格
- `--include-docs` 路径打通：README 进入 architecture-narrative 上下文
- graph.html batch 中始终生成（fail-loud 跳过原因）
- 空文件短路 + cost 治理（`--context-budget` + cost breakdown）

**前置依赖**：Feature A 已合入 master

---

### Feature C — `137-spectra-symbol-graph`（v4.2.0）

**模式**：`/spec-driver-feature`（重 research 阶段）
**工作量**：20-25 人天
**紧急度**：🟢 季度规划

**范围**：
- AST 节点（class/function 级）接入 graph.json
- 图节点 kind 扩展：`module|class|function|doc`
- God Nodes 算法重算（symbol 度数）
- spec 内 EXTRACTED/INFERRED 内联标注

**前置依赖**：
- Feature B 已合入
- 调研 graph schema migration 对 MCP / direction-audit / community 算法的影响
- 评估 graph.json 体积膨胀（symbol 级节点会从 ~10 涨到 ~100-1000）

---

## 跨切关注点（贯穿三 Feature）

1. **fixture 项目集**：Feature A 阶段建立（micrograd + nanoGPT + 中型 TS 项目 + 空项目）；Feature B/C 复用
2. **CI snapshot 测试**：跨项目隔离断言（ADR 标题集合 distinct 率 = 100%）
3. **`spectra audit` 子命令**（Feature B 引入）：自审 specs/ 是否合规

---

## 节奏与风险

| 节点 | 时间 | 关键风险 |
|------|------|---------|
| Feature A 启动 | 立即 | 无 |
| v4.0.1 release | 1-2 周 | 用户对 v4 信任的窗口期 |
| Feature B 启动 | v4.0.1 后 | Feature 131 schema 与 Feature B 数据流的兼容性 |
| Feature C 调研启动 | v4.1 release 后 | symbol-level graph 是否值得做（需评估与 Graphify 范畴差距是否需要追平）|

---

*本路线图随实施过程修订；每个 Feature 启动后以其自己的 spec.md 为准。*
