# 契约: scan-project.sh 输出格式

**Branch**: `015-speckit-doc-command` | **Date**: 2026-02-15

## 概述

`scan-project.sh` 是 speckit-doc 的元信息收集脚本，输出项目元数据 JSON，供 Skill prompt 解析使用。

## 调用方式

```bash
bash plugins/spec-driver/scripts/scan-project.sh [--json]
```

**参数**:
- `--json`（可选）: 输出 JSON 格式。不指定时输出人类可读的文本格式。

**工作目录**: 脚本在项目根目录下执行。

## 输出 JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["name", "hasPackageJson", "hasGitRepo", "existingFiles", "missingFields", "directoryTree"],
  "properties": {
    "name": {
      "type": "string",
      "description": "项目名称。优先从 package.json name 提取，降级为目录名"
    },
    "version": {
      "type": ["string", "null"],
      "description": "项目版本号"
    },
    "description": {
      "type": ["string", "null"],
      "description": "项目描述"
    },
    "license": {
      "type": ["string", "null"],
      "description": "已声明的 SPDX 协议标识符"
    },
    "author": {
      "type": ["object", "null"],
      "properties": {
        "name": { "type": "string" },
        "email": { "type": ["string", "null"] }
      },
      "required": ["name"]
    },
    "scripts": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "npm scripts 命令映射"
    },
    "dependencies": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "devDependencies": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "repository": {
      "type": ["object", "null"],
      "properties": {
        "url": { "type": "string" },
        "type": { "type": "string" }
      }
    },
    "main": {
      "type": ["string", "null"],
      "description": "主入口文件路径"
    },
    "bin": {
      "type": ["object", "null"],
      "additionalProperties": { "type": "string" },
      "description": "CLI 入口映射"
    },
    "git": {
      "type": "object",
      "properties": {
        "userName": { "type": ["string", "null"] },
        "userEmail": { "type": ["string", "null"] },
        "remoteUrl": { "type": ["string", "null"] },
        "defaultBranch": { "type": "string" }
      },
      "required": ["defaultBranch"]
    },
    "directoryTree": {
      "type": "string",
      "description": "项目目录树文本（深度 2）"
    },
    "projectType": {
      "type": "string",
      "enum": ["cli", "library", "web-app", "unknown"],
      "description": "推断的项目类型"
    },
    "existingFiles": {
      "type": "object",
      "properties": {
        "README.md": { "type": "boolean" },
        "LICENSE": { "type": "boolean" },
        "CONTRIBUTING.md": { "type": "boolean" },
        "CODE_OF_CONDUCT.md": { "type": "boolean" }
      },
      "required": ["README.md", "LICENSE", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"]
    },
    "hasPackageJson": { "type": "boolean" },
    "hasGitRepo": { "type": "boolean" },
    "missingFields": {
      "type": "array",
      "items": { "type": "string" },
      "description": "缺失的关键字段名列表"
    }
  }
}
```

## 输出示例

### 完整信息场景

```json
{
  "name": "reverse-spec",
  "version": "2.0.0",
  "description": "通过 AST 静态分析 + LLM 混合流水线，将遗留源代码逆向工程为结构化 Spec 文档",
  "license": "MIT",
  "author": { "name": "Connor Lu", "email": "connor@example.com" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": { "ts-morph": "^24.0.0", "zod": "^3.24.1" },
  "devDependencies": { "typescript": "^5.7.3", "vitest": "^3.0.4" },
  "repository": { "url": "https://github.com/user/reverse-spec.git", "type": "git" },
  "main": "dist/index.js",
  "bin": { "reverse-spec": "dist/cli/index.js" },
  "git": {
    "userName": "Connor Lu",
    "userEmail": "connor@example.com",
    "remoteUrl": "https://github.com/user/reverse-spec.git",
    "defaultBranch": "master"
  },
  "directoryTree": ".\n├── src/\n├── tests/\n├── plugins/\n├── specs/\n├── templates/\n├── package.json\n└── tsconfig.json",
  "projectType": "cli",
  "existingFiles": {
    "README.md": true,
    "LICENSE": false,
    "CONTRIBUTING.md": false,
    "CODE_OF_CONDUCT.md": false
  },
  "hasPackageJson": true,
  "hasGitRepo": true,
  "missingFields": []
}
```

### 降级场景（无 package.json）

```json
{
  "name": "my-project",
  "version": null,
  "description": null,
  "license": null,
  "author": null,
  "scripts": {},
  "dependencies": {},
  "devDependencies": {},
  "repository": null,
  "main": null,
  "bin": null,
  "git": {
    "userName": "Connor Lu",
    "userEmail": "connor@example.com",
    "remoteUrl": "https://github.com/user/my-project.git",
    "defaultBranch": "main"
  },
  "directoryTree": ".\n├── src/\n├── docs/\n└── Makefile",
  "projectType": "unknown",
  "existingFiles": {
    "README.md": false,
    "LICENSE": false,
    "CONTRIBUTING.md": false,
    "CODE_OF_CONDUCT.md": false
  },
  "hasPackageJson": false,
  "hasGitRepo": true,
  "missingFields": ["version", "description", "license", "author", "scripts", "dependencies", "repository", "main"]
}
```

## 错误处理

| 场景 | 脚本行为 | 退出码 |
|------|---------|--------|
| 正常执行 | 输出完整 JSON | 0 |
| 无 package.json | 降级模式输出（字段为 null） | 0 |
| package.json 解析失败 | 降级模式 + stderr 输出警告 | 0 |
| 无 git 仓库 | git 字段为 null/默认值 | 0 |
| 既无 package.json 也无 git | 最小化输出（仅目录名和目录树） | 0 |
| 完全空目录（无任何文件） | stderr 输出错误 | 1 |
