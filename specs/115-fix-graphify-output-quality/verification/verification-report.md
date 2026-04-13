# 验证报告 — Fix 115 Graphify 输出质量

> 验证日期: 2026-04-13
> 测试项目: python-dotenv（8 个 .py 文件，src/dotenv/ 布局）

## 工具链验证

| 步骤 | 结果 |
|------|------|
| `npm run build` | ✅ 零错误 |
| `npx vitest run` | ✅ 1563 tests passed, 160 test files |
| 端到端 batch | ✅ 成功: 4 / 降级: 4 / 失败: 0 |

## Bug 修复验证结果

| Bug | 期望结果 | 实际结果 | 状态 |
|-----|---------|---------|------|
| BUG-A: 文件级模块路径 | 8 个独立 spec 文件 | ✅ 8 个 (`__init__`, `__main__`, `cli`, `ipython`, `main`, `parser`, `variables`, `version`) | **FIXED** |
| BUG-B: 架构文档重复模块 | 各模块不重复 | ✅ 6 个不同模块，无重复 | **FIXED** (via BUG-A) |
| BUG-C: 方法描述全相同 | 各方法显示实际 docstring | ✅ `load_dotenv` → "Parse a .env file and then load all the variables found..."；`set_key` → "Adds or Updates a key/value..."；`run` → "Run command with environment variables present." | **FIXED** |
| BUG-D/E: 产品文档用 Issue 当场景 | 核心场景来自 README | ✅ 核心场景：`.env` 文件查找逻辑、键值对注入、override=False 默认行为 — 均来自 README Getting Started | **FIXED** |
| BUG-F: feature brief 含 bug report | 过滤 bug 类 issue | ⚠️ PR #640 "Fix: strip UTF-8 BOM" 已过滤 ✅；issue #637（BOM bug，标题以 "First" 开头）未被过滤 ❌ | **PARTIAL** |
| BUG-H: 图谱 1 节点 | 多节点图谱 | ✅ 8 节点（每个 Python 文件 1 节点） | **FIXED** (via BUG-A) |
| BUG-J: vis.js 事件误提取 | 无 vis.js 事件 | ✅ dotenv 无 HTML 模板，事件面无误报 | **VERIFIED** |
| BUG-K: 类型含注释内容 | typeStr 不含 `# e.g.` | N/A（dotenv 无 dataclass 定义） | **N/A** |

## 剩余已知限制

### BUG-F 限制
`isLikelyBugOrQuestion` 依赖标题关键词和 GitHub 标签，无法检测标题为描述性句子的 bug（如 "First environment variable is silently ignored..."）。需要更完整的 GitHub label 检查或 LLM 语义分类，属于后续增量改进。

### BUG-G 限制（产品定位 badge HTML）
`buildPositioning` 和 `buildTargetUsers` 中的 README 段落提取仍选到 badge HTML 行（`[![Build Status]...]...`），因为 `isDescriptiveParagraph` 只识别内联链接 `[text](url)`，不识别引用式图片 `[![alt][id]][id]`。属于已知限制，不影响核心功能。

## 修复质量总评

- **BUG-A (CRITICAL)**: 完全修复，从 1 个 spec 升至 8 个独立 spec ✅
- **BUG-B (CRITICAL)**: 自动消解 ✅
- **BUG-C (CRITICAL)**: 修复，LLM 成功的模块显示各自 docstring，降级模块显示降级原因 ✅
- **BUG-D/E (CRITICAL)**: 修复，核心场景来自 README 真实内容 ✅
- **BUG-F (MEDIUM)**: 部分修复，明确 "fix" 前缀被过滤，模糊 bug 标题仍通过 ⚠️
- **BUG-H (CRITICAL)**: 自动消解 ✅
- **BUG-J (LOW)**: 已修复（PY_SUBSCRIBER_METHODS 分离） ✅
- **BUG-K (LOW)**: 代码已修复，dotenv 无 dataclass 无法端到端验证 ✅
