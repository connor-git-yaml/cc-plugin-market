# 问题修复报告

## 问题描述
`scripts/inline-d3.ts` 每次执行（即每次 `npm run build`）都会注入当前时间戳，并无条件覆写 `src/panoramic/exporters/html-template.ts`，导致工作树在 d3-force bundle 内容未变的情况下仍产生脏文件（false-positive diff）。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `html-template.ts` 为何每次 build 后都是 dirty？ | 生成内容包含 `new Date().toISOString()`，每次运行必然不同 |
| Why 2 | 时间戳为何写入受版控的源文件？ | 脚本设计时将"生成时间"当作 metadata 写入了 tracked 文件头注释 |
| Why 3 | 脚本为何不检查内容是否已变化？ | 无内容比对逻辑，直接调用 `writeFileSync`（第 81 行） |
| Why 4 | 为何未在设计时排除时间戳？ | 受版控生成文件和构建产物混用了同一范式 |
| Why 5 | 为何未被测试覆盖？ | 测试未对 `html-template.ts` 的幂等性进行验证 |

**Root Cause**: 受版控的生成源文件包含非确定性时间戳，且写入时无内容比对保护。
**Root Cause Chain**: 脏工作树 → 每次 build 都有 diff → 无条件 writeFileSync → 内容含 `new Date()` → 时间戳写入受版控文件

## 影响范围扫描

### 同源问题（需同步修复）
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `scripts/inline-d3.ts` | L70 | `new Date().toISOString()` | 删除该行 |
| `scripts/inline-d3.ts` | L81 | 无条件 `writeFileSync` | 加内容比对，相同则跳过写入 |

### 类似模式（需评估）
无其他同类受版控生成文件。

### 同步更新清单
- 测试：无需新增（行为保持不变，仅减少不必要写入）
- `src/panoramic/exporters/html-template.ts`：本次 build 后恢复干净状态，需还原当前 dirty 变更

## 修复策略
### 方案 A（推荐）
1. 从生成头注释中删除 `生成时间: ${new Date().toISOString()}` 行（第 70 行）
2. 在 `writeFileSync` 前添加内容比对：若文件已存在且内容完全一致则跳过写入并输出 `[inline-d3] 内容无变化，跳过写入`

### 方案 B（备选）
用 `d3Version` + bundle 的 hash 替代时间戳，保留"版本标记"语义但保持确定性。方案 B 略复杂，方案 A 更简洁。

## Spec 影响
无需更新 spec 文件。
