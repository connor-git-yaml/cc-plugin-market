---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: The examples below include test tasks. Tests are OPTIONAL - only include them if explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- **Web app**: `backend/src/`, `frontend/src/`
- **Mobile**: `api/src/`, `ios/src/` or `android/src/`
- Paths shown below assume single project - adjust based on plan.md structure

<!-- 
  ============================================================================
  IMPORTANT: The tasks below are SAMPLE TASKS for illustration purposes only.
  
  The tasks phase of the orchestrator MUST replace these with actual tasks based on:
  - User stories from spec.md (with their priorities P1, P2, P3...)
  - Feature requirements from plan.md
  - Entities from data-model.md
  - Endpoints from contracts/
  
  Tasks MUST be organized by user story so each story can be:
  - Implemented independently
  - Tested independently
  - Delivered as an MVP increment
  
  DO NOT keep these sample tasks in the generated tasks.md file.
  ============================================================================
-->

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create project structure per implementation plan
- [ ] T002 Initialize [language] project with [framework] dependencies
- [ ] T003 [P] Configure linting and formatting tools

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

Examples of foundational tasks (adjust based on your project):

- [ ] T004 Setup database schema and migrations framework
- [ ] T005 [P] Implement authentication/authorization framework
- [ ] T006 [P] Setup API routing and middleware structure
- [ ] T007 Create base models/entities that all stories depend on
- [ ] T008 Configure error handling and logging infrastructure
- [ ] T009 Setup environment configuration management

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 1 (OPTIONAL - only if tests requested) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T010 [P] [US1] Contract test for [endpoint] in tests/contract/test_[name].py
- [ ] T011 [P] [US1] Integration test for [user journey] in tests/integration/test_[name].py

### Implementation for User Story 1

- [ ] T012 [P] [US1] Create [Entity1] model in src/models/[entity1].py
- [ ] T013 [P] [US1] Create [Entity2] model in src/models/[entity2].py
- [ ] T014 [US1] Implement [Service] in src/services/[service].py (depends on T012, T013)
- [ ] T015 [US1] Implement [endpoint/feature] in src/[location]/[file].py
- [ ] T016 [US1] Add validation and error handling
- [ ] T017 [US1] Add logging for user story 1 operations

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 2 (OPTIONAL - only if tests requested) ⚠️

- [ ] T018 [P] [US2] Contract test for [endpoint] in tests/contract/test_[name].py
- [ ] T019 [P] [US2] Integration test for [user journey] in tests/integration/test_[name].py

### Implementation for User Story 2

- [ ] T020 [P] [US2] Create [Entity] model in src/models/[entity].py
- [ ] T021 [US2] Implement [Service] in src/services/[service].py
- [ ] T022 [US2] Implement [endpoint/feature] in src/[location]/[file].py
- [ ] T023 [US2] Integrate with User Story 1 components (if needed)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - [Title] (Priority: P3)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 3 (OPTIONAL - only if tests requested) ⚠️

- [ ] T024 [P] [US3] Contract test for [endpoint] in tests/contract/test_[name].py
- [ ] T025 [P] [US3] Integration test for [user journey] in tests/integration/test_[name].py

### Implementation for User Story 3

- [ ] T026 [P] [US3] Create [Entity] model in src/models/[entity].py
- [ ] T027 [US3] Implement [Service] in src/services/[service].py
- [ ] T028 [US3] Implement [endpoint/feature] in src/[location]/[file].py

**Checkpoint**: All user stories should now be independently functional

---

[Add more user story phases as needed, following the same pattern]

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] TXXX [P] Documentation updates in docs/
- [ ] TXXX Code cleanup and refactoring
- [ ] TXXX Performance optimization across all stories
- [ ] TXXX [P] Additional unit tests (if requested) in tests/unit/
- [ ] TXXX Security hardening
- [ ] TXXX Run quickstart.md validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Models before services
- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (if tests requested):
Task: "Contract test for [endpoint] in tests/contract/test_[name].py"
Task: "Integration test for [user journey] in tests/integration/test_[name].py"

# Launch all models for User Story 1 together:
Task: "Create [Entity1] model in src/models/[entity1].py"
Task: "Create [Entity2] model in src/models/[entity2].py"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## 原子性约束

- 每个任务完成后，整个系统必须可以通过基础验证（编译/lint）
- 如果一个改动需要同时修改多个层级（如删除模型字段 + 删除 Store 参数 + 删除 Service 调用），这些修改必须在同一个任务中完成，而不是拆分到不同任务
- 每个任务附简要验证命令（如 `npm run build`、`npm run lint`、`grep -rn "旧名称" src/`）

## Architecture Guard

> 以下守护条目由 plan agent 在规划阶段填充。implement agent 在每个任务完成后必须逐条检查。

- [ ] AG-001 本次改动涉及的最大文件行数不超过 {阈值，默认 800} 行（若超过，先拆分再实现）
- [ ] AG-002 新增代码不引入循环依赖（检查方式：grep 延迟 import 或运行依赖分析）
- [ ] AG-003 新增代码不引入 bare except / catch-all-return-empty 模式（`except: return []`、`except: return None`、`except: pass`）
- [ ] AG-004 {plan agent 可根据实际情况追加项目特定的守护条目}

## FR 覆盖映射表

> 逐条列出 spec 的 FR → 对应的 Task ID。**覆盖不变量**：每条**未被裁剪登记的实现型** FR 至少有一个对应任务；已登记裁剪的实现型 FR 改填**裁剪登记指针**；**约束型 FR 一律不要求任务**，改填其三取值的**核验落点指针**。

