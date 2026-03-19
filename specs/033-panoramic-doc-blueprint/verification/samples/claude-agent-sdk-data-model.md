# 数据模型文档

## 概览

| 指标 | 值 |
|------|-----|
| 模型总数 | 25 |
| 字段总数 | 148 |
| python 模型数 | 25 |
| dataclass 数量 | 25 |

---

## Python 数据模型

### SdkMcpTool

**文件**: `src/claude_agent_sdk/__init__.py`
**类型**: dataclass
**继承**: `Generic[T]`

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `name` | `str` | 否 | — | [AI] 工具的唯一标识名称，用于在 MCP 协议中注册和调用 |
| `description` | `str` | 否 | — | [AI] 工具的功能描述，向 LLM 说明该工具的用途和使用场景 |
| `input_schema` | `type[T] | dict[str, Any]` | 否 | — | [AI] 工具的输入参数结构定义，支持 Pydantic 模型类或原始 JSON Schema 字典 |
| `handler` | `Callable[[T], Awaitable[dict[str, Any]]]` | 否 | — | [AI] 工具的异步处理函数，接收解析后的输入参数并返回执行结果 |
| `annotations` | `ToolAnnotations | None` | 是 | `None` | [AI] 工具的附加元数据注解，用于描述工具行为特性（如只读、破坏性等） |

### AgentDefinition

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `description` | `str` | 否 | — | [AI] Agent 的功能描述，用于说明该 Agent 的用途和能力 |
| `prompt` | `str` | 否 | — | [AI] Agent 的系统提示词，定义其行为规则和执行上下文 |
| `tools` | `list[str] | None` | 是 | `None` | [AI] Agent 可使用的工具列表，限定其可调用的能力范围 |
| `model` | `Literal["sonnet", "opus", "haiku", "inherit"] | None` | 是 | `None` | [AI] Agent 使用的 Claude 模型版本，支持继承父级配置 |
| `skills` | `list[str] | None` | 是 | `None` | [AI] Agent 可调用的技能列表，扩展其专项处理能力 |
| `memory` | `Literal["user", "project", "local"] | None` | 是 | `None` | [AI] Agent 的记忆作用域，决定其访问用户/项目/本地记忆的权限 |
| `mcpServers` | `list[str | dict[str, Any]] | None` | 是 | `None  # noqa: N815` | [AI] Agent 可连接的 MCP 服务器列表，用于扩展外部工具访问能力 |

### AssistantMessage

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `content` | `list[ContentBlock]` | 否 | — | [AI] 助手消息的内容块列表，包含文本或工具调用等结构化内容 |
| `model` | `str` | 否 | — | [AI] 生成该消息所使用的模型标识符 |
| `parent_tool_use_id` | `str | None` | 是 | `None` | [AI] 触发此助手消息的父级工具调用ID，用于追踪调用链 |
| `error` | `AssistantMessageError | None` | 是 | `None` | [AI] 消息生成过程中发生的错误信息，无错误时为空 |
| `usage` | `dict[str, Any] | None` | 是 | `None` | [AI] 本次消息的Token用量统计信息，如输入输出Token数 |

