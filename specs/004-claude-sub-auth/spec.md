# Feature Specification: Claude 订阅账号认证支持

**Feature Branch**: `004-claude-sub-auth`
**Created**: 2026-02-12
**Status**: Draft (研究后修订)
**Input**: 支持 Claude 订阅账号认证，让使用 Claude Code 订阅版（Max/Pro）的用户无需单独设置 ANTHROPIC_API_KEY 即可使用所有 LLM 功能。

## 背景

当前 reverse-spec 的 `generate` 和 `diff` 命令仅支持 `ANTHROPIC_API_KEY` 环境变量作为唯一认证方式。但许多用户已经拥有 Claude Max/Pro 订阅（$100/$200/月），他们通过 Claude Code 的 OAuth 登录已完成认证。这些用户不应该被迫额外购买 API 额度或配置 API Key。

**技术约束**：研究发现 Anthropic 限制 OAuth token 仅授权给 Claude Code 使用，第三方工具无法直接用 OAuth token 调用 API。参考 OpenClaw 等社区工具的做法，通过 spawn Claude Code CLI 子进程间接完成 LLM 调用——从 Anthropic 角度看请求来自正版 Claude Code CLI。

## Clarifications

### Session 2026-02-12

- Q: Windows 平台是否在支持范围内？ → A: 仅支持 macOS + Linux，Windows 明确排除出范围
- Q: Token 刷新后是否持久化写回凭证存储？ → A: 不适用（改为 CLI 子进程方案，token 管理由 Claude Code CLI 自身负责）
- Q: auth-status 子命令的验证深度？ → A: 默认离线检查（CLI 存在性 + 认证状态），提供 `--verify` 标志可选在线验证

### Session 2026-02-12 (研究后修订)

- Q: 是否直接读取 OAuth token 调用 SDK？ → A: 不可行，Anthropic 限制 OAuth token 仅限 Claude Code 使用。改为 spawn Claude Code CLI 子进程方案（与 OpenClaw/claude-max-api-proxy 相同）

## User Scenarios & Testing

### User Story 1 - 订阅用户通过 CLI 代理使用 generate/diff（Priority: P1）

用户已通过 `claude auth login` 登录 Claude Code（Claude Max/Pro 订阅），在终端运行 `reverse-spec generate src/auth/` 或 `reverse-spec diff spec.md src/auth/`。系统检测到无 API Key 但 Claude Code CLI 已认证，自动 spawn CLI 子进程完成 LLM 调用。

**Why this priority**: 这是核心价值——消除订阅用户的 API Key 配置障碍，让已付费用户立即能用。

**Independent Test**: 在已登录 Claude Code 且未设置 `ANTHROPIC_API_KEY` 的环境中运行 `reverse-spec generate`，命令应通过 CLI 代理正常完成并生成 spec。

**Acceptance Scenarios**:

1. **Given** 用户已通过 `claude auth login` 登录，且未设置 `ANTHROPIC_API_KEY`，**When** 用户运行 `reverse-spec generate src/module/`，**Then** 系统自动通过 Claude CLI 子进程完成 LLM 调用，生成 spec 文件
2. **Given** 用户同时设置了 `ANTHROPIC_API_KEY` 且 Claude CLI 已登录，**When** 用户运行 generate 命令，**Then** 系统优先使用 API Key（直接 SDK 调用，更稳定、更快）
3. **Given** 用户既无 API Key 也未安装/登录 Claude CLI，**When** 用户运行 generate 命令，**Then** 系统提示两种认证方式：设置 API Key 或安装并登录 Claude Code
4. **Given** 用户通过 CLI 代理生成 spec，**When** 生成完成，**Then** 输出结果与 API Key 方式生成的 spec 格式完全一致

---

### User Story 2 - 认证状态诊断（Priority: P2）

用户不确定当前环境的认证状态，希望快速了解哪些认证方式可用。

**Why this priority**: 帮助用户排查认证问题，降低配置成本。

**Independent Test**: 运行 `reverse-spec auth-status`，显示当前可用的认证方式列表。

**Acceptance Scenarios**:

