# Quickstart: 调研模板纳入 specify-base 同步体系

**Feature**: `021-add-research-templates`
**预计变更**: 10 个文件（4 新增 + 6 修改）
**预计工作量**: 小型变更（~30 分钟）

## 实施步骤概览

### Step 1: 新增 specify-base 基准模板（4 个文件）

将 4 个调研模板从 plugin `templates/` 根目录复制到 `templates/specify-base/`：

```bash
cd plugins/spec-driver/templates
cp product-research-template.md specify-base/
cp tech-research-template.md specify-base/
cp research-synthesis-template.md specify-base/
cp verification-report-template.md specify-base/
```

验证：`ls specify-base/` 应显示 10 个 `.md` 文件。

### Step 2: 修改 TypeScript 同步器（1 个文件）

**文件**: `src/utils/specify-template-sync.ts`

在 `REQUIRED_TEMPLATES` 数组末尾添加 4 项：

```typescript
const REQUIRED_TEMPLATES = [
  'plan-template.md',
  'spec-template.md',
  'tasks-template.md',
  'checklist-template.md',
  'constitution-template.md',
  'agent-file-template.md',
  // 调研模板
  'product-research-template.md',
  'tech-research-template.md',
  'research-synthesis-template.md',
  'verification-report-template.md',
] as const;
```

### Step 3: 修改 Bash 初始化脚本（1 个文件）

**文件**: `plugins/spec-driver/scripts/init-project.sh`

在 `REQUIRED_SPECIFY_TEMPLATES` 数组末尾添加 4 项：

```bash
REQUIRED_SPECIFY_TEMPLATES=(
  "plan-template.md"
  "spec-template.md"
  "tasks-template.md"
  "checklist-template.md"
  "constitution-template.md"
  "agent-file-template.md"
  # 调研模板
  "product-research-template.md"
  "tech-research-template.md"
  "research-synthesis-template.md"
  "verification-report-template.md"
)
```

### Step 4: 修改子代理 prompt（3 个文件）

对以下 3 个子代理 prompt 文件，将硬编码的 plugin 模板路径改为"项目级优先、plugin 回退"：

1. **`plugins/spec-driver/agents/product-research.md`**
   - 修改"使用模板"行，添加条件加载说明
   - 在执行流程中插入模板加载步骤

2. **`plugins/spec-driver/agents/tech-research.md`**
   - 同上

3. **`plugins/spec-driver/agents/verify.md`**
   - 同上

**模板加载模式**（所有子代理一致）：
> 优先读取 `.specify/templates/{模板名}`（项目级），若不存在则回退到 `plugins/spec-driver/templates/{模板名}`（plugin 内置）

### Step 5: 修改编排器 SKILL.md（1 个文件）

**文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`

修改 Phase 1c 中 `research-synthesis-template.md` 的路径引用，改为条件加载。

## 验证清单

- [ ] `plugins/spec-driver/templates/specify-base/` 包含 10 个模板文件
- [ ] `npm run build` 构建通过
- [ ] `npm test` 测试通过
- [ ] 在测试项目中运行同步，确认 `.specify/templates/` 包含 10 个模板
- [ ] 重复运行同步，确认已有模板不被覆盖
- [ ] 修改项目级调研模板后运行子代理，确认使用了自定义版本
- [ ] 删除项目级调研模板后运行子代理，确认回退到 plugin 内置版本

## 依赖说明

- 无新增运行时依赖
- 无跨 PR 依赖
- 本功能可独立合入，不依赖其他进行中的功能分支