### ClaudeAgentOptions

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `tools` | `list[str] | ToolsPreset | None` | 是 | `None` | [AI] 指定 Agent 可使用的工具列表或预设集合 |
| `allowed_tools` | `list[str]` | 否 | `list()` | [AI] 明确允许 Agent 使用的工具名称白名单 |
| `system_prompt` | `str | SystemPromptPreset | None` | 是 | `None` | [AI] 注入给 Agent 的系统提示词或预设角色 |
| `mcp_servers` | `dict[str, McpServerConfig] | str | Path` | 否 | `dict()` | [AI] 配置 MCP 服务器连接信息，支持字典或配置文件路径 |
| `permission_mode` | `PermissionMode | None` | 是 | `None` | [AI] 控制工具调用权限的审批模式 |
| `continue_conversation` | `bool` | 否 | `False` | [AI] 是否继续上一次会话而非开启新会话 |
| `resume` | `str | None` | 是 | `None` | [AI] 指定要恢复的历史会话 ID |
| `max_turns` | `int | None` | 是 | `None` | [AI] 限制 Agent 最大对话轮次，防止无限循环 |
| `max_budget_usd` | `float | None` | 是 | `None` | [AI] 单次运行的最大 API 费用预算（美元） |
| `disallowed_tools` | `list[str]` | 否 | `list()` | [AI] 明确禁止 Agent 使用的工具名称黑名单 |
| `model` | `str | None` | 是 | `None` | [AI] 指定运行 Agent 使用的 Claude 模型 ID |
| `fallback_model` | `str | None` | 是 | `None` | [AI] 主模型不可用时的备用模型 ID |
| `betas` | `list[SdkBeta]` | 否 | `list()` | [AI] 启用的 SDK Beta 功能特性列表 |
| `permission_prompt_tool_name` | `str | None` | 是 | `None` | [AI] 用于交互式权限审批的自定义工具名称 |
| `cwd` | `str | Path | None` | 是 | `None` | [AI] Agent 运行时的工作目录路径 |
| `cli_path` | `str | Path | None` | 是 | `None` | [AI] Claude CLI 可执行文件的自定义路径 |
| `settings` | `str | None` | 是 | `None` | [AI] 指定 Agent 使用的配置文件路径或名称 |
| `add_dirs` | `list[str | Path]` | 否 | `list()` | [AI] 额外挂载到 Agent 工作环境中的目录列表 |
| `env` | `dict[str, str]` | 否 | `dict()` | [AI] 注入 Agent 子进程的环境变量键值对 |
| `extra_args` | `dict[str, str | None]` | 是 | — | [AI] 透传给底层 CLI 的额外命令行参数 |
| `max_buffer_size` | `int | None` | 是 | `None  # Max bytes when buffering CLI stdout` | [AI] 进程输出缓冲区的最大字节数限制 |
| `debug_stderr` | `Any` | 否 | `(` | [AI] 调试模式下标准错误输出的处理配置 |
| `stderr` | `Callable[[str], None] | None` | 是 | `None  # Callback for stderr output from CLI` | [AI] 自定义标准错误输出的回调处理函数 |
| `can_use_tool` | `CanUseTool | None` | 是 | `None` | [AI] 运行时动态判断是否允许使用某工具的回调 |
| `hooks` | `dict[HookEvent, list[HookMatcher]] | None` | 是 | `None` | [AI] 绑定到特定 Hook 事件的处理器列表映射 |
| `user` | `str | None` | 是 | `None` | [AI] 标识当前操作用户的身份信息 |
| `include_partial_messages` | `bool` | 否 | `False` | [AI] 是否在流式输出中包含未完成的中间消息 |
| `fork_session` | `bool` | 否 | `False` | [AI] 是否从当前会话 fork 出独立子会话运行 |
| `agents` | `dict[str, AgentDefinition] | None` | 是 | `None` | [AI] 注册的子 Agent 定义映射，支持多 Agent 协作 |
| `setting_sources` | `list[SettingSource] | None` | 是 | `None` | [AI] 配置来源优先级列表，控制设置加载顺序 |
| `sandbox` | `SandboxSettings | None` | 是 | `None` | [AI] 沙箱隔离环境的配置，限制 Agent 运行权限 |
| `plugins` | `list[SdkPluginConfig]` | 否 | `list()` | [AI] 加载的 SDK 插件配置列表，扩展 Agent 能力 |
| `max_thinking_tokens` | `int | None` | 是 | `None` | [AI] 扩展思考模式下最大思考 token 数量限制 |
| `thinking` | `ThinkingConfig | None` | 是 | `None` | [AI] 扩展思考功能的详细配置参数 |
| `effort` | `Literal["low", "medium", "high", "max"] | None` | 是 | `None` | [AI] 任务执行力度等级，影响模型推理深度与成本 |
| `output_format` | `dict[str, Any] | None` | 是 | `None` | [AI] 指定结构化输出的 JSON Schema 格式定义 |
| `enable_file_checkpointing` | `bool` | 否 | `False` | [AI] 是否启用文件检查点，支持任务中断后恢复 |

### HookMatcher

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `matcher` | `str | None` | 是 | `None` | [AI] 用于匹配触发条件的模式字符串，为 null 时表示匹配所有事件 |
| `hooks` | `list[HookCallback]` | 否 | `list()` | [AI] 当匹配条件满足时依次执行的回调函数列表 |
| `timeout` | `float | None` | 是 | `None` | [AI] 单个 Hook 回调的最大执行超时时间（秒），为 null 时不限制 |