| FR | 类别 | Task ID(s) | 备注 |
|----|------|-----------|------|
| FR-001 | 实现型 | T00X, T0YY | — |
| FR-0XX | 实现型（已裁剪） | 裁剪登记 · 第 N 条 | 不要求任务 |
| FR-0YY | 约束型 | 核验落点：{verify 侧的具体落点} | 不要求任务 |

### 冻结字段（GATE_TASKS 时点）

> **本小节只落字段位与指针，不复制格式定义。** 冻结值的**计算方式、规范化规则、七项字段口径与注入 / 判定权规则**的**单一事实源**是共享块 `plugins/spec-driver/templates/gate-tasks-scope-cut-acceptance.md` 的「冻结值字段格式」一节（经 `docs:sync:agents` 注入各 mode 的 SKILL）。**在此复制那段格式定义会产生第二份手写副本，两处必然漂移——禁止复制。**

| 字段 | 值 | 填写口径 |
|------|----|---------|
| 冻结对象 | `plan.md` 的 `## FR → Phase 覆盖矩阵` 整节（规范化后） | 由**编排器**填写；规范化规则见共享块 |
| 规范化 sha256 | `{hash}` | 由**编排器**在 `GATE_TASKS` 时点计算并写入；**取不到时不得留白、不得填占位哈希**，须写「未取得」并说明原因，该项随后按「未执行（缺席）」处理 |
| 表行数 | `{N}`（单位：{计数单位}） | 须附**计数单位**（如「以 `\| FR-0` 开头的表行」） |
| 冻结时点 | `{日期}` | 「`GATE_TASKS` 用户授权后由编排器写入」 |
| **commit sha** | `{sha}` 或**留空** | **可选字段**，**与上面的 sha256 同处并列**。本流程**不要求**在 `GATE_TASKS` 通过后 commit 设计制品，故该 sha **仅在流程恰好已 commit 时存在**。**取不到时留空并写明留空**；**禁止**用「最近一个含 tasks 制品的 commit」或「当前 `HEAD`」这类现推值顶替 |
| 冻结后修订 | — | 矩阵正文禁无痕改写；如需修订，以带时间戳的追加记录置于矩阵章节**之外** |
| 复算命令 | `{命令原文}` | **命令原文**原样写入，使任何人可独立复算 |

**为什么 commit sha 必须与哈希同处**：`resume` 会话的编排器要靠它执行 `git show <sha>:<本文件路径>` 取回该版本的冻结值。**缺 sha、或 `git cat-file -e <sha>` 失败 ⇒ 注入值缺席 ⇒ 该项判「未执行（缺席）」**并归入不通过侧。

**本字段位不是独立性依据**：磁盘上的本文件与 `plan.md` 都在 verify 的写面之内（verify 持有 `Bash`），同一次推理可连矩阵带哈希一并原地改写。真正的锚是**编排器持有并注入 verify 运行时上下文的那一份**，判定权在编排器于 `GATE_VERIFY` 的**亲自重算**。

## 延期承诺候选池

> **本节是延期承诺任务化的落点，不得省略。** 填写口径的单一事实源是 `agents/tasks.md` 的「延期承诺的候选池式任务化」一步——**本节只给结构与字段位，不复制那段口径定义**。**空池同样必须填本节**：「没扫」与「扫了且确实没有」在产物上完全同形，无命令与原始输出的空池按「未执行（缺席）」计，不构成通过。

**入池步证据三项（缺一即该步未执行）**：

| 项 | 值 |
|---|---|
| 扫描的命令原文 | `{原样写出、可被他人直接复跑；不是描述、不是重构后的等价写法}` |
| 该命令的原始输出（或其计数） | `{原始输出片段 / 计数}` |
| 池内条数 | `{N}`（单位：入池条目） |

> **三者须相互核对**：池内条数应与命令输出计数一致；**不一致必须附强制说明**（哪些命中被合并、哪些被判为同一条承诺的多处出现），不得只报其中一个数。

**候选池逐条判定与留痕（三列起步；判定取值只有两个）**：

| 入池条目（含出处位置） | 判定结论 | 排除理由（判为「非承诺」时必填） |
|----------------------|---------|------------------------------|
| {哪份制品的哪一处 + 原文摘录} | 已任务化 → {对应任务 ID} | — |
| {哪份制品的哪一处 + 原文摘录} | 非承诺 | {排除理由} |

- **无留痕的排除视为未处置**，与漏做同等判不合格——沉默地把一条踢出池子，与从来没扫描过它在产物上完全同形。
- **转化出的任务须满足三项**：归属该 Phase、可独立勾选、**能追溯回原承诺的出处位置**。缺回溯指针的任务不算完成转化。

**交给 `GATE_TASKS` 的阻断量**：候选池中**判为承诺、但无对应归属任务的条数** = `{M}`（单位：延期承诺条）。**`M > 0` 即按「任务分解有明显问题」处理**；该条数须连同上述证据三项一并交给该门。

**验收强度上限声明（原样写入，不得改写、不得省略）**：

> **本检查只证明该检查在语料上非恒空，不构成对承诺检出率的任何声明。**

**空池时的填法**：证据三项照填（命令原文 + 原始输出 + 池内条数 `0`），逐条判定表写「（空）」，并写明 `M = 0`。**只写一句「本次无延期承诺」而无命令与原始输出的，按「未执行（缺席）」计。**

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
