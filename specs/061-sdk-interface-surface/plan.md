# Implementation Plan: 061 SDK / Library Interface Surface

## 目标

让 `reverse-spec` 对库 / SDK 项目输出一份真正面向公开入口的 `interface-surface` 文档，并让 quality gate 不再把这类项目按 HTTP API 项目误判。

## 技术方案

### 1. 新增 `interface-surface` generator

创建 `src/panoramic/interface-surface-generator.ts`，核心策略：

1. 复用 `ProjectContext.existingSpecs`
2. 通过 `stored-module-specs.ts` 读取 module spec 与 baseline skeleton
3. 汇总公开模块、导出符号与关键方法
4. 对 `tests/examples/scripts` 等低信号路径降权或排除
5. 输出 Markdown + JSON

### 2. 保持 API 与 SDK 两种接口文档语义分离

- `api-surface` 继续只负责 HTTP / OpenAPI / FastAPI / Express
- `interface-surface` 专门负责库 / SDK / public interface
- `api-consumer` bundle 同时兼容两种接口文档

### 3. 调整 quality gate 的项目类型识别

在 `docs-quality-evaluator.ts` 中：

- 新增 `interface-surface` 的文档元数据和 required-doc 规则
- 将 `http-api` 与 `library-sdk` 的 required-doc 规则分开
- `library-sdk` 识别使用项目配置 + 文档事实信号，而不是 `api-surface` 是否存在

### 4. 验证策略

- 单测：
  - `interface-surface` generator
  - quality evaluator required-doc 规则
  - docs bundle `api-consumer` profile
- 集成：
  - Python SDK / library fixture 的 batch 输出与 quality report
  - 现有 API 项目 batch 套件回归
- 真实验证：
  - `claude-agent-sdk-python` 完整 E2E

## 风险与缓解

1. **module spec 质量不足**
   - 优先使用 baseline skeleton；缺失时保守降级并打低置信度标记
2. **SDK / library 识别过宽**
   - 结合配置文件与 runtime 信号，避免对典型服务项目误判
3. **docs bundle 顺序被破坏**
   - 只扩展 `api-consumer` profile，不改其他 profile 的既有顺序
