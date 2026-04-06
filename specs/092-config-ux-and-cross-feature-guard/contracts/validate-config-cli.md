---
feature: "092-config-ux-and-cross-feature-guard"
type: interface-contract
created: 2026-04-06
---

# validate-config.mjs CLI 接口合同

## 调用方

- `plugins/spec-driver/scripts/init-project.sh` -- 项目初始化阶段
- `npm run repo:check` 链路 -- 通过 `repo-maintenance-core.mjs` 消费 createCheck 输出

## 命令行接口

```bash
node plugins/spec-driver/scripts/validate-config.mjs \
  --project-root <path> \
  [--validate] \
  [--show-effective] \
  [--preset <name>] \
  [--json]
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--project-root` | 是 | 项目根目录路径（用于定位 config.yaml） |
| `--validate` | 否 | 执行 Schema 校验模式 |
| `--show-effective` | 否 | 输出 effective config 表格 |
| `--preset` | 否 | 命令行 preset 覆盖（仅与 `--show-effective` 配合使用） |
| `--json` | 否 | 以 JSON 格式输出结果（用于程序化消费） |

### 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 校验通过 / effective config 输出成功 |
| 1 | Schema 校验失败 |
| 2 | YAML 语法错误（或文件不存在/为空） |

### 配置文件搜索顺序

1. `{project-root}/spec-driver.config.yaml`
2. `{project-root}/.specify/spec-driver.config.yaml`

两者都不存在时，`--validate` 模式输出 `config:not_found` 并退出码 0（配置文件可选）。

## 输出格式

### --validate 模式（文本）

校验通过：
```
[config-schema] PASS: 配置文件 Schema 校验通过
```

校验失败：
```
[config-schema] FAIL: 配置文件 Schema 校验失败 (2 个错误)
  - 未知字段 `pereset`，你是否想写 `preset`?
  - `verification.timeout` 必须为正整数，当前值: -1
```

YAML 语法错误：
```
[config-schema] FAIL: YAML 语法错误
  - 缩进错误或格式异常，请检查配置文件语法
```

### --validate 模式（JSON，配合 --json）

```json
{
  "id": "config-schema",
  "title": "配置文件 Schema 校验",
  "status": "pass|warn|fail",
  "evidence": {
    "configPath": "spec-driver.config.yaml",
    "diagnostics": []
  }
}
```

### --show-effective 模式

输出 ASCII 表格到 stdout（格式见 data-model.md 第 2.2 节）。

## 依赖

- `plugins/spec-driver/scripts/lib/config-schema.mjs` -- Schema 定义和校验函数
- `plugins/spec-driver/scripts/lib/simple-yaml.mjs` -- YAML 解析
- `node:fs`, `node:path`, `node:process` -- Node.js 内置模块

## 约束

- 零外部依赖
- 执行时间不超过 2 秒（NFR-001）
- 输出格式可被 `repo-maintenance-core.mjs` 的 createCheck 链路消费