### PermissionResultAllow

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `behavior` | `Literal["allow"]` | 否 | `"allow"` | [AI] 权限结果类型，固定值为 "allow"，表示该操作被允许 |
| `updated_input` | `dict[str, Any] | None` | 是 | `None` | [AI] 经过权限处理后修改的输入参数，为空则表示输入未变更 |
| `updated_permissions` | `list[PermissionUpdate] | None` | 是 | `None` | [AI] 本次操作触发的权限更新列表，为空则无权限变更 |

### PermissionResultDeny

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `behavior` | `Literal["deny"]` | 否 | `"deny"` | [AI] 权限结果类型标识，固定值为 "deny"，表示拒绝该操作 |
| `message` | `str` | 否 | `""` | [AI] 拒绝原因说明，向用户展示的提示信息 |
| `interrupt` | `bool` | 否 | `False` | [AI] 是否中断当前执行流程，true 表示立即中止 |

### PermissionRuleValue

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `tool_name` | `str` | 否 | — | [AI] 权限规则所适用的工具名称，如 Bash、Read 等 |
| `rule_content` | `str | None` | 是 | `None` | [AI] 权限规则的具体内容或匹配条件，为空表示无附加约束 |

### PermissionUpdate

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `type` | `Literal[` | 否 | — | [AI] 权限更新操作的类型标识，固定为特定字面量值 |
| `rules` | `list[PermissionRuleValue] | None` | 是 | `None` | [AI] 权限规则列表，定义具体的允许或拒绝规则 |
| `behavior` | `PermissionBehavior | None` | 是 | `None` | [AI] 权限的默认行为策略，如允许或拒绝 |
| `mode` | `PermissionMode | None` | 是 | `None` | [AI] 权限运行模式，控制权限检查的严格程度 |
| `directories` | `list[str] | None` | 是 | `None` | [AI] 权限作用的目录路径列表，限定权限范围 |
| `destination` | `PermissionUpdateDestination | None` | 是 | `None` | [AI] 权限更新的目标位置，如全局或项目级配置 |

### RateLimitEvent

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `rate_limit_info` | `RateLimitInfo` | 否 | — | [AI] 速率限制的详细信息，包含限制阈值、剩余配额等数据 |
| `uuid` | `str` | 否 | — | [AI] 速率限制事件的唯一标识符 |
| `session_id` | `str` | 否 | — | [AI] 触发此速率限制事件所属的会话标识符 |

### RateLimitInfo

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `status` | `RateLimitStatus` | 否 | — | [AI] 当前速率限制的状态（如正常、受限等） |
| `resets_at` | `int | None` | 是 | `None` | [AI] 速率限制重置的 Unix 时间戳 |
| `rate_limit_type` | `RateLimitType | None` | 是 | `None` | [AI] 速率限制的类型分类 |
| `utilization` | `float | None` | 是 | `None` | [AI] 当前速率配额的使用比例（0.0~1.0） |
| `overage_status` | `RateLimitStatus | None` | 是 | `None` | [AI] 超额用量的限制状态 |
| `overage_resets_at` | `int | None` | 是 | `None` | [AI] 超额限制重置的 Unix 时间戳 |
| `overage_disabled_reason` | `str | None` | 是 | `None` | [AI] 超额功能被禁用的原因说明 |
| `raw` | `dict[str, Any]` | 否 | `dict()` | [AI] 来自 API 的原始速率限制响应数据 |

### ResultMessage

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `subtype` | `str` | 否 | — | [AI] 结果消息的子类型标识，用于区分不同类别的结果 |
| `duration_ms` | `int` | 否 | — | [AI] 整个会话的总耗时，单位为毫秒 |
| `duration_api_ms` | `int` | 否 | — | [AI] API 调用累计耗时，单位为毫秒 |
| `is_error` | `bool` | 否 | — | [AI] 标识本次执行是否以错误结束 |
| `num_turns` | `int` | 否 | — | [AI] 会话中的对话轮次总数 |
| `session_id` | `str` | 否 | — | [AI] 会话的唯一标识符 |
| `stop_reason` | `str | None` | 是 | `None` | [AI] 会话终止的原因，如达到限制或正常结束 |
| `total_cost_usd` | `float | None` | 是 | `None` | [AI] 本次会话消耗的 API 费用，单位为美元 |
| `usage` | `dict[str, Any] | None` | 是 | `None` | [AI] Token 用量统计，包含输入输出 token 数等详情 |
| `result` | `str | None` | 是 | `None` | [AI] 会话最终输出的文本结果 |
| `structured_output` | `Any` | 否 | `None` | [AI] 按结构化格式返回的输出内容，类型由调用方定义 |

