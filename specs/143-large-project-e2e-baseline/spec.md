# Feature 143: 大型项目 E2E 基线测量

> **Spectra Phase 3 启动的第一步：在真实大型开源项目上建立性能、成本、质量基线，定位瓶颈，为 Phase 3 Wave 2 优化提供数据支撑。**

**Feature ID**: 143  
**Milestone**: M-103 Phase 3 — Large-Scale Reliability & AI-Native Output  
**Wave**: Wave 1（第一批，可立即启动）  
**类型**: 研究/测量（不写实现代码）  
**状态**: 🔵 Spec 已定稿，等待实施  
**创建日期**: 2026-04-29  

---

## 1. 背景与触发

### 1.1 问题陈述

Spectra v4.0.0 的所有性能验证都在小型项目上完成：
- karpathy/micrograd：6 文件，200 LOC，耗时 361s（约 6 分钟）
- 本仓库 dogfood：~125 个 Feature spec，TypeScript

M-101 Postmortem L4 教训明确指出：**"性能目标定 SC 时必须区分项目规模"**。F5 的 "5 模块 < 120s" 目标在实际 21 模块项目上已经不成立，在 500+ 文件项目上的性能完全未知。

**核心问题**：Spectra 在真实大型项目（500+ 文件）上：
- 耗时是多少分钟？
- Token 总成本是多少（$）？
- graph.json 会膨胀到多大？
- 哪个阶段是瓶颈（LLM 串行调用 / graph 构建 / embedding cache）？

没有基线数据，就无法制定有意义的优化目标（Phase 3 F145）。

### 1.2 与 Phase 3 目标的关联

Feature 143 产出的基线报告是 **Phase 3 Wave 2 优化决策的唯一数据基础**：
- F145（LLM 并发优化）的并发数选择依赖基线的"LLM 调用时间占比"数据
- Wave 2 的"graph 分层存储"是否必要，依赖基线的"graph.json 规模"数据
- Phase 3 的 Success Metrics（< 20 分钟，< $2.00）需基线对比才能验证改进幅度

---

## 2. Scope

### 2.1 In Scope

1. **选择 2 个目标项目**（见 §4 候选列表），满足：
   - 至少 1 个 TypeScript/JavaScript 项目（500+ 文件，Spectra 支持 AST 提取）
   - 至少 1 个 Python 项目（500+ 文件，测量 Python AST patch 完成后的基线 OR 记录当前限制）

2. **对每个项目完整运行 Spectra batch（full mode）**：
   - 使用 `--mode full`（产出 7 类文档 + spec + graph）
   - 使用 `claude-sonnet-4-6`（对齐 Phase 2 postmortem 的 model 决策）
   - 使用 `--dry-run` 先预估，再实跑，记录偏差

3. **收集并记录以下数据**：

   | 数据维度 | 来源 |
   |---------|------|
   | 总耗时（wall time）| `date` 命令前后 |
   | LLM 调用次数 + 各次耗时 | batch-summary.md + log 输出 |
   | Token 总量（input / output / cache）| batch-summary.md frontmatter |
   | graph.json 规模（节点数 / 边数 / 文件大小）| `wc -c` + jq |
   | spec.md 生成成功率（成功 / 跳过 / 报错）| batch-summary.md |
   | 各阶段耗时占比（spec生成 / graph构建 / 文档生成）| log timestamp 分析 |
   | memory 峰值（如能采集）| `time` 命令或 `/usr/bin/time -v` |

4. **写 2 份产物文档**（见 §5）

### 2.2 Out of Scope

- **不修改任何 Spectra 源代码**（这是测量，不是修复）
- **不分析质量维度**（spec.md 内容是否准确）—— 那是 Phase 3 Wave 2 的工作
- **不对比 Graphify 或 LLM Agent**（Phase 2 已有三方对比报告，无需重复）
- **不在 CI 跑**（这是一次性探索性测量，不是 regression test）

---

## 3. 成功标准

| SC | 标准 | 测量方式 |
|----|------|---------|
| SC-001 | 2 个项目各完成至少 1 次完整 full-mode batch | `ls specs/*/` 确认产物存在 |
| SC-002 | `perf-baseline-report.md` 包含 §5.1 的所有数据维度 | 文档字段完整性检查 |
| SC-003 | `bottleneck-analysis.md` 列出按影响排序的 ≥ 3 个瓶颈，每个含量化数据 | 文档内容审查 |
| SC-004 | 基线数据中 LLM 耗时占比 / graph 规模 / token 总量有具体数字（不是"约"或"估计"）| 有实测数据支撑 |
| SC-005 | 对 F145（并发优化）的"并发数建议"有明确结论（如"建议 concurrency=3，因为 LLM 等待时间占 68%"）| bottleneck-analysis §4 |

**注意**（L4 教训直接应用）：所有性能数据必须标注具体项目规模（文件数 / LOC），不允许出现没有项目规模前提的性能数字。

---

## 4. 目标项目候选

### TS/JS 项目（优先推荐）