1. **Given** 用户已设置 API Key 且 Claude CLI 已登录，**When** 运行 `reverse-spec auth-status`，**Then** 显示两种认证方式均可用及优先级
2. **Given** 仅 Claude CLI 已登录（无 API Key），**When** 运行 `reverse-spec auth-status`，**Then** 显示 CLI 代理可用，并说明将通过 CLI 子进程调用
3. **Given** 无任何认证方式，**When** 运行 `reverse-spec auth-status`，**Then** 显示未找到凭证，并给出两种配置方式的指引
4. **Given** 用户运行 `reverse-spec auth-status --verify`，**When** Claude CLI 已安装但未登录，**Then** 显示 CLI 存在但未认证，建议运行 `claude auth login`

---

### Edge Cases

- Claude CLI 子进程超时（默认 120 秒）时，给出清晰错误并建议检查网络或订阅状态
- Claude CLI 已安装但版本过低不支持 `--print` 或 `--output-format` 参数时，给出版本要求提示
- Claude CLI 进程被意外终止（SIGTERM/SIGKILL）时，清理子进程资源并报错
- Claude CLI 返回认证错误（订阅过期、token 失效）时，识别错误类型并给出对应建议
- 并发调用（batch 模式）时，控制同时 spawn 的 CLI 进程数量，避免资源耗尽

### Out of Scope

- Windows 平台支持（仅支持 macOS 和 Linux）
- 直接读取 OAuth token 调用 SDK（Anthropic 限制，技术不可行）
- OAuth 浏览器登录流程（依赖用户已通过 Claude Code 完成登录）
- Token 管理（由 Claude Code CLI 自身负责）

## Requirements

### Functional Requirements

- **FR-001**: 系统必须支持两种 LLM 调用方式：(1) `ANTHROPIC_API_KEY` 环境变量直接调用 SDK，(2) spawn Claude Code CLI 子进程间接调用
- **FR-002**: 系统必须按优先级顺序选择调用方式：`ANTHROPIC_API_KEY` > Claude CLI 子进程
- **FR-003**: 通过 CLI 子进程调用时，系统必须将组装好的 prompt 传给 CLI，并解析 CLI 的输出为与 SDK 调用相同的格式
- **FR-004**: 系统必须在 spawn CLI 前检测 CLI 是否已安装且已认证，不可用时给出诊断信息
- **FR-005**: 系统在所有认证方式均不可用时必须给出清晰的诊断信息，列出两种可用的配置方法
- **FR-006**: 现有的 `ANTHROPIC_API_KEY` 认证方式必须保持完全向后兼容，已有用户无需任何改动
- **FR-007**: 系统必须提供认证状态查询功能（`auth-status` 子命令），检测 API Key 和 Claude CLI 的可用性
- **FR-008**: CLI 子进程的超时、错误处理必须与现有 SDK 调用的错误处理保持一致（超时、重试、降级）
- **FR-009**: 系统仅支持 macOS 和 Linux 平台
- **FR-010**: batch 模式下必须限制并发 CLI 子进程数量，防止资源耗尽

### Key Entities

- **LLM 调用策略（LLM Call Strategy）**: 抽象 LLM 调用方式，支持 SDK 直接调用和 CLI 子进程两种实现
- **CLI 代理（CLI Proxy）**: 封装 Claude Code CLI 子进程的 spawn、输入/输出解析、超时管理、错误处理
- **认证检测器（Auth Detector）**: 检测当前环境可用的认证方式（API Key 存在性、CLI 安装状态、CLI 登录状态）

## Success Criteria

### Measurable Outcomes

- **SC-001**: 已登录 Claude Code 的订阅用户在未设置 `ANTHROPIC_API_KEY` 的情况下可直接运行 `reverse-spec generate`，成功率 ≥ 95%
- **SC-002**: CLI 代理方式的 LLM 调用延迟不超过 API Key 方式的 2 倍（进程启动开销可接受）
- **SC-003**: 已有使用 `ANTHROPIC_API_KEY` 的用户升级后行为完全不变，零破坏性变更
- **SC-004**: 认证失败时的诊断信息能让用户在 2 分钟内理解问题并找到解决方案
- **SC-005**: 通过 CLI 代理生成的 spec 与通过 API Key 生成的 spec 格式和质量完全一致

## Assumptions

- 用户已安装 Claude Code CLI 并通过 `claude auth login` 完成登录
- Claude Code CLI 支持 `--print`、`--output-format stream-json` 等非交互式输出参数
- Anthropic 不会封杀通过 spawn CLI 子进程方式的间接调用（TOS 灰色地带，但社区项目长期稳定运行）
- Claude Code CLI 的命令行参数和输出格式在版本间保持稳定
- 仅支持 macOS 和 Linux 平台