### SDKSessionInfo

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `session_id` | `str` | 否 | — | [AI] 会话的唯一标识符 |
| `summary` | `str` | 否 | — | [AI] 会话内容的摘要描述 |
| `last_modified` | `int` | 否 | — | [AI] 会话最后修改时间的时间戳（Unix 秒） |
| `file_size` | `int` | 否 | — | [AI] 会话文件的大小（字节数） |
| `custom_title` | `str | None` | 是 | `None` | [AI] 用户自定义的会话标题，未设置时为空 |
| `first_prompt` | `str | None` | 是 | `None` | [AI] 会话中用户输入的第一条提示词，未记录时为空 |
| `git_branch` | `str | None` | 是 | `None` | [AI] 会话关联的 Git 分支名称，未关联时为空 |
| `cwd` | `str | None` | 是 | `None` | [AI] 会话启动时的工作目录路径，未记录时为空 |

### SessionMessage

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `type` | `Literal["user", "assistant"]` | 否 | — | [AI] 消息发送方角色，区分用户消息与助手消息 |
| `uuid` | `str` | 否 | — | [AI] 消息的全局唯一标识符 |
| `session_id` | `str` | 否 | — | [AI] 消息所属的会话 ID，用于关联同一对话中的消息 |
| `message` | `Any` | 否 | — | [AI] 消息的具体内容，支持任意类型 |
| `parent_tool_use_id` | `None` | 否 | `None` | [AI] 父级工具调用 ID，当前字段固定为空，用于消息树结构中的占位 |

### StreamEvent

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `uuid` | `str` | 否 | — | [AI] 流事件的唯一标识符 |
| `session_id` | `str` | 否 | — | [AI] 所属会话的唯一标识符 |
| `event` | `dict[str, Any]  # The raw Anthropic API stream event` | 否 | — | [AI] 来自 Anthropic API 的原始流式事件数据 |
| `parent_tool_use_id` | `str | None` | 是 | `None` | [AI] 触发此事件的父级工具调用 ID，无则为空 |

### SystemMessage

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `subtype` | `str` | 否 | — | [AI] 系统消息的子类型标识，用于区分不同种类的系统事件 |
| `data` | `dict[str, Any]` | 否 | — | [AI] 系统消息携带的附加载荷数据，以键值对形式存储消息详情 |

### TaskNotificationMessage

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass
**继承**: `SystemMessage`

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `task_id` | `str` | 否 | — | [AI] 任务的唯一标识符，用于关联和追踪特定任务 |
| `status` | `TaskNotificationStatus` | 否 | — | [AI] 任务当前的通知状态，表示任务所处的执行阶段 |
| `output_file` | `str` | 否 | — | [AI] 任务输出结果写入的文件路径 |
| `summary` | `str` | 否 | — | [AI] 任务执行结果的简短摘要描述 |
| `uuid` | `str` | 否 | — | [AI] 消息的全局唯一标识符，用于去重和追踪 |
| `session_id` | `str` | 否 | — | [AI] 所属会话的标识符，用于关联同一会话内的消息 |
| `tool_use_id` | `str | None` | 是 | `None` | [AI] 触发此任务的工具调用 ID，可为空 |
| `usage` | `TaskUsage | None` | 是 | `None` | [AI] 任务执行过程中的资源用量统计，可为空 |

### TaskProgressMessage

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass
**继承**: `SystemMessage`

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `task_id` | `str` | 否 | — | [AI] 任务的唯一标识符，用于追踪和关联特定任务 |
| `description` | `str` | 否 | — | [AI] 任务的文字描述，说明当前任务的目的或内容 |
| `usage` | `TaskUsage` | 否 | — | [AI] 任务的资源使用统计信息，如 token 消耗量 |
| `uuid` | `str` | 否 | — | [AI] 消息的全局唯一标识符，用于去重和追踪 |
| `session_id` | `str` | 否 | — | [AI] 所属会话的标识符，用于关联同一会话中的多条消息 |
| `tool_use_id` | `str | None` | 是 | `None` | [AI] 当前正在使用的工具调用 ID，无工具调用时为空 |
| `last_tool_name` | `str | None` | 是 | `None` | [AI] 最近一次调用的工具名称，无工具调用时为空 |

