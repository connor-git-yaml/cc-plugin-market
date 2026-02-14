# CLI 接口契约

**Branch**: `002-cli-global-distribution` | **Date**: 2026-02-12

## CLI 命令规格

### 全局命令

```
reverse-spec <subcommand> [options]
```

### 子命令

#### `reverse-spec generate <target> [options]`

对指定文件或目录生成单模块 Spec。

| 参数/选项 | 类型 | 必需 | 默认值 | 说明 |
| --------- | ---- | ---- | ------ | ---- |
| `<target>` | string | 是 | - | 目标文件或目录路径 |
| `--deep` | boolean | 否 | `false` | 深度分析（包含函数体） |
| `--output-dir` | string | 否 | `specs` | 自定义输出目录 |

**调用映射**:
```typescript
import { generateSpec } from './core/single-spec-orchestrator.js';
await generateSpec(resolve(target), { deep, outputDir, projectRoot: cwd() });
```

**退出码**:
- `0`: 成功生成 spec
- `1`: 目标路径不存在或无可分析文件
- `2`: LLM API 错误（无 API Key 或网络问题）

**stdout 输出**:
```
reverse-spec v2.0.0
正在分析 src/auth/ ...
  AST 解析: 5 文件, 1,234 LOC
  上下文组装: 12,456 tokens
  LLM 生成: 完成
✓ specs/auth.spec.md 已生成 (置信度: high)
```

---

#### `reverse-spec batch [options]`

对当前项目执行批量 Spec 生成。

| 参数/选项 | 类型 | 必需 | 默认值 | 说明 |
| --------- | ---- | ---- | ------ | ---- |
| `--force` | boolean | 否 | `false` | 强制重新生成所有 spec |
| `--output-dir` | string | 否 | `specs` | 自定义输出目录 |

**调用映射**:
```typescript
import { runBatch } from './batch/batch-orchestrator.js';
await runBatch(cwd(), { force, onProgress: cliProgressCallback });
```

**退出码**:
- `0`: 全部模块成功或降级完成
- `1`: 部分模块失败（详情见 summary log）
- `2`: 致命错误（无法启动批处理）

**stdout 输出**:
```
reverse-spec v2.0.0 — 批量生成
扫描项目: 15 模块, 4,567 LOC
[====================] 15/15 完成
  成功: 13 | 降级: 1 | 失败: 1
✓ specs/_index.spec.md 已生成
✓ 日志: specs/batch-summary-2026-02-12.md
```

---

#### `reverse-spec diff <spec-file> <source> [options]`

检测 Spec 与源代码之间的漂移。

| 参数/选项 | 类型 | 必需 | 默认值 | 说明 |
| --------- | ---- | ---- | ------ | ---- |
| `<spec-file>` | string | 是 | - | 现有 .spec.md 文件路径 |
| `<source>` | string | 是 | - | 源代码文件或目录路径 |
| `--output-dir` | string | 否 | `drift-logs/` | 自定义输出目录 |

**调用映射**:
```typescript
import { detectDrift } from './diff/drift-orchestrator.js';
await detectDrift(resolve(specFile), resolve(source), { outputDir });
```

**退出码**:
- `0`: 无漂移或仅 LOW 级别漂移
- `1`: 存在 MEDIUM 或 HIGH 级别漂移
- `2`: 分析错误

**stdout 输出**:
```
reverse-spec v2.0.0 — 漂移检测
Spec: specs/auth.spec.md
Source: src/auth/
  结构差异: 3 项 (HIGH: 1, MEDIUM: 1, LOW: 1)
  噪声过滤: 移除 2 项
⚠ 检测到 HIGH 级别漂移
✓ drift-logs/auth-drift-2026-02-12.md 已生成
```

---

### 全局选项

| 选项 | 说明 |
| ---- | ---- |
| `--version`, `-v` | 显示版本号 |
| `--help`, `-h` | 显示帮助信息 |

### 帮助输出

```
reverse-spec — 代码逆向工程 Spec 生成工具 v2.0.0

用法:
  reverse-spec generate <target> [--deep] [--output-dir <dir>]
  reverse-spec batch [--force] [--output-dir <dir>]
  reverse-spec diff <spec-file> <source> [--output-dir <dir>]
  reverse-spec --version
  reverse-spec --help

命令:
  generate   对指定文件或目录生成 Spec
  batch      批量生成当前项目所有模块的 Spec
  diff       检测 Spec 与源代码之间的漂移

选项:
  --deep         深度分析（包含函数体）
  --force        强制重新生成所有 spec
  --output-dir   自定义输出目录
  -v, --version  显示版本号
  -h, --help     显示帮助信息
```

## package.json 变更契约

```json
{
  "bin": {
    "reverse-spec": "dist/cli/index.js"
  },
  "files": [
    "dist/",
    "src/skills-global/",
    "templates/",
    "README.md"
  ],
  "scripts": {
    "build": "tsc",
    "postinstall": "node dist/scripts/postinstall.js",
    "preuninstall": "node dist/scripts/preuninstall.js"
  }
}
```
