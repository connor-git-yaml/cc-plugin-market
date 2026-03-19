# Feature 042 技术决策研究

**Feature**: API Surface Reference
**日期**: 2026-03-20
**调研模式**: tech-only

---

## Decision 1: 抽取源采用单一优先级链，而不是多源混合

**决策**: `ApiSurfaceGenerator.extract()` 固定按 `schema -> introspection -> ast` 顺序选择第一个可产出端点集合的来源；一旦命中更高优先级来源，不再向后合并更低优先级结果。

**理由**:
- 蓝图已明确 042 的优先级顺序，单一命中策略最符合“优先消费、其次使用、最后 fallback”的语义
- 避免不同来源的路径风格、响应类型和认证标签产生重复或冲突
- 让输出中的 `source` 标记保持稳定，便于验收和调试

**替代方案**:
- A: 按路径合并多来源结果 -- 拒绝，因为需要复杂去重和冲突裁决逻辑，超出 042 范围
- B: 始终运行 AST 再用 schema 覆盖字段 -- 拒绝，因为会引入不必要的开销和不稳定性

---

## Decision 2: Schema ingest 直接消费 OpenAPI/Swagger 文档对象

**决策**: 对已存在的 OpenAPI/Swagger 产物，直接遍历 `paths` 和 operation 元数据，提取 HTTP 方法、路径、参数、请求体、响应类型、认证和标签。

**理由**:
- 这是信息最完整、歧义最小的来源，天然满足 042 的主要字段要求
- OpenAPI 3 与 Swagger 2 的差异集中在 `requestBody`/`schema` 等局部字段，可在同一解析层内兼容
- 复用现有“静态读取文件”模式，不需要执行用户应用

**替代方案**:
- A: 读取框架源码后重建 schema -- 拒绝，因为已有 schema 时重复工作且可能丢失注释/安全定义

---

## Decision 3: FastAPI / tsoa introspection 坚持静态元数据提取

**决策**: 不启动服务、不 import 用户应用；FastAPI 通过静态解析 `FastAPI`/`APIRouter`/装饰器/`include_router()`，tsoa 通过静态解析 `@Route`/HTTP 方法装饰器/参数装饰器。

**理由**:
- 用户已明确不能假设 Claude 环境，也不要引入必须启动服务的重依赖
- FastAPI 与 tsoa 都把关键路由元数据放在源码装饰器和声明中，静态提取可满足 042 所需字段
- 静态解析比运行时 introspection 更安全，避免用户代码副作用

**替代方案**:
- A: 运行 FastAPI 应用读取 `/openapi.json` -- 拒绝，因为要求用户环境完整且存在副作用
- B: 运行 tsoa CLI 生成 schema -- 拒绝，因为依赖项目本地配置和编译环境，不适合作为默认路径

---

## Decision 4: Express fallback 以 AST 构建路由树，而不是正则拼接

**决策**: Express fallback 使用 `ts-morph` 静态分析 TS/JS 路由文件，识别 `express()`、`Router()`、`router.route()`、`app.use()`/`router.use()` 的挂载关系，组合出完整端点路径。

**理由**:
- 042 明确要求“AST fallback”，并要求在 10+ Express 路由项目中不遗漏方法与路径
- 相比正则，AST 更适合处理链式调用、跨文件 import 和嵌套路由挂载
- 项目已包含 `ts-morph` 依赖，无需新增重依赖

**替代方案**:
- A: 纯正则扫描 `router.get('/x')` -- 拒绝，因为无法稳定处理 `route()` 链式调用和跨文件挂载

---

## Decision 5: AST fallback 的参数/认证/标签采用“尽量静态可得”的最小语义

**决策**: 对 Express AST fallback，参数至少覆盖 path params；认证从中间件名启发式识别；标签优先来自首段路径，否则退化为源文件名；响应类型未知时标记为 `unknown`。

**理由**:
- 蓝图对 AST fallback 的硬性验收核心是“覆盖全部端点方法和路径”，而不是在无 schema 场景下重建完整类型系统
- Express 路由层通常不显式声明响应类型，静态推断成本高且误报风险大
- 使用保守的 `unknown` 与启发式 auth/tag，可在不虚构信息的前提下保持输出结构统一

**替代方案**:
- A: 对所有 Express handler 做深度数据流分析推断响应类型 -- 拒绝，因为复杂度远超 042 且准确率不可控

---

## Decision 6: 输出合同保持现有 panoramic 多格式约定

**决策**: `generate()` 返回结构化对象，`render()` 仅负责 Markdown；输出对象不依赖额外 writer 改造即可兼容现有 `markdown/json/all` 约定。

**理由**:
- 现有 panoramic generator 都采用 `extract -> generate -> render` 三段式
- 042 不强制 Mermaid，可直接让 `all` 模式写出 `.md + .json`
- 保持 registry、桶文件导出和调用方式不变，避免波及 043/045/046

**替代方案**:
- A: 为 042 单独引入新的 writer 契约 -- 拒绝，因为破坏已有抽象一致性
