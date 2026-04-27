# 修复报告 — 139: resolver diagnostic 健壮性

## 问题描述
两个独立但同主题的 resolver diagnostic 弱点（"resolver 在边界场景给的诊断不够准确"）：

**问题 A — schema-fallback hint 多 mode 错误时只引用第一个**
fix(135) 的 schema-fallback hint 检测逻辑：
```js
const phaseIssue = overridesParseResult.error.issues.find(...)
const modeName = phaseIssue.path[1];  // 只取第一个命中的 mode
```
当用户同时给 `fix` 和 `story` 两个 mode 写不完整 phase 时，issues 会包含多个 mode 的字段缺失错误，但 hint 只会引用其中一个 mode 名（取决于 Zod issue 顺序，按 schema shape 而非 YAML 出现顺序）。结果可能是用户先看到的是 `story` 的错误，hint 却建议 `generate-template fix`，让用户困惑。

来源：fix(135) Codex 对抗审查轴 4 标记 warning。

**问题 B — `_loadOverrides` 返非对象走"空文件"分支无 diagnostic**
当前步骤 4 后的"空文件分支"（约 L268）：
```js
if (!rawOverrides || typeof rawOverrides !== 'object') {
  // 静默返回 base，无 diagnostic
}
```
对真实空 YAML 文件这是合理的（合法用法），但对注入函数返回 `null` / `undefined` / 数字等非对象类型，是 loader 调用契约违反，应当发 diagnostic 提示，而不是静默吞掉。

来源：fix(135) Codex 对抗审查轴 5 标记 warning。

## 5-Why 根因追溯

| 层级 | 问题 A | 问题 B |
|------|--------|--------|
| Why 1 | hint 引用单一 mode | 注入返非对象时 resolver 静默 fallback |
| Why 2 | 实现用 .find() 取第一个 | "空文件" 分支兜底所有非对象返回 |
| Why 3 | 设计假设单 mode 错误是常态 | 文件路径"空 YAML 解析为 null"和注入"loader 返非对象"被合并处理 |
| Why 4 | 没考虑用户同时定制多个 mode 的场景 | 注入路径未单独区分错误类型 |
| Why 5 | 未充分讨论 hint 在多 mode 场景下的语义 | _loadOverrides 是 fix(135) 引入的测试 hook，错误处理对称性未深思 |

**Root Cause（共同）**：fix(135) 引入的 hint 和 loader 注入机制都假设了"单点出错"的简单场景，没有覆盖多点同时出错（多 mode hint）和契约违反（loader 返非对象）这两个边界。

## 影响范围扫描

| 文件 | 改动 |
|------|------|
| `plugins/spec-driver/lib/orchestration-resolver.mjs` | hint 检测改用 .filter()+去重收集所有命中 mode；步骤 4 后增加注入路径专用的"非对象返回"判断，发 loader-error |
| `plugins/spec-driver/tests/orchestration-resolver.test.mjs` | 新增 T2-Z（多 mode hint 同时引用）、T1-Y（注入返非对象 → loader-error） |
| `docs/shared/agent-orchestration-overrides.md` | （可能）丰富 loader-error diagnostic 表项的描述（注入返非对象也归属此 code） |

## 修复策略

**方案 A — hint 多 mode 枚举**：
```js
// 收集所有命中 modes.<m>.phases.* 的 mode 名，去重
const modeSet = new Set(
  overridesParseResult.error.issues
    .filter(iss => Array.isArray(iss.path) && iss.path.length >= 4
        && iss.path[0] === 'modes' && iss.path[2] === 'phases')
    .map(iss => iss.path[1])
);
if (modeSet.size > 0) {
  const modeList = [...modeSet].join('/');
  message += `\nhint: 运行 \`orchestrator-cli generate-template <mode>\`（命中 mode: ${modeList}）...`;
}
```

**方案 B — 注入返非对象 → loader-error**：
```js
// 步骤 4 后，区分"文件路径返 null（合法空文件）" 与 "注入返非对象（契约违反）"
if (_loadOverrides && (!rawOverrides || typeof rawOverrides !== 'object')) {
  diagnostics.push(createDiagnostic(
    'warning',
    'orchestration-overrides.loader-error',
    `[orchestration-overrides] _loadOverrides 注入函数返回非对象（${typeof rawOverrides}），将使用 base 配置`,
  ));
  return baseFallback();
}
// 文件路径下空文件保持原静默行为
```

**回归风险**：低
- A：修改后第一个命中 mode 的行为仍然正确，只是多了"多个 mode 同时报"的额外信息
- B：仅在 `_loadOverrides` 注入路径下发 diagnostic，文件路径行为完全不变

## 验收
1. T2-Z：注入 modes.fix.phases + modes.story.phases 都缺字段 → hint 文本同时含 `fix` 和 `story`
2. T1-Y：注入 `() => null` → diagnostic code = loader-error，message 含"返回非对象"
3. T1-Y 反向：文件路径下真实空文件仍静默无 diagnostic（regression check）
4. `npx vitest run` 零失败 + build + repo:check 全绿
