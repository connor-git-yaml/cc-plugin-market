# Data Model: Claude 订阅账号认证支持

**Branch**: `004-claude-sub-auth` | **Date**: 2026-02-12

## 实体

### AuthMethod（认证方式）

表示一种可用的 LLM 认证/调用方式。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| type | `'api-key' \| 'cli-proxy'` | 认证类型 |
| available | `boolean` | 是否可用 |
| details | `string` | 描述信息（如 API Key 前缀、CLI 版本） |

### AuthDetectionResult（认证检测结果）

认证检测器的输出，包含所有检测到的认证方式。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| methods | `AuthMethod[]` | 检测到的所有认证方式（按优先级排序） |
| preferred | `AuthMethod \| null` | 最高优先级的可用方式，无可用时为 null |
| diagnostics | `string[]` | 诊断信息（用于 auth-status 和错误提示） |

### CLIProxyConfig（CLI 代理配置）

控制 Claude CLI 子进程的行为参数。

| 字段 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| model | `string` | 继承 LLMConfig.model | Claude 模型 ID |
| timeout | `number` | 120000 | 超时时间（毫秒） |
| maxConcurrency | `number` | 3 | batch 模式最大并发进程数 |
| cliPath | `string \| undefined` | undefined（自动检测） | Claude CLI 可执行文件路径 |

### LLMResponse（已有，不变）

LLM 调用的统一返回结构，SDK 和 CLI 代理两种方式返回相同格式。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| content | `string` | 文本响应 |
| model | `string` | 实际使用的模型 |
| inputTokens | `number` | 发送的 token 数 |
| outputTokens | `number` | 接收的 token 数 |
| duration | `number` | 请求耗时（毫秒） |

## 关系

```text
AuthDetector
  ├── 检测 → AuthDetectionResult
  │             ├── methods: AuthMethod[]
  │             └── preferred: AuthMethod
  │
callLLM()
  ├── preferred.type === 'api-key'  → callLLMviaSdk()  [现有逻辑]
  └── preferred.type === 'cli-proxy' → callLLMviaCli()
                                         └── 使用 CLIProxyConfig
                                         └── 返回 LLMResponse（统一格式）
```

## 状态转换

### AuthMethod 检测流程

```text
[开始] → 检查 ANTHROPIC_API_KEY
           ├── 有 → { type: 'api-key', available: true }
           └── 无 → 检查 claude CLI
                      ├── 未安装 → { type: 'cli-proxy', available: false }
                      └── 已安装 → 检查登录状态
                                     ├── 未登录 → { type: 'cli-proxy', available: false }
                                     └── 已登录 → { type: 'cli-proxy', available: true }
```

### CLI 子进程生命周期

```text
[spawn] → [stdin 写入 prompt] → [等待 stdout]
                                    ├── 正常完成 → 解析输出 → LLMResponse
                                    ├── 超时 → kill 进程 → LLMTimeoutError
                                    ├── 退出码非 0 → 解析 stderr → LLMResponseError
                                    └── 进程异常 → LLMUnavailableError
```
