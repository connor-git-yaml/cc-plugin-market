---
feature: 107-multi-modal-extraction
created: 2026-04-12
---

# 快速上手：Feature 107 多模态工程制品提取

本指南帮助开发者快速理解 Feature 107 的使用方式和集成要点。

---

## 功能概述

Feature 107 在 `spectra batch` 命令中新增两个可选标志，将非代码工程制品（Markdown 文档、API 规范、图表）提取为知识图谱节点：

```bash
# 提取 Markdown 文档 + OpenAPI/AsyncAPI 规范
spectra batch --include-docs

# 提取图像/图表（需要 ANTHROPIC_API_KEY）
spectra batch --include-images

# 同时启用两类提取
spectra batch --include-docs --include-images

# 默认行为不变（零破坏）
spectra batch
```

---

## 新增节点类型

| kind | 来源 | confidence | 示例 label |
|------|------|-----------|-----------|
| `document` | Markdown 文档（`.md`） | `INFERRED`（LLM 提取）| `ADR-001: 选择 PostgreSQL` |
| `api` | OpenAPI/Swagger endpoint | `EXTRACTED` | `GET /users` |
| `api-schema` | OpenAPI request/response schema | `EXTRACTED` | `UserSchema` |
| `event` | AsyncAPI channel | `EXTRACTED` | `user.created` |
| `diagram` | 图像/图表（`.png`/`.jpg`）| `INFERRED`（Vision）| `architecture.png` |

---

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ANTHROPIC_API_KEY` | 无（必需用于 LLM 提取）| Markdown LLM 实体提取 + 图像 Vision 提取均需要 |
| `SPECTRA_VISION_MODEL` | `claude-sonnet-4-5` | 覆盖图像提取使用的 Claude 模型 |

---

## 文件扫描范围

### `--include-docs` 扫描路径
- Markdown：项目所有 `.md` 文件（**排除** `specs/`、`node_modules/`、`dist/`、`.git/`）
- API 规范：`openapi.yaml`、`openapi.json`、`swagger.yaml`、`asyncapi.yaml`（全项目搜索）

### `--include-images` 扫描路径
- 限定目录：`docs/`、`assets/`、`images/`
- 支持格式：`.png`、`.jpg`、`.jpeg`（SVG 以文本方式处理）
- 跳过条件：文件大小 > 10 MB

---

## 缓存说明

提取结果按文件内容 hash 缓存（`{outputDir}/_meta/extraction-cache/{hash}.json`）：

- 文件内容未变化时，二次 batch 直接命中缓存，跳过 LLM/Vision API 调用
- Markdown 文件的缓存 key 仅基于 frontmatter 之后的 body 内容（frontmatter-only 变更不使缓存失效）

---

## 降级行为

| 场景 | 行为 |
|------|------|
| `ANTHROPIC_API_KEY` 未配置 | 跳过 Markdown LLM 实体提取（仅做确定性 heading/frontmatter 提取）；跳过全部图像提取 |
| Vision API 调用超时/失败 | 跳过该图片，继续处理其他文件 |
| LLM 返回非 JSON 内容 | 返回空结果，不中断流程 |
| API 规范文件格式错误 | 跳过该文件并输出警告日志，继续处理其他文件 |

所有降级场景下，`spectra batch` 以成功状态退出，`graph.json` 包含已成功提取的节点。

---

## 快速集成示例

```typescript
// 在代码中调用（如有需要）
import { runBatch } from './src/batch/batch-orchestrator.js';

const result = await runBatch('/path/to/project', {
  includeDocs: true,
  includeImages: false,
});

console.log(`生成节点数（含提取节点）: ${result.docGraphPath}`);
```

---

## graph.json 输出示例

```json
{
  "nodes": [
    {
      "id": "api:GET:/users:openapi.yaml",
      "kind": "api",
      "label": "GET /users",
      "metadata": { "sourceTag": "extraction", "sourceFile": "openapi.yaml" }
    },
    {
      "id": "doc:docs/adr-001.md",
      "kind": "document",
      "label": "ADR-001: 选择 PostgreSQL",
      "metadata": { "concepts": ["PostgreSQL", "数据库选型"], "sourceTag": "extraction" }
    }
  ]
}
```
