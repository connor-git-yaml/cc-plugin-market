# 问题修复报告

## 问题描述

Spectra rebrand 后遗留的三处配置文件名/检查点路径/测试描述问题：
1. `src/config/project-config.ts` 只搜索 `.reverse-spec.yaml`，不搜索 `.spectra.yaml`，新用户无法使用新品牌配置文件名
2. `src/batch/checkpoint.ts` 默认检查点路径仍为 `specs/.reverse-spec-checkpoint.json`
3. 测试文件中存在非 fixture 的 `reverse-spec` 品牌名（describe/it 描述、文件注释、临时目录前缀）

---

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 新用户创建 `.spectra.yaml` 为何不生效？ | `CONFIG_FILENAMES` 数组只包含 `.reverse-spec.*`，`findConfigFile` 返回 undefined |
| Why 2 | `CONFIG_FILENAMES` 为何没有更新？ | Spectra rebrand 专注于 CLI bin/npm 包名/MCP server 名，遗漏了用户态配置文件名 |
| Why 3 | 为何 rebrand 会遗漏配置文件名？ | 没有对所有用户可见的 artifact（config filename、checkpoint path）进行系统性扫描清单 |
| Why 4 | 为何没有清单？ | rebrand 采用渐进式提交，缺乏最终 audit 步骤 |
| Why 5 | 为何未被测试捕获？ | 现有测试只覆盖 `.reverse-spec.yaml` 后向兼容路径，新品牌名从未被测试 |

**Root Cause**: Spectra rebrand 的系统性 audit 未覆盖"用户运行时可见的内部文件名"（配置文件名、检查点路径）。  
**Root Cause Chain**: 新用户使用 `.spectra.yaml` → `findConfigFile` 搜索数组无此项 → 返回 undefined → 配置静默忽略 → 用户配置不生效 → rebrand 遗漏 `CONFIG_FILENAMES` 更新

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/config/project-config.ts` | L39-43 | `CONFIG_FILENAMES` 只含 `.reverse-spec.*` | 在数组头部插入 `.spectra.yaml/.yml/.json`（高优先级） |
| `src/batch/checkpoint.ts` | L11 | `DEFAULT_CHECKPOINT_PATH = '.../.reverse-spec-checkpoint.json'` | 改为 `.spectra-checkpoint.json`，同时在 `loadCheckpoint` 加迁移逻辑 |
| `tests/unit/project-config.test.ts` | L3,L28,L35,L42 | 文件注释和 it() 描述中的 `reverse-spec` | 更新注释/描述，新增 `.spectra.yaml` 测试用例 |
| `tests/self-hosting/self-host.test.ts` | L3,L5,L20 | 文件注释和 describe() 描述 | 更新品牌名 |
| `tests/unit/model-selection.test.ts` | L20 | 临时目录前缀 `'reverse-spec-model-'` | 改为 `'spectra-model-'` |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `tests/unit/index-generator.test.ts` | L36,L202,L254,L301 | `generatedBy: 'reverse-spec v2.0'` | 安全 — fixture 数据，测试旧格式向后兼容 |
| `tests/panoramic/*.test.ts` | 多处 | `generatedBy: 'reverse-spec'` | 安全 — fixture 数据，测试旧格式解析 |
| `tests/unit/product-quality-core.test.ts` | L67-84 | `specs/products/reverse-spec/` 路径 | 安全 — fixture 目录名，测试产品 spec 发现逻辑 |
| `tests/self-hosting/self-host.test.ts` | L115 | `generatedBy: 'reverse-spec-v2-self-host'` | 安全 — AST 自举测试生成的内容标记，不影响用户 |
| `tests/panoramic/product-ux-docs.test.ts` | L134 | `.reverse-spec-preview` 目录 | 安全 — fixture 路径 |

### 同步更新清单

- 调用方：`checkpoint.ts` 修改后，所有调用 `DEFAULT_CHECKPOINT_PATH` 的地方会自动使用新路径（无需改调用方）
- 测试：`tests/unit/project-config.test.ts` 需同步新增 `.spectra.yaml` 优先级测试用例
- 文档：`src/config/project-config.ts` 文件头注释需同步更新

---

## 修复策略

### 方案 A（推荐）：最小侵入 + 向后兼容

**`project-config.ts`**：在 `CONFIG_FILENAMES` 数组头部插入新品牌文件名，保持旧名在后（向后兼容）：

```typescript
const CONFIG_FILENAMES = [
  '.spectra.yaml',
  '.spectra.yml',
  '.spectra.json',
  '.reverse-spec.yaml',
  '.reverse-spec.yml',
  '.reverse-spec.json',
] as const;
```

**`checkpoint.ts`**：修改默认路径常量，并在 `loadCheckpoint` 加自动迁移逻辑（旧文件存在时重命名为新路径）：

```typescript
export const DEFAULT_CHECKPOINT_PATH = 'specs/.spectra-checkpoint.json';
export const LEGACY_CHECKPOINT_PATH = 'specs/.reverse-spec-checkpoint.json';

// loadCheckpoint 中：若新路径不存在但旧路径存在，自动迁移
```

**测试文件**：更新非 fixture 的描述文本和注释，新增 `.spectra.yaml` 测试覆盖。

### 方案 B（备选）：仅修改常量，不加迁移逻辑

不添加迁移逻辑，仅修改常量。问题：已有旧检查点文件的用户重新 batch 时检查点丢失，但实际影响小（检查点只是断点恢复辅助，丢失仅影响中断恢复能力）。

---

## Spec 影响

- `contracts/batch-module.md`：提及检查点路径的地方需更新（如有）
- 当前无 spec.md for Feature 112，无需更新外部 spec 文件
