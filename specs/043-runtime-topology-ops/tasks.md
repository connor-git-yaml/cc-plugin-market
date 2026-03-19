# Tasks: 运行时拓扑与运维抽取 (Feature 043)

**Input**: Design documents from `/specs/043-runtime-topology-ops/`
**Prerequisites**: `spec.md` (required), `research.md` (required), `plan.md` (required)

**Tests**: 本 Feature 明确要求至少覆盖一组 Compose + Dockerfile 联合解析测试、一组 multi-stage Dockerfile 测试，并通过 `npm run lint`、`npm run build` 与相关 vitest 用例。

**Organization**: 任务按共享基础设施、User Story 和验证阶段分组。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行
- **[Story]**: 所属 User Story（US1-US5）
- 所有路径均为仓库根目录相对路径

---

## Phase 1: Setup & Shared Model

**Purpose**: 为 043/045 共用的运行时模型和 043 生成器建立代码骨架。

- [x] T001 创建 `src/panoramic/runtime-topology-model.ts`，定义共享 runtime model 类型与基础 helper
- [x] T002 [P] 创建 `src/panoramic/runtime-topology-generator.ts` 骨架，导出 `RuntimeTopologyGenerator`
- [x] T003 [P] 创建 `templates/runtime-topology.hbs` 模板骨架
- [x] T004 [P] 创建 `tests/panoramic/runtime-topology-generator.test.ts` 测试骨架与临时项目 helper

**Checkpoint**: 新增文件骨架存在，`npm run lint` 不因缺文件失败。

---

## Phase 2: User Story 1 - Compose + Dockerfile 联合抽取 (Priority: P1)

**Goal**: 能从 Compose、Dockerfile、`.env` 联合构建服务/镜像/容器/端口/卷/依赖/命令的统一拓扑。

### Tests First

- [x] T005 [P] [US1] 编写联合解析测试：Compose + Dockerfile + `.env` 项目生成完整 `RuntimeTopology`
- [x] T006 [P] [US1] 编写短语法/长语法覆盖测试：`ports`、`volumes`、`depends_on`、`environment`
- [x] T007 [P] [US1] 编写 `render()` 测试：输出 Markdown 包含服务、镜像、容器、端口和卷摘要

### Implementation

- [x] T008 [US1] 在 `runtime-topology-model.ts` 中实现环境变量、端口、卷、依赖与命令的归一化 helper
- [x] T009 [US1] 在 `runtime-topology-generator.ts` 中实现 Compose 文件发现与语义抽取
- [x] T010 [US1] 在 `runtime-topology-generator.ts` 中实现 Dockerfile / env_file 发现与解析联动
- [x] T011 [US1] 在 `runtime-topology-generator.ts` 中实现 `generate()`，合并服务、镜像、容器与来源信息
- [x] T012 [US1] 在 `templates/runtime-topology.hbs` 中编写运行时拓扑文档模板

**Checkpoint**: US1 测试通过，文档包含完整服务拓扑信息。

---

## Phase 3: User Story 2 - Multi-stage Dockerfile (Priority: P1)

**Goal**: 正确识别 build/runtime stages，并把服务映射到目标 stage。

### Tests First

- [x] T013 [P] [US2] 编写 multi-stage Dockerfile 测试：默认最后一个 stage 为 runtime
- [x] T014 [P] [US2] 编写 `build.target` 测试：服务映射到 Compose 指定 stage

### Implementation

- [x] T015 [US2] 在 `runtime-topology-model.ts` 中实现 Dockerfile stage -> runtime stage 归一化
- [x] T016 [US2] 在 `runtime-topology-generator.ts` 中保留 stage 间 `COPY --from` 依赖与服务目标 stage 关联

**Checkpoint**: US2 测试通过，共享模型包含 stages 与服务-stage 映射。

---

## Phase 4: User Story 3 - 运行时配置提示聚合 (Priority: P2)

**Goal**: 把 `.env` 与 YAML/TOML 中的运行时提示纳入共享模型。

### Tests First

- [x] T017 [P] [US3] 编写 `.env` / `env_file` 合并测试，验证来源追踪与覆盖顺序
- [x] T018 [P] [US3] 编写运行时配置提示测试，验证 YAML/TOML 关键线索进入共享模型

### Implementation

- [x] T019 [US3] 在 `runtime-topology-generator.ts` 中实现 `.env` / `env_file` 聚合逻辑
- [x] T020 [US3] 在 `runtime-topology-generator.ts` 中实现 YAML/TOML runtime config hint 收集

**Checkpoint**: US3 测试通过，共享模型保留环境变量来源与配置提示。

---

## Phase 5: User Story 4 & 5 - Registry 集成 + 045 共享边界 (Priority: P2)

**Goal**: 让 043 被现有工具链发现，同时确保共享模型可被 045 直接消费。

### Tests First

- [x] T021 [P] [US4] 编写 `bootstrapGenerators()` 注册测试：可通过 `runtime-topology` id 查询
- [x] T022 [P] [US4] 编写 `filterByContext()` 测试：含 compose/Dockerfile 的上下文可返回生成器
- [x] T023 [P] [US5] 编写共享导出测试：`src/panoramic/index.ts` 导出共享 runtime model / generator

### Implementation

- [x] T024 [US4] 修改 `src/panoramic/generator-registry.ts` 注册 `RuntimeTopologyGenerator`
- [x] T025 [US5] 修改 `src/panoramic/index.ts` 导出 `RuntimeTopologyGenerator` 和共享 model/types/helper

**Checkpoint**: Registry 与导出测试通过，043/045 共享边界明确。

---

## Phase 6: Polish & Verification

**Purpose**: 全量验证、更新任务状态、准备提交。

- [x] T026 [P] 运行 `vitest run tests/panoramic/runtime-topology-generator.test.ts`
- [x] T027 [P] 运行相关 panoramic 回归测试（Dockerfile / env / YAML / generator-registry）
- [x] T028 [P] 运行 `npm run lint`
- [x] T029 [P] 运行 `npm run build`
- [x] T030 提交前执行 `git fetch origin && git rebase origin/master`
- [x] T031 更新本文件任务状态并提交代码

---

## FR 覆盖映射

| FR | 覆盖任务 |
|----|----------|
| FR-001, FR-002 | T002, T009, T011, T024 |
| FR-003, FR-004, FR-009 | T005-T016 |
| FR-005, FR-010, FR-016 | T017-T020 |
| FR-006, FR-007, FR-008 | T001, T008, T011, T015, T016 |
| FR-011 | T003, T007, T012 |
| FR-012, FR-013 | T021-T025 |
| FR-014, FR-015 | T001, T020, T023, T025 |
