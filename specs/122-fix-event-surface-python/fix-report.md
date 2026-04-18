# Fix Report: event-surface-generator Python 问题修复

**修复编号**: 122
**文件**: `src/panoramic/generators/event-surface-generator.ts`
**测试文件**: `tests/panoramic/event-surface-generator.test.ts`

---

## 已修复问题

### H5（HIGH）— `isApplicable()` 不检查 Python hook/decorator 模式

**问题根因**: `isApplicable()` 仅用 `EVENT_PATTERN_RE`（匹配 `.emit/.on` 等方法调用）判断项目适用性。纯 decorator/hook 风格的 Python 项目在 registry 过滤阶段直接被跳过，`extract()` 根本不执行。

**修复方案**:
- 新增快速扫描正则 `PY_HOOK_QUICK_RE`，匹配 `^@\w`、`def on_`、`_hook(`、`_callback(`、`handle_` 等模式
- 在 `isApplicable()` 中对 `.py` 文件在 `EVENT_PATTERN_RE` 未匹配时额外执行该扫描
- 有任一匹配即返回 `true`

**新增测试**: "纯 Python decorator/hook 风格项目（无 .emit/.on）isApplicable 返回 true"

---

### M3（MEDIUM）— `EVENT_DECORATOR_NAMES` 中 `'handler'` 误报

**问题根因**: `EVENT_DECORATOR_NAMES` 包含 `'handler'` 和裸 `'event'`，Click/Flask 等框架中 `@handler` 是普通函数装饰，不是事件订阅，导致大量噪声 occurrence。

**修复方案**:
- 从 `EVENT_DECORATOR_NAMES` Set 中移除 `'handler'`（语义过宽，是普通函数装饰器）
- 同时移除裸 `'event'`（无法区分事件订阅与普通标注）
- 保留语义明确的：`'hook'`、`'receiver'`、`'on_event'`、`'route'`、`'websocket'`、`'listener'`、`'signal'`

---

### L2（LOW）— `@hook` + `def on_xxx` 双重匹配产生重复 occurrence

**问题根因**: 若 Python 函数同时满足装饰器模式（`@hook("my_event")`）和 hook 命名（`def on_my_event()`），同一函数产生两条 occurrence，现有 `dedupeOccurrences()` 因 `methodName` 不同无法去重。

**修复方案**:
- 将 `findDecoratedFunction()` 重构为 `findDecoratedFunctionLine()`，返回函数定义的行号（未找到返回 -1）
- 在 `extractPythonHookOccurrences()` 中维护 `decoratedFuncLines: Set<number>`，装饰器匹配后记录对应函数 def 行号
- hook 命名模式匹配时先检查当前行是否在 `decoratedFuncLines` 中，若已在则跳过

---

## 验证结果

- 命令: `npm run build`
- 退出码: 0
- 输出摘要: 零 TypeScript 错误

- 命令: `npx vitest run tests/panoramic/event-surface-generator.test.ts`
- 退出码: 0
- 输出摘要: 8 tests passed（含新增 H5 覆盖测试）

- 命令: `npx vitest run`（全量）
- 退出码: 0
- 输出摘要: 160 test files passed, 1574 tests passed, 0 failed
