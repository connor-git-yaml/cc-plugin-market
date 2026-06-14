# demo-kb-en — 英文 demo fixture（Hono Web 框架文档）

本目录是 Feature 190 `scaffold-kb` 的**英文 demo fixture**，用作一个**公开开源 SDK 文档**的代表性样例，用于演示 / 验证 `scaffold-kb build` 把 Markdown 文档目录构建为 `kb/`（`doc-graph.json` + `chunks.sqlite` FTS5 全文检索）。

> 本 fixture 仅作通用「开源 SDK 文档」演示用途，不绑定任何客户、行业或专属场景。Hono 是一个公开的 MIT 开源项目，在此作为「某个公开 SDK」的一个实例呈现。

## 来源

- 上游项目：Hono（Web Standards 上的轻量 Web 框架）
- 文档站：https://hono.dev/docs/
- 文档源码仓库：https://github.com/honojs/website （`docs/` 目录，原始 Markdown）
- License：**MIT License**（https://github.com/honojs/hono/blob/main/LICENSE ；文档仓库 honojs/website 同为 MIT）

## 页数与规模

- 页数：**13 页**（`source-docs/*.md`，覆盖 getting-started / routing / middleware / context / request / response / exception 错误处理 / validation 等代表性主题）
- 规模：每页 1 篇，远小于 50 页上限；构建出的 `chunks.sqlite` 远小于 10MB 上限

## 来源页清单（slug ← 上游文档路径）

| 本地文件 | 上游文档页（hono.dev） |
|---------|----------------------|
| `getting-started.md` | https://hono.dev/docs/getting-started/basic |
| `routing.md` | https://hono.dev/docs/api/routing |
| `context.md` | https://hono.dev/docs/api/context |
| `request.md` | https://hono.dev/docs/api/request |
| `app-hono-object.md` | https://hono.dev/docs/api/hono |
| `exception-error-handling.md` | https://hono.dev/docs/api/exception |
| `validation.md` | https://hono.dev/docs/guides/validation |
| `middleware-concept.md` | https://hono.dev/docs/concepts/middleware |
| `cors-middleware.md` | https://hono.dev/docs/middleware/builtin/cors |
| `bearer-auth-middleware.md` | https://hono.dev/docs/middleware/builtin/bearer-auth |
| `jwt-helper.md` | https://hono.dev/docs/helpers/jwt |
| `best-practices.md` | https://hono.dev/docs/guides/best-practices |
| `testing.md` | https://hono.dev/docs/guides/testing |

## 处理说明

- 正文取自上述上游文档的原始 Markdown（`honojs/website` 仓库 `docs/`），保留真实 API 名、错误处理示例与代码符号（如 `c.req.param()`、`app.get()`、`HTTPException`、`app.onError`）。
- 仅做了文档站特定语法的轻量规整以得到干净的通用 Markdown：代码围栏语言标记归一（`ts twoslash` → `ts`）、移除 twoslash 切割标记、`[!code]` 高亮标记与 `:::` 容器标记。未改写任何 API 语义或代码内容。
- 每个文件首行为 `# <页面标题>`，与上游 H1 一致，供 `scaffold-kb` 提取 doc title。

## 构建命令

```bash
npx tsx src/cli/index.ts scaffold-kb build \
  --dir plugins/demo-kb-en/source-docs \
  --output plugins/demo-kb-en/kb
```

产物：`kb/doc-graph.json` + `kb/chunks.sqlite`。
