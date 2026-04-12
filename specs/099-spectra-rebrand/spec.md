---
feature: "099-spectra-rebrand"
title: "品牌重命名 reverse-spec → Spectra"
branch: "099-spectra-rebrand"
created: "2026-04-12"
status: "Draft"
version_bump: "v2.9.0 → v3.0.0"
mode: "story"
---

# Feature Specification: 品牌重命名 reverse-spec → Spectra

**Feature Branch**: `099-spectra-rebrand`
**Created**: 2026-04-12
**Status**: Draft
**版本**: v2.9.0 → v3.0.0（breaking change，major bump）

---

## 背景与范围

将产品从 "reverse-spec" 品牌全面重命名为 "Spectra"。本 feature 属于**纯机械重命名**，零功能变更。所有现有功能行为、spec 文件格式、输出结构保持不变。

**约束**：npm 名称 `spectra` 已被 2014 年颜色库占用，因此 npm 包名改为 `spectra-cli`，但 CLI bin 入口仍为 `spectra`。

[无调研基础：本 feature 基于蓝图 M-100 变更清单和代码上下文直接生成规范]

---

## User Scenarios & Testing

### User Story 1 - 用户可以用新名称调用所有 CLI 命令（Priority: P1）

已安装旧版 `reverse-spec` 的用户，升级到 `spectra-cli` 后，可通过 `spectra` 命令调用所有现有功能（`spectra batch`、`spectra diff`、`spectra <target>`），行为与旧版完全一致。

**Why this priority**：这是重命名的核心目标。CLI 入口不可用则整个 feature 失败。

**Independent Test**：安装 `spectra-cli` 后执行 `spectra batch --help`，确认帮助信息正常显示且内容中已不出现 `reverse-spec` 字样。

**Acceptance Scenarios**:

1. **Given** 用户安装了 `spectra-cli`，**When** 执行 `spectra batch --help`，**Then** 显示完整帮助信息，无报错，内容提及 "Spectra" 而非 "reverse-spec"
2. **Given** 用户执行 `spectra <target>`，**When** 指向有效源文件，**Then** 生成的 spec 内容与旧版 `reverse-spec <target>` 完全等价
3. **Given** 用户执行 `spectra diff <spec> <source>`，**When** 指向有效文件，**Then** 正常输出漂移检测结果

---

### User Story 2 - 旧命令打印 deprecation warning 并继续执行（Priority: P1）

存量用户仍然使用 `reverse-spec` 命令时，系统打印 deprecation warning 提示迁移，但命令**正常执行**，不中断工作流。

**Why this priority**：breaking change 版本必须提供过渡期，避免存量用户流程中断。

**Independent Test**：执行 `reverse-spec batch --help`，确认打印 deprecation warning 且命令正常执行。

**Acceptance Scenarios**:

1. **Given** 用户执行 `reverse-spec batch`，**When** 命令触发，**Then** 先打印 deprecation warning（如 `[DEPRECATED] 'reverse-spec' is deprecated, use 'spectra' instead`），然后正常执行批处理
2. **Given** deprecation warning 被打印，**Then** 警告中包含迁移说明和新命令名称

---

### User Story 3 - Plugin 以新名称安装和识别（Priority: P2）

Claude Code 用户安装 plugin 时，plugin manifest 显示名称为 `spectra`，不再显示 `reverse-spec`。

**Why this priority**：用户界面的品牌标识，但不影响核心功能。

**Independent Test**：检查 `plugin.json` 和 `marketplace.json`，确认 name 字段为 `spectra`，并确认 postinstall 提示中引用新名称。

**Acceptance Scenarios**:

1. **Given** 用户查看插件列表，**When** 看到 spectra 插件，**Then** 显示名称为 `spectra@cc-plugin-market`
2. **Given** 旧版 `reverse-spec` plugin 已安装，**When** 安装 `spectra` plugin 并触发 postinstall，**Then** 检测到旧版并提示卸载

