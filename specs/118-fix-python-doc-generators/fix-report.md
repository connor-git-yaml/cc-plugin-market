# 问题修复报告

## 问题描述
在 Python 项目（Graphify, 20 个 .py 模块）上运行 `spectra batch` 后，troubleshooting.md 生成 0 条条目，event-surface.md 仅识别 4 个通用 UI 事件。两个 generator 的模式匹配逻辑几乎完全面向 JS/TS，对 Python 项目无效。

## 5-Why 根因追溯

### Generator 1: TroubleshootingGenerator

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 0 条 troubleshooting 条目？ | `extractErrorEntries()` 和 `extractConfigEntries()` 未匹配到任何 Python 代码模式 |
| Why 2 | 为何 Python 错误模式未匹配？ | `ERROR_PATTERNS` 仅含 `throw new XxxError('...')` 和 `(logger\|console).error('...')` — 纯 JS/TS 语法 |
| Why 3 | Python 的 `raise`、`logging.error` 为何遗漏？ | 正则从未覆盖 Python 的 `raise ValueError(...)` 和 `logging.error(...)` |
| Why 4 | `QUICK_SIGNAL_RE` 已含 `os.getenv` 为何没帮助？ | `QUICK_SIGNAL_RE` 仅用于 `isApplicable()` 门控，实际提取逻辑在 `ERROR_PATTERNS` 中 |
| Why 5 | 为何设计时未覆盖 Python？ | 初版 generator 以 TypeScript 项目为主要目标 |

**Root Cause**: `ERROR_PATTERNS` 正则和 `QUICK_SIGNAL_RE` 门控缺少 Python `raise`/`logging` 模式。

### Generator 2: EventSurfaceGenerator

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何只识别 4 个通用事件？ | `TEXT_EVENT_RE` 要求 `.method('string')` 格式的显式事件总线调用 |
| Why 2 | Python 项目为何不匹配？ | Python 常用 hook/callback 命名模式（`on_xxx`, `xxx_hook`）和装饰器模式，不使用显式事件总线 |
| Why 3 | 为何不识别装饰器？ | 无 `@decorator` 模式匹配逻辑 |
| Why 4 | hook 函数为何不作为事件？ | 事件仅从 `.emit()`/`.on()` 类调用提取，函数命名模式不在扫描范围 |
| Why 5 | PY_SUBSCRIBER_METHODS 为何无效？ | 该集合正确限制了 Python 的 subscriber 方法，但前提是存在 `.method('string')` 调用，而 Graphify 的 hook 系统不是这种 API |

**Root Cause**: 事件提取仅支持显式事件总线 API 调用，不识别 Python 常见的 hook/callback/decorator 事件模式。

## 修复策略

### TroubleshootingGenerator
1. `ERROR_PATTERNS` 增加 Python 错误模式：`raise XxxError('...')`、`logging.error('...')`、`logging.warning('...')`
2. `QUICK_SIGNAL_RE` 增加 `raise \w+Error`、`logging\.error`、`logging\.warning`
3. 增加 Python `except` 块上下文提取——当发现 `except XxxError` 时关联到恢复步骤

### EventSurfaceGenerator
1. 增加 Python hook/callback 函数名模式识别：扫描 `def on_xxx`、`def xxx_hook`、`def xxx_callback`、`def handle_xxx` 定义
2. 增加装饰器事件识别：`@app.route`、`@hook`、`@receiver`、`@app.on_event` 等
3. 将识别到的 hook 函数作为 subscriber 事件条目输出

## Spec 影响
无需更新 spec 文件。