### TaskStartedMessage

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass
**继承**: `SystemMessage`

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `task_id` | `str` | 否 | — | [AI] 任务的唯一标识符，用于在系统中定位和跟踪该任务 |
| `description` | `str` | 否 | — | [AI] 任务的简短文字描述，说明任务的目的或内容 |
| `uuid` | `str` | 否 | — | [AI] 任务的全局唯一 UUID，通常用于跨系统的去重和幂等校验 |
| `session_id` | `str` | 否 | — | [AI] 所属会话的标识符，关联任务与其发起的对话上下文 |
| `tool_use_id` | `str | None` | 是 | `None` | [AI] 触发该任务的工具调用 ID，若任务非工具调用发起则为空 |
| `task_type` | `str | None` | 是 | `None` | [AI] 任务的类型分类标签，用于区分不同处理逻辑的任务种类 |

### TextBlock

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `text` | `str` | 否 | — | [AI] 文本块的具体文字内容 |

### ThinkingBlock

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `thinking` | `str` | 否 | — | [AI] 模型的思考过程文本，记录推理链路的中间步骤 |
| `signature` | `str` | 否 | — | [AI] 思考块的签名标识，用于验证内容完整性 |

### ToolPermissionContext

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `signal` | `Any | None` | 是 | `None  # Future: abort signal support` | [AI] 工具权限上下文的触发信号或状态标识，可为空 |
| `suggestions` | `list[PermissionUpdate]` | 否 | — | [AI] 系统推荐的权限变更建议列表 |

### ToolResultBlock

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `tool_use_id` | `str` | 否 | — | [AI] 关联的工具调用请求 ID，用于匹配工具调用与结果 |
| `content` | `str | list[dict[str, Any]] | None` | 是 | `None` | [AI] 工具执行返回的结果内容，可为文本或结构化数据列表 |
| `is_error` | `bool | None` | 是 | `None` | [AI] 标记工具执行是否发生错误，为 true 时表示执行失败 |

### ToolUseBlock

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `id` | `str` | 否 | — | [AI] 工具调用的唯一标识符 |
| `name` | `str` | 否 | — | [AI] 被调用工具的名称 |
| `input` | `dict[str, Any]` | 否 | — | [AI] 传递给工具的参数键值对 |

### UserMessage

**文件**: `src/claude_agent_sdk/types.py`
**类型**: dataclass

| 字段名 | 类型 | 可选 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `content` | `str | list[ContentBlock]` | 否 | — | [AI] 消息的主体内容，可以是纯文本字符串或结构化内容块列表 |
| `uuid` | `str | None` | 是 | `None` | [AI] 消息的唯一标识符，用于追踪和引用特定消息 |
| `parent_tool_use_id` | `str | None` | 是 | `None` | [AI] 关联的父级工具调用 ID，表明此消息是某次工具调用的响应 |
| `tool_use_result` | `dict[str, Any] | None` | 是 | `None` | [AI] 工具调用返回的结果数据，以键值对形式存储 |

## 实体关系图