---

### User Story 4 - Skill 以新名称触发（Priority: P2）

用户在 Claude Code 中通过 `/spectra`、`/spectra-batch`、`/spectra-diff` 触发对应功能。旧 `/reverse-spec` 系列 skill 显示 redirect + deprecation notice。

**Why this priority**：skill 是用户主要交互入口之一，新品牌下需一致。

**Independent Test**：在 Claude Code 中执行 `/spectra`，确认触发正确功能。

**Acceptance Scenarios**:

1. **Given** 用户输入 `/spectra`，**When** 触发 skill，**Then** 执行单模块 spec 生成功能
2. **Given** 用户输入旧命令 `/reverse-spec`，**When** 触发旧 skill，**Then** 显示 deprecation notice 并 redirect 到 `/spectra`

---

### User Story 5 - MCP Server 以新名称注册（Priority: P2）

MCP Server 注册名从 `reverse-spec` 改为 `spectra`，所有 MCP tool 的 server 标识更新。

**Why this priority**：MCP 集成用户可通过新名称识别和调用服务。

**Independent Test**：启动 MCP Server，检查 server name 为 `spectra`。

**Acceptance Scenarios**:

1. **Given** MCP Server 启动，**When** 查看 server metadata，**Then** name 字段为 `spectra`
2. **Given** 现有 MCP tool 调用，**When** 通过新 server name 路由，**Then** 工具正常响应

---

### User Story 6 - 仓库完整性检查通过（Priority: P1）

所有配置文件、合同文件、文档和源码中的 `reverse-spec` 引用全部更新为 `spectra` / `spectra-cli`，`npm run repo:check` 通过。

**Why this priority**：重命名的完整性是本 feature 的质量门禁，遗漏任何引用都会造成不一致。

**Independent Test**：执行 `npm run repo:check`，无报错退出。

**Acceptance Scenarios**:

1. **Given** 所有文件已更新，**When** 执行 `npm run repo:check`，**Then** 零错误退出
2. **Given** `scripts/audit-rename.sh` 扫描全仓库，**When** 运行脚本，**Then** 无残留 `reverse-spec` 引用（除已知豁免项目如 git history、changelog）

---

### Edge Cases

- **spec-driver 内部引用**：spec-driver 有 15 处引用 reverse-spec（5 个文件），需同步更新，且 spec-driver 与本产品同版本同步发布
- **dist/ 目录**：构建产物中约 65 处引用，需重新构建覆盖，不手动修改
- **测试文件**：33 处引用，需全量更新，确保测试仍可通过
- **现有 specs/ 产物**：用户已生成的 spec 文件不得被修改，重命名对其零影响
- **package-lock.json**：包含受控 release 信息，通过 `release:sync` 脚本统一更新，不手动修改
- **changelog / git history**：历史记录中的 `reverse-spec` 字样属于豁免项，不更新
- **npm 注册表**：旧包 `reverse-spec` 不能强制废弃，需在 README 和 npm 页面说明迁移路径

---

## Requirements

### Functional Requirements

**核心重命名**

- **FR-001**: 系统 MUST 将 npm 包名从 `reverse-spec` 改为 `spectra-cli`，CLI bin 入口保持 `spectra` `[必须]`
- **FR-002**: 系统 MUST 保留 `reverse-spec` CLI alias，执行时打印 deprecation warning 后正常执行 `[必须]`
- **FR-003**: 系统 MUST 将 `plugin.json` 和 `marketplace.json` 中的 plugin name 从 `reverse-spec@cc-plugin-market` 更新为 `spectra@cc-plugin-market` `[必须]`
- **FR-004**: 系统 MUST 将 `src/mcp/server.ts` 中的 server name 从 `reverse-spec` 更新为 `spectra` `[必须]`
- **FR-005**: 系统 MUST 将 `release-contract.yaml` 中所有受控字段更新为新品牌标识，并通过 `npm run release:sync` 同步到下游文件 `[必须]`