| 项目 | 文件数（估）| 特点 | 适合原因 |
|------|-----------|------|---------|
| [Continue](https://github.com/continuedev/continue) | 800+ | AI coding assistant，TS monorepo | 和 Spectra 的 AI for AI 方向高度相关 |
| [Khoj](https://github.com/khoj-ai/khoj) | 600+ | AI search, Python+TS 混合 | 真实 production 项目，有复杂依赖 |
| [ai-engineer-toolkit](https://github.com/btahir/ai-engineer-toolkit) | 200-400 | Next.js, AI tools | 中等规模，可作为"中型项目"基线 |

### Python 项目（测量 Python AST 限制 + patch 后的改善）

| 项目 | 文件数（估）| 特点 | 适合原因 |
|------|-----------|------|---------|
| [Khoj](https://github.com/khoj-ai/khoj) | 300+ .py | FastAPI + Django backend | 真实 Python 后端，类结构丰富 |
| [LangChain](https://github.com/langchain-ai/langchain) | 1000+ .py | 极大 monorepo | 压力测试极限场景 |

**推荐实施选择**：
- 必选：Continue（TS，800+ 文件）——最接近 Phase 3 目标用户场景
- 可选：Khoj（Python 后端部分）——记录 Python AST patch 前的当前限制基线

---

## 5. 产物

### 5.1 `perf-baseline-report.md`

输出位置：`specs/143-large-project-e2e-baseline/perf-baseline-report.md`（约 100-150 行）

必含章节：
```markdown
## 项目概况
  - 项目名 / URL / commit hash
  - 文件数（按类型：.ts/.py/.md）/ LOC（估）/ 模块数（Spectra 识别的）

## 运行配置
  - Spectra 版本 / mode / model / flags

## 性能数据（L4：含项目规模标注）
  - 总耗时：XX 分 XX 秒（N 文件 / M 模块）
  - LLM 调用次数 + 各次耗时分布（min/max/P50/P95）
  - 总 token：input=X / output=Y / cache_read=Z / 估算成本=$W

## 输出规模
  - graph.json：N 节点 / M 边 / K MB
  - spec.md 成功率：M/N 模块生成成功

## dry-run 偏差
  - 预估：X tokens → 实际：Y tokens → 偏差：Z 倍

## 阶段耗时分解
  （每个 pipeline 阶段的耗时占比）
```

### 5.2 `bottleneck-analysis.md`

输出位置：`specs/143-large-project-e2e-baseline/bottleneck-analysis.md`（约 60-80 行）

必含章节：
```markdown
## 瓶颈排行（按耗时影响排序）
  1. [瓶颈名称]：耗时 X 分钟，占总耗时 Y%，根因 [...]
  2. ...

## 量化结论
  - LLM 调用串行等待浪费了 X% 的时间
  - 并发优化潜在收益：如果 concurrency=3，预期节约 ~X 分钟

## F145 并发数建议
  - 建议 concurrency=N，理由：[基于实测数据的推断]
  - 最大安全并发（不触 API 速率限制）：N

## Wave 2 优化优先级建议
  （graph 分层存储是否必要 / embedding cache 是否有改善空间 / etc.）
```

---

## 6. 非功能要求

- **可重复**：记录完整的运行命令（含所有 flags + env），使任何人能在同一项目上重现
- **客观**：所有数据来自实测，不允许估算或假设；如有数据缺失，明确标注"未采集"
- **可追溯**：记录 Spectra 版本号 + 目标项目的 commit hash，基线数据才能和未来优化后的数据对比

---

## 7. 依赖与风险

| 依赖 | 必需 | 备注 |
|------|------|------|
| 克隆目标开源项目到本地 | 是 | 需要 git clone + npm install（TS 项目）|
| Anthropic API Key（调用 claude-sonnet-4-6）| 是 | 估算成本 < $5（单次大项目 batch）|
| Python AST patch 完成 | 否（Wave 1 可先跑 TS 项目）| Python 基线可在 patch 完成后补测 |

| 风险 | 缓解 |
|------|------|
| Continue 项目 800+ 文件 batch 耗时超过 1 小时 | 先用 `--budget 500000` 限制，如超时则分析 checkpoint 数据 |
| Anthropic API 速率限制导致中断 | 使用 `--concurrency 1`（默认），遇速率限制则记录中断点 |
| 大项目 graph.json 超过 10MB | 记录文件大小，不需解决（这是 F145/Wave 2 的问题）|

---

## 8. 验收 Checklist

```bash
# 基本完整性检查
test -f specs/143-large-project-e2e-baseline/perf-baseline-report.md && echo "报告存在"
test -f specs/143-large-project-e2e-baseline/bottleneck-analysis.md && echo "分析存在"

# 关键数据存在性检查（grep）
grep -q "总耗时" specs/143-large-project-e2e-baseline/perf-baseline-report.md
grep -q "P95" specs/143-large-project-e2e-baseline/perf-baseline-report.md
grep -q "F145 并发数建议" specs/143-large-project-e2e-baseline/bottleneck-analysis.md
grep -q "文件" specs/143-large-project-e2e-baseline/perf-baseline-report.md  # 含项目规模维度
```

---

## 9. 依赖图（与其他 Phase 3 Features 的关系）

```
Feature 143（本）
  ↓ 基线数据（并发等待时间占比 / token 规模）
Feature 145（LLM 并发优化）
  ↓ 优化后对比基线
Feature 143 对比验证（Wave 2）

Feature 144（E2E 测试基础）
  ↓ 并行（不依赖 143）
Feature 146（AI Essence 格式）
```

Feature 143 和 Feature 144 可立即并行启动，无相互依赖。

---

*Spec 由 claude-sonnet-4-6 基于 M-103 Blueprint + M-101 Postmortem L4 教训生成。2026-04-29。*
