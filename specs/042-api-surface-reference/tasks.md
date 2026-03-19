# Tasks: API Surface Reference (Feature 042)

**Input**: Design documents from `/specs/042-api-surface-reference/`
**Prerequisites**: `research.md`, `spec.md`, `plan.md`
**Tests**: 至少覆盖 schema ingest、FastAPI/tsoa introspection 之一、以及 10+ Express routes AST fallback。

---

## Phase 1: Setup

- [x] T001 创建 `src/panoramic/api-surface-generator.ts` 模块骨架和导出类型
- [x] T002 [P] 创建 `templates/api-surface.hbs`
- [x] T003 [P] 创建 `tests/panoramic/api-surface-generator.test.ts` 测试骨架
- [x] T004 [P] 创建 `specs/042-api-surface-reference/{research,spec,plan,tasks}.md`

**Checkpoint**: 文件骨架存在，`npm run lint` 通过

---

## Phase 2: 数据模型与优先级链

- [x] T005 定义 `ApiSource`、`ApiParameter`、`ApiResponse`、`ApiEndpoint`
- [x] T006 定义 `ApiSurfaceInput`、`ApiSurfaceOutput`
- [x] T007 实现 `extract()` 的来源优先级链：`schema -> introspection -> ast`
- [x] T008 实现 `generate()`：排序、去重、统计摘要
- [x] T009 实现 `render()`：加载 `api-surface.hbs`

**Checkpoint**: 生成器具备完整生命周期

---

## Phase 3: Schema ingest

- [x] T010 编写 schema ingest 测试：`openapi.json` 项目可提取完整端点字段
- [x] T011 编写优先级测试：schema 与源码同时存在时仍选择 `schema`
- [x] T012 实现 schema 文件发现逻辑
- [x] T013 实现 OpenAPI / Swagger `paths` 解析
- [x] T014 实现参数 / 请求体 / 响应 / 认证 / 标签提取

**Checkpoint**: schema 测试通过

---

## Phase 4: Framework introspection

- [x] T015 编写 FastAPI 静态 introspection 测试
- [x] T016 实现 FastAPI `FastAPI/APIRouter/装饰器/include_router()` 解析
- [x] T017 实现 tsoa `@Route` / HTTP 方法 / 参数装饰器解析
- [x] T018 处理 introspection 来源的路径前缀、认证和标签合并

**Checkpoint**: 无 schema 时可稳定产出 `source='introspection'`

---

## Phase 5: Express AST fallback

- [x] T019 编写 10+ Express 路由 AST fallback 测试，覆盖多文件挂载和 `router.route()` 链式调用
- [x] T020 实现 Express app/router 定义识别
- [x] T021 实现直接路由和链式路由解析
- [x] T022 实现 `app.use()` / `router.use()` 挂载树和跨文件 import 解析
- [x] T023 实现完整路径拼接、path 参数提取和 auth/tag 启发式补齐

**Checkpoint**: Express fallback 覆盖全部测试路由的方法和路径

---

## Phase 6: Registry / Export / Version

- [x] T024 修改 `src/panoramic/generator-registry.ts` 注册 `ApiSurfaceGenerator`
- [x] T025 修改 `src/panoramic/index.ts` 导出 `ApiSurfaceGenerator` 及相关类型
- [x] T026 bump `plugins/reverse-spec/.claude-plugin/plugin.json` minor 版本

**Checkpoint**: `bootstrapGenerators()` 后可查询 `api-surface`

---

## Phase 7: Verification

- [x] T027 运行 `vitest run tests/panoramic/api-surface-generator.test.ts`
- [x] T028 运行 `npm run lint`
- [x] T029 运行 `npm run build`
- [x] T030 提交前执行 `git fetch origin && git rebase origin/master`
- [x] T031 提交 `feat(panoramic): add api surface generator`

---

## FR 覆盖映射

| FR | 覆盖任务 |
|----|----------|
| FR-001, FR-012 | T005-T009 |
| FR-002 | T007, T011 |
| FR-003, FR-004 | T010-T014 |
| FR-005, FR-006, FR-007 | T015-T018 |
| FR-008, FR-009, FR-010 | T019-T023 |
| FR-011, FR-015, FR-016 | T008, T014, T018, T023 |
| FR-013, FR-014 | T024-T025 |
