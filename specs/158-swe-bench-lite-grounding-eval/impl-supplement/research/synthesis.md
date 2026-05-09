# Research Synthesis — Feature 158 SWE-Bench Grounding Eval

**汇总日期**: 2026-05-09
**输入**: product-research.md + tech-research.md
**目的**: 将产品+技术调研结论合并为 spec 阶段的输入约束，暴露冲突点和待澄清项。

---

## 1. 双方一致结论

| 主题 | 产品调研结论 | 技术调研结论 | 合并立场 |
|------|------------|------------|---------|
| 数据集来源 | SWE-Bench Lite + Multi-SWE-bench | HuggingFace `princeton-nlp/SWE-bench_Lite` 直接下载 | **采用 SWE-Bench Lite 子集**，Multi-SWE-bench 作为 P2 多语言扩展 |
| Docker harness | （未提）| 不用官方 Docker（67 GiB 镜像 + root 权限），改简化版功能 oracle | **不使用 Docker**，改用裸机 `pip install -e . + pytest FAIL_TO_PASS` |
| 任务规模 | 6-8 task（覆盖 2-3 语言）| 5-8 task | **6-8 task** 范围 |
| 统计可信度 | "pilot study"，不声称统计显著性 | "信号探测"，不能声称绝对 pass rate | **明确标注为探索性 pilot 评测**，不做统计显著性声明 |
| 报告呈现 | 在 §6 单独章节 | 独立报告 `specs/157-.../competitive-evaluation-report.md` | 报告独立成文，§6 仅在 147 报告上链接引用 |
| 风险：训练集泄漏 | 优先选 Spectra 自有 baseline 项目 | 优先选 2024 年以后 instance_id | 双方建议互补：**优先 2024+ instance + 验证 instance 不在常用训练集** |
| Token 效率指标 | 10k → 120 tokens 是独特卖点 | claude --print 不返回 token count（捕获难） | **token 数据需找替代来源**：MCP server 侧日志 / Spectra batch context size 静态测算 |

---

## 2. 双方冲突点（需 spec/clarify 决议）

### 冲突 1：语言覆盖范围

- **产品调研**：建议 TypeScript（hono）+ Python（micrograd/nanoGPT）+ Go 各 2-3 个，理由是 Multi-SWE-bench 已含这些语言
- **技术调研**：建议 **Python only**，理由是 Feature 155 graph 已含 Python adapter callSites（实际上 Feature 152/153/154 已分别完成 TS/Go/Java callSites，技术调研此处引用过时）
- **合并立场**：**MVP 锁定 Python only（5-8 task），多语言扩展列为 P2**
  - 理由：①（修正）虽然 Feature 152-154 已 ship 4 种语言 callSites，但 SWE-Bench Lite **官方只覆盖 Python**（Multi-SWE-bench 是独立数据集，需额外下载和适配），引入多语言会拉长 fixture 转换工时；② grounding lift 的核心 hypothesis 不依赖语言多样性，单一语言已能验证 hypothesis；③ $50 预算 + 2 周开发对单一语言更安全

### 冲突 2：第 4 对照组（baseline + Read/Grep）

- **产品调研**：建议 P2 future work，本次预算不够
- **技术调研**：未提（默认 3 组）
- **合并立场**：**MVP 不做第 4 组，但在 spec 中明确列入 Out-of-scope 并说明 future work**

### 冲突 3：Token cost 数据来源

- **产品调研**：把 token 效率作为硬数据呈现
- **技术调研**：claude --print 不返回 token count，标记 [需 spec/clarify 阶段决定]
- **合并立场**：**token 对比不依赖 claude --print 的 runtime token**，改用：
  - Group B (spec.md push)：静态测量 `cat module.spec.md | wc -c` × 4 (chars→tokens 估算)
  - Group C (MCP pull)：Spectra MCP server 侧日志记录每次 tool call 的 response payload size（实现成本低）+ Feature 155 design doc 中的 token 数据点引用
  - 这样 token 效率作为静态指标呈现，不依赖 claude CLI 的 runtime token 输出

---

## 3. 关键技术前置条件（spec 阶段必须验证）

| ID | 前置条件 | 验证方式 | 影响 |
|----|---------|---------|------|
| P1 | `claude --mcp-config <json>` flag 实际语法 | 本机 `claude --help \| grep mcp` | 决定 Group C 实施路径；如不可用，降级为 `.claude/mcp.json` 项目级配置 |
| P2 | Spectra MCP server `dist/mcp/index.js` 是否可独立 spawn | `node dist/mcp/index.js` 启动 + stdio 协议测试 | 决定 Group C 是否能稳定跑 |
| P3 | 选定 SWE-Bench Lite 任务的 `pip install -e . + pytest` 在裸机可执行 | 选 3 个候选 task 实测 | 决定 Oracle 简化方案的可行性 |
| P4 | Spectra graph 是否覆盖目标 SWE-Bench 仓库（如 sympy / astropy） | `npm run baseline:collect -- --target <target>` 验证 graph 非空 | 决定 Group B/C 是否有 grounding 数据可用 |

