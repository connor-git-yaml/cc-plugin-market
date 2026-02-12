---
name: reverse-spec
description: |
  Use this skill when the user asks to:
  - Generate a spec/specification from existing code
  - Document or analyze a module's architecture
  - Reverse engineer what a piece of code does
  - Create .spec.md documentation for a file, directory, or module
  - Understand the intent, interfaces, and business logic of existing code
  Supports single files (e.g., src/auth/login.ts), directories (e.g., src/auth/), or entire modules.
---

## User Input

```text
$ARGUMENTS
```

## Execution Flow

### 1. Parse Target

从 `$ARGUMENTS` 确定分析目标（文件或目录）。无参数时询问用户。支持 `--deep` 标志。

### 2. AST 预分析（可选，推荐）

尝试运行 CLI 获取精确的 AST 骨架（导出签名、导入、类型）：

```bash
if command -v reverse-spec >/dev/null 2>&1; then
  reverse-spec prepare $TARGET_PATH --deep
elif command -v npx >/dev/null 2>&1; then
  npm_config_yes=true npx reverse-spec prepare $TARGET_PATH --deep
fi
```

如果 CLI 不可用，跳过此步——直接读取源文件分析。

### 3. 生成 Spec

基于 AST 输出（如有）和源代码，生成 9 段式中文 Spec 文档：

1. **意图** — 模块目的和存在理由
2. **接口定义** — 所有导出 API（签名必须来自代码，不可捏造）
3. **业务逻辑** — 核心算法和工作流
4. **数据结构** — 类型、接口、枚举
5. **约束条件** — 性能、安全、平台约束
6. **边界条件** — 错误处理、降级策略
7. **技术债务** — TODO/FIXME、改进空间
8. **测试覆盖** — 已测试行为、覆盖缺口
9. **依赖关系** — 内部/外部依赖

不确定的内容用 `[推断: 理由]` 标注。

### 4. 写入

写入 `specs/<name>.spec.md`。仅写入 specs/ 目录，不修改源代码。

**语言**: 中文正文 + 英文代码标识符/路径/代码块