```mermaid
erDiagram
    SdkMcpTool {
        str name
        str description
        type_T__dict_strAny_ input_schema
        Callable__T_Awaitable_dict_strAny___ handler
        ToolAnnotations_None annotations
    }
    AgentDefinition {
        str description
        str prompt
        list_str__None tools
        Literal_sonnetopushaikuinherit__None model
        list_str__None skills
        Literal_userprojectlocal__None memory
        list_str_dict_strAny___None mcpServers
    }
    AssistantMessage {
        list_ContentBlock_ content
        str model
        str_None parent_tool_use_id
        AssistantMessageError_None error
        dict_strAny__None usage
    }
    ClaudeAgentOptions {
        list_str__ToolsPreset_None tools
        list_str_ allowed_tools
        str_SystemPromptPreset_None system_prompt
        dict_strMcpServerConfig__str_Path mcp_servers
        PermissionMode_None permission_mode
        bool continue_conversation
        str_None resume
        int_None max_turns
        float_None max_budget_usd
        list_str_ disallowed_tools
        str_None model
        str_None fallback_model
        list_SdkBeta_ betas
        str_None permission_prompt_tool_name
        str_Path_None cwd
        str_Path_None cli_path
        str_None settings
        list_str_Path_ add_dirs
        dict_strstr_ env
        dict_strstr_None_ extra_args
        int_None max_buffer_size
        Any debug_stderr
        Callable__str_None__None stderr
        CanUseTool_None can_use_tool
        dict_HookEventlist_HookMatcher___None hooks
        str_None user
        bool include_partial_messages
        bool fork_session
        dict_strAgentDefinition__None agents
        list_SettingSource__None setting_sources
        SandboxSettings_None sandbox
        list_SdkPluginConfig_ plugins
        int_None max_thinking_tokens
        ThinkingConfig_None thinking
        Literal_lowmediumhighmax__None effort
        dict_strAny__None output_format
        bool enable_file_checkpointing
    }
    HookMatcher {
        str_None matcher
        list_HookCallback_ hooks
        float_None timeout
    }
    PermissionResultAllow {
        Literal_allow_ behavior
        dict_strAny__None updated_input
        list_PermissionUpdate__None updated_permissions
    }
    PermissionResultDeny {
        Literal_deny_ behavior
        str message
        bool interrupt
    }
    PermissionRuleValue {
        str tool_name
        str_None rule_content
    }
    PermissionUpdate {
        Literal_ type
        list_PermissionRuleValue__None rules
        PermissionBehavior_None behavior
        PermissionMode_None mode
        list_str__None directories
        PermissionUpdateDestination_None destination
    }
    RateLimitEvent {
        RateLimitInfo rate_limit_info
        str uuid
        str session_id
    }
    RateLimitInfo {
        RateLimitStatus status
        int_None resets_at
        RateLimitType_None rate_limit_type
        float_None utilization
        RateLimitStatus_None overage_status
        int_None overage_resets_at
        str_None overage_disabled_reason
        dict_strAny_ raw
    }
    ResultMessage {
        str subtype
        int duration_ms
        int duration_api_ms
        bool is_error
        int num_turns
        str session_id
        str_None stop_reason
        float_None total_cost_usd
        dict_strAny__None usage
        str_None result
        Any structured_output
    }
    SDKSessionInfo {
        str session_id
        str summary
        int last_modified
        int file_size
        str_None custom_title
        str_None first_prompt
        str_None git_branch
        str_None cwd
    }
    SessionMessage {
        Literal_userassistant_ type
        str uuid
        str session_id
        Any message
        None parent_tool_use_id
    }
    StreamEvent {
        str uuid
        str session_id
        dict_strAny_TherawAnthropicAPIstreamevent event
        str_None parent_tool_use_id
    }
    SystemMessage {
        str subtype
        dict_strAny_ data
    }
    TaskNotificationMessage {
        str task_id
        TaskNotificationStatus status
        str output_file
        str summary
        str uuid
        str session_id
        str_None tool_use_id
        TaskUsage_None usage
    }
    TaskProgressMessage {
        str task_id
        str description
        TaskUsage usage
        str uuid
        str session_id
        str_None tool_use_id
        str_None last_tool_name
    }
    TaskStartedMessage {
        str task_id
        str description
        str uuid
        str session_id
        str_None tool_use_id
        str_None task_type
    }
    TextBlock {
        str text
    }
    ThinkingBlock {
        str thinking
        str signature
    }
    ToolPermissionContext {
        Any_None signal
        list_PermissionUpdate_ suggestions
    }
    ToolResultBlock {
        str tool_use_id
        str_list_dict_strAny___None content
        bool_None is_error
    }
    ToolUseBlock {
        str id
        str name
        dict_strAny_ input
    }
    UserMessage {
        str_list_ContentBlock_ content
        str_None uuid
        str_None parent_tool_use_id
        dict_strAny__None tool_use_result
    }
    PermissionUpdate ||--o| PermissionRuleValue : "has"
    ToolPermissionContext ||--o| PermissionUpdate : "has"
    PermissionResultAllow ||--o| PermissionUpdate : "has"
    SystemMessage ||--o{ TaskStartedMessage : "inherits"
    SystemMessage ||--o{ TaskProgressMessage : "inherits"
    SystemMessage ||--o{ TaskNotificationMessage : "inherits"
    RateLimitEvent ||--o| RateLimitInfo : "has"
    ClaudeAgentOptions ||--o| HookMatcher : "has"
    ClaudeAgentOptions ||--o| AgentDefinition : "has"
```