---

## 4. spec.md 必须包含的范围定义

### Must-have（P1，~2 周交付）

1. SWE-Bench Lite Python 子集 5-8 task fixture，单文件 / 简单 patch / FAIL_TO_PASS 可裸机执行
2. `scripts/eval-mcp-augmented.mjs` 独立脚本（import 复用 `eval-task-runner.mjs` 的导出函数）
3. 3 组对比：A (control) / B (spec-driver-spectra spec.md push) / C (mcp-augmented MCP pull)
4. Oracle：FAIL_TO_PASS + PASS_TO_PASS pytest 执行，退化方案 ast-diff
5. N=3 重复 × 5-8 task × 3 组 ≈ 45-72 runs
6. `competitive-evaluation-report.md` 独立报告，含 task pass rate 矩阵 + token cost 静态对比 + 结论
7. `scripts/verify-feature-158.mjs` 独立验收脚本（复用 verify-feature-156 pattern）
8. 在 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 加引用链接，指向 157 报告

### Out-of-scope（P2/Future）

1. 多语言扩展（Multi-SWE-bench TS/Go/Java task）
2. 第 4 对照组（baseline + Read/Grep 自由搜索）
3. 官方 SWE-Bench Docker harness 集成
4. 300 task 全量评测（需投入 $500+ 预算）
5. claude CLI runtime token count 解析（如需精确 token 对比，等 CLI 升级）

---

## 5. 风险整合（含缓解动作 owner）

| 风险 | 严重性 | 缓解动作 | Owner Phase |
|------|--------|---------|------------|
| `--mcp-config` flag 不存在 | 高 | 在 spec 阶段实测 + plan 阶段提供 fallback | spec / plan |
| Group C agent 不主动调 MCP tool | 高 | system prompt 加 mandatory instruction + 记录 tool call 次数 | plan / implement |
| pytest 系统依赖（C extension） | 中 | 严格筛选纯 Python 计算类（sympy / astropy） | implement |
| 5-8 task 统计功效不足 | 中 | 报告中明确"探索性信号"边界 | implement / verify |
| $50 预算超支 | 低 | dry-run 估算 + judge 调用上限 20 次 | implement |
| Spectra graph 未覆盖目标仓 | 中 | 每个 task 前置 `npm run baseline:collect` | implement |
| token cost 无法 runtime 捕获 | 中 | 改用静态测量（spec.md 字数 + MCP response payload） | plan |

---

## 6. 给 spec 阶段的明确指示

1. spec.md 必须包含 §"前置条件验证"章节，列出 P1-P4 4 个前置条件 + 验证手段
2. Functional Requirements 应区分：
   - FR-A: 数据集 / Fixture（SWE-Bench Lite 5-8 task）
   - FR-B: 评测脚本（eval-mcp-augmented.mjs）
   - FR-C: 3 组对比设计与执行
   - FR-D: Oracle（功能 + 退化）
   - FR-E: 报告（含 token 静态对比表）
   - FR-F: 验收脚本（verify-feature-158）
3. Edge Cases 至少覆盖：
   - SWE-Bench Lite task 在裸机 pytest fail（系统依赖缺失）
   - Group C agent 不调用 MCP tool（mandatory instruction 失败）
   - Spectra graph 缺失目标仓
   - --mcp-config flag 不存在
4. Success Criteria 必须可量化：
   - SC1: ≥ 5 个 task fixture 入库且 oracle PASS（裸机执行验证）
   - SC2: 3 组对比每组完成 ≥ N=3 重复（不卡死）
   - SC3: 报告含 pass rate 矩阵 + token static delta（≥ 1 行结论）
   - SC4: verify-feature-158 在 CI 环境 zero-failure

---

## 7. 调研产物总结

| 制品 | 路径 | 状态 |
|------|------|------|
| 产品调研 | `specs/158-swe-bench-lite-grounding-eval/impl-supplement/research/product-research.md` | ✅ 完成（含 6 处外部引用） |
| 技术调研 | `specs/158-swe-bench-lite-grounding-eval/impl-supplement/research/tech-research.md` | ✅ 完成（含 6 处外部引用 + 8 处代码 reference） |
| 调研汇总 | `specs/158-swe-bench-lite-grounding-eval/impl-supplement/research/synthesis.md` | ✅ 本文档（暴露 3 个冲突点 + 4 个前置条件 + 7 个风险） |
