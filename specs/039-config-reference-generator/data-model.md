# 数据模型: 配置参考手册生成

**Feature**: 039-config-reference-generator
**Date**: 2026-03-19

## 实体定义

### ConfigFormat（枚举）

配置文件格式类型。

| 值 | 说明 |
|-----|------|
| `yaml` | YAML 格式（.yaml, .yml） |
| `toml` | TOML 格式（.toml） |
| `env` | 环境变量格式（.env, .env.*） |

### ConfigEntry

单个配置项的结构化表示。

| 字段 | 类型 | 说明 |
|------|------|------|
| keyPath | string | 点号分隔的配置项路径（如 `database.host`） |
| type | string | 推断的值类型（string/number/boolean/array/object/null） |
| defaultValue | string | 当前值的字符串表示 |
| description | string | 从注释提取的说明文本（无注释时为空字符串） |

### ConfigFileResult

单个配置文件的解析结果。

| 字段 | 类型 | 说明 |
|------|------|------|
| filePath | string | 配置文件相对于项目根目录的路径 |
| format | ConfigFormat | 文件格式类型 |
| entries | ConfigEntry[] | 该文件中的所有配置项 |

### ConfigReferenceInput（TInput）

extract() 步骤的输出，作为 generate() 的输入。

| 字段 | 类型 | 说明 |
|------|------|------|
| files | ConfigFileResult[] | 所有发现的配置文件解析结果 |
| projectName | string | 项目名称（从 package.json 提取） |

### ConfigReferenceOutput（TOutput）

generate() 步骤的输出，作为 render() 的输入。

| 字段 | 类型 | 说明 |
|------|------|------|
| title | string | 文档标题 |
| projectName | string | 项目名称 |
| generatedAt | string | 生成时间戳 |
| files | ConfigFileResult[] | 按文件名排序的配置文件结果 |
| totalEntries | number | 配置项总数 |

## 实体关系

```
ConfigReferenceInput
  └── files: ConfigFileResult[]
        ├── filePath
        ├── format: ConfigFormat
        └── entries: ConfigEntry[]
              ├── keyPath
              ├── type
              ├── defaultValue
              └── description

ConfigReferenceInput → generate() → ConfigReferenceOutput
ConfigReferenceOutput → render() → Markdown string
```
