# Plan — 139: resolver diagnostic 健壮性

## Part A — hint 多 mode 枚举（fix(135) Codex 轴 4）

`plugins/spec-driver/lib/orchestration-resolver.mjs` 步骤 7 hint 检测：
- 原：`.find()` 取首个命中 mode
- 新：`.filter() + new Set()` 收集所有命中 mode，去重 + 字典序排序
- hint 文案改为 `generate-template ${example}（命中 mode: ${modeList}）`，example 取字典序首位

## Part B — `_loadOverrides` 返非对象 → loader-error（fix(135) Codex 轴 5）

`plugins/spec-driver/lib/orchestration-resolver.mjs` 步骤 4 后的非对象判断：
- 原：所有非对象返回静默走"空文件"分支
- 新：先判断 `_loadOverrides` 注入路径，发 loader-error；文件路径保持原静默行为

## 测试方案

`plugins/spec-driver/tests/orchestration-resolver.test.mjs`：
- T2-X 增强：单 mode 命中也输出"命中 mode: <m>"后缀
- T2-Z 新增：`fix` + `story` 同时缺字段 → hint 含 `fix / story`
- T1-Y 新增：`_loadOverrides` 返 null/undefined/42/string/false 五种类型 → loader-error，message 含 typeof
- T1-Y-precision 新增：注入返 `{}` → 不误判为非对象，走 schema-fallback

## 验证
- `node --test orchestration-resolver.test.mjs` 33/33 通过
- `npx vitest run` 零失败
- `npm run build` 零错
- `npm run repo:check` 全绿
