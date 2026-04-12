# Fix 112: Spectra rebrand 配置文件名 + 检查点路径修复

## 修复范围

影响 2 个生产文件 + 3 个测试文件，均为局部常量/字面量修改，无架构变化。

## 变更清单

### 1. `src/config/project-config.ts`

- 文件头注释更新：加入 `.spectra.yaml` 支持说明
- `CONFIG_FILENAMES` 数组：在头部插入新品牌名（高优先级），保留旧名（向后兼容）

```typescript
const CONFIG_FILENAMES = [
  '.spectra.yaml',
  '.spectra.yml',
  '.spectra.json',
  '.reverse-spec.yaml',  // 向后兼容
  '.reverse-spec.yml',
  '.reverse-spec.json',
] as const;
```

### 2. `src/batch/checkpoint.ts`

- 修改 `DEFAULT_CHECKPOINT_PATH` 常量为新品牌名
- 新增 `LEGACY_CHECKPOINT_PATH` 常量
- 在 `loadCheckpoint` 函数新增迁移逻辑：新路径不存在但旧路径存在时，自动 rename 到新路径

### 3. `tests/unit/project-config.test.ts`

- 更新文件头注释（L3）：加入 `.spectra.yaml`
- 保留现有 `.reverse-spec.*` 测试用例（验证向后兼容）
- 新增 `.spectra.yaml/.yml/.json` 优先级测试用例
- 新增 `.spectra.yaml` 与 `.reverse-spec.yaml` 共存时，`.spectra.yaml` 优先的测试用例

### 4. `tests/self-hosting/self-host.test.ts`

- 更新文件头注释（L3,5）：`reverse-spec` → `spectra`
- 更新 `describe()` 描述（L20）：`'自举测试：reverse-spec 分析自身'` → `'自举测试：spectra 分析自身'`
- `/reverse-spec-batch` → `/spectra-batch`（L5 注释）

### 5. `tests/unit/model-selection.test.ts`

- 临时目录前缀（L20）：`'reverse-spec-model-'` → `'spectra-model-'`

## 回归风险

- 低：所有修改均为字面量/常量，不涉及逻辑分支变更
- 向后兼容：`.reverse-spec.yaml` 仍然有效，旧检查点文件会自动迁移
- 测试覆盖：新增测试用例验证新行为