**Skill 重命名**

- **FR-006**: 系统 MUST 创建 `/spectra`、`/spectra-batch`、`/spectra-diff` 新 skill 文件，功能与旧 skill 等价 `[必须]`
- **FR-007**: 系统 MUST 保留旧 `/reverse-spec*` skill 文件，内容改为 redirect + deprecation notice `[必须]`
- **FR-008**: 系统 MUST 将 skill 目录从 `skills/reverse-spec*/` 重命名为 `skills/spectra*/` `[必须]`

**Plugin 目录**

- **FR-009**: 系统 MUST 将 `plugins/reverse-spec/` 目录重命名为 `plugins/spectra/` `[必须]`

**spec-driver 联动**

- **FR-010**: 系统 MUST 将 spec-driver 内 5 个文件中的 15 处 `reverse-spec` 引用更新为 `spectra`，与本次 v3.0.0 同步发布 `[必须]`

**文档与合同**

- **FR-011**: 系统 MUST 更新 `README.md`、`AGENTS.md`、`CLAUDE.md` 及 `docs/` 目录中的品牌引用 `[必须]`
- **FR-012**: 系统 MUST 在新 `spectra` plugin 的 postinstall 脚本中检测旧版 `reverse-spec` plugin 并提示用户卸载 `[必须]`

**完整性验证**

- **FR-013**: 系统 MUST 在 `scripts/` 中提供或复用 `audit-rename.sh`，扫描全仓库残留 `reverse-spec` 引用 `[必须]`
- **FR-014**: 重命名完成后 `npm run repo:check` 和 `npm run release:check` MUST 均零错误通过 `[必须]`

**功能不变性**

- **FR-015**: 重命名 MUST 不影响任何现有功能：单模块 spec 生成、batch 批处理、diff 漂移检测、MCP tool 调用行为保持完全一致 `[必须]`
- **FR-016**: 重命名 MUST 不影响用户已生成的 `specs/` 目录下的任何 spec 文件 `[必须]`

**可选项**

- **FR-017**: 系统 MAY 在 `reverse-spec` npm 页面 README 中追加迁移说明（指向 `spectra-cli`） `[可选]`

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 |
|------|-----|
| 组件总数 | 2（新 skill 文件组、postinstall 脚本） |
| 接口数量 | 2（CLI bin alias、MCP server name） |
| 依赖新引入数 | 0 |
| 跨模块耦合 | 是（修改 package.json、plugin.json、marketplace.json、release-contract.yaml、src/mcp/server.ts、src/cli/index.ts、skill 目录、spec-driver 5 个文件） |
| 复杂度信号 | 无递归/状态机/并发控制/数据迁移；但涉及文件数量 250+，属于广度型变更 |
| **总体复杂度** | **MEDIUM**（文件广度高，但逻辑单一，无算法复杂度） |

**GATE_DESIGN 注意**：本 feature 的风险来自遗漏替换，而非逻辑错误。建议在 plan 阶段列出完整的文件变更清单，并通过 `audit-rename.sh` 作为验收门禁。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: `spectra batch --help` 在全新环境中可正常执行，耗时 < 3 秒
- **SC-002**: `reverse-spec batch` 执行时输出 deprecation warning，且命令正常完成（退出码 0）
- **SC-003**: `npm run repo:check` 和 `npm run release:check` 均零错误通过
- **SC-004**: `scripts/audit-rename.sh` 扫描后，源码（`src/`）和配置（`package.json`、`plugin.json`、`marketplace.json`、`release-contract.yaml`）中无残留 `reverse-spec` 引用
- **SC-005**: 所有现有单元测试和集成测试在重命名后继续通过
- **SC-006**: 用户已生成的 `specs/` 目录内容在重命名前后 bit-for-bit 一致（无修改）
