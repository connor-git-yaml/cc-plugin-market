# T2.4-T2.5 实现总结：SKILL.md 重构模板

## 概述

Feature 089 的 T2.4-T2.5 任务目标是重构 7 个 SKILL.md 文件，从硬编码的编排逻辑改为动态引用 `orchestration.yaml`。

## 完成状态

### ✅ 已完成（T2.1-T2.3）
- orchestration.yaml：688 行（所有 7 种模式的完整配置）
- orchestrator.js：423 行（核心加载器和查询接口）
- orchestrator-fallback.js：438 行（后备配置）
- orchestrator-cli.mjs：CLI 包装器（供 SKILL.md 查询）
- orchestrator.test.mjs：483 行（28 个烟雾测试）

### ✅ 已完成（T2.4 部分）
- **spec-driver-feature SKILL.md**：
  - 原始：1,058 行
  - 重构后：322 行
  - **缩减比例：70%**
  - 更改：
    - 移除所有硬编码的 Phase 0-7 定义（~800 行）
    - 移除硬编码的 Gate 决策逻辑
    - 移除硬编码的并行组定义
    - 添加编排配置加载指令（3.6 步骤）
    - 添加动态 Phase 执行模式说明
    - 添加编排器查询示例代码

### ⏳ 待完成（T2.5）
- spec-driver-story SKILL.md：590 行 → ~180 行（预计）
- spec-driver-implement SKILL.md：535 行 → ~160 行（预计）
- spec-driver-fix SKILL.md：472 行 → ~140 行（预计）
- spec-driver-resume SKILL.md：331 行 → ~100 行（预计）
- spec-driver-sync SKILL.md：297 行 → ~90 行（预计）
- spec-driver-doc SKILL.md：729 行 → ~220 行（预计）

---

## SKILL.md 重构模板

每个 SKILL.md 的重构遵循以下统一模式：

### 保留部分
1. **Frontmatter**（5 行）
   - name, description, disable-model-invocation

2. **触发方式**（5-15 行）
   - 命令格式和参数说明

3. **输入解析**（10-20 行）
   - 参数解析规则

4. **初始化阶段**（150-180 行）
   - 0. 插件路径发现
   - 1. 项目环境检查
   - 2. Constitution 处理
   - 3. 配置加载
   - 3.5 项目上下文注入
   - **3.6 编排配置加载（新增）**
   - 4. 门禁配置加载（改为通过编排器查询）
   - 5. Prompt 来源映射
   - 6. 特性目录准备
   - 6.5 自适应入口检测

5. **并行执行策略**（20-30 行，改为引用编排器）

6. **Trace 日志记录**（20-30 行）

### 删除部分
- **所有 Phase 详细定义**（原文件的 50-70%）
  - 例：feature SKILL.md 中 Phase 0-7 的详细说明（~800 行）
  - 例：story SKILL.md 中 Phase 1-5 的详细说明（~400 行）

- **硬编码的 Gate 决策逻辑**
  - 4-tier 优先级的具体实现细节
  - 各 gate 的默认行为表

- **硬编码的并行组定义**
  - RESEARCH_GROUP、DESIGN_PREP_GROUP、VERIFY_GROUP 的具体配置

### 新增部分

#### 3.6 编排配置加载（新增步骤）

```markdown
### 3.6 编排配置加载（Feature 089 引入）

**新增步骤**：加载 `orchestration.yaml` 并初始化编排器

\`\`\`bash
# 验证编排配置
node "$PLUGIN_DIR/scripts/orchestrator-cli.mjs" validate-config

# 加载 {mode} 模式的 Phase 序列
PHASES=$(node "$PLUGIN_DIR/scripts/orchestrator-cli.mjs" get-phases {mode})

# 输出 {mode} 模式包含的 Phase 数量和序列摘要
echo "[Orchestrator] 已加载 {mode} 模式编排配置"
\`\`\`

**后备策略**：如果 orchestration.yaml 不存在或无效，自动使用内置后备配置（orchestrator-fallback.js）。
```

#### 工作流执行（动态模式）替换

**原模式**（详细的 Phase 定义）：
```
### Phase 0: Constitution 检查 [1/10]
### Phase 1a+1b: 产品调研...
### Phase 1c: 产研汇总...
... 更多详细 Phase 定义 ...
```

**新模式**（动态引用）：
```markdown
## 工作流执行（动态模式）

本编排器遵循以下通用执行模式，具体 Phase 序列由 `orchestration.yaml` 定义：

### Phase 执行模式

对于 `orchestration.yaml` 中定义的 {mode} 模式下的每个 Phase：

1. **Phase 条件检查**
   \`\`\`bash
   if [ -n "{phase.condition}" ]; then
     SHOULD_EXECUTE=$(node "$PLUGIN_DIR/scripts/orchestrator-cli.mjs" evaluate-condition "{phase.condition}" ...)
   fi
   \`\`\`

2. **输出进度提示** — `[N/M] 正在执行 {phase.name}...`

3. **读取子代理 Prompt** — 根据 phase.agent_id 确定

4. **构建上下文注入块** — 注入 feature_dir、branch_name 等

5. **委派子代理执行** — 通过 Task tool

6. **解析子代理返回** — 验证制品

7. **检查质量门**
   \`\`\`bash
   GATE_BEHAVIOR=$(node "$PLUGIN_DIR/scripts/orchestrator-cli.mjs" get-gate-behavior {mode} $GATE_ID)
   \`\`\`

8. **输出完成摘要**

### 后备和降级

- orchestration.yaml 缺失 → 自动使用 orchestrator-fallback.js
- 并行调用失败 → 自动回退到串行模式
```

---

## 实施步骤（T2.5 完成）

对于每个待重构的 SKILL.md（story、implement、fix、resume、sync、doc）：

1. **备份原文件**
   ```bash
   cp plugins/spec-driver/skills/{skill}/SKILL.md \
      plugins/spec-driver/skills/{skill}/SKILL.md.original
   ```

2. **提取初始化部分**
   - 读取原 SKILL.md，定位初始化阶段的结束位置（通常在"## 并行执行策略"或"## 工作流定义"前）
   - 保留该部分内容，但在第 4 步后添加"3.6 编排配置加载"

3. **应用重构模板**
   - 删除原 SKILL.md 中所有的 Phase 详细定义
   - 保留并行执行策略的表格，但在其后添加"通过编排器查询"说明
   - 使用新的"工作流执行（动态模式）"部分替换原 Phase 定义

4. **模式特定调整**
   - 将 `{mode}` 替换为实际模式名（feature、story、implement、fix、resume、sync、doc）
   - 调整 Phase 数量提示（例：story 是 5 个 Phase，feature 是 10 个）
   - 保留模式特定的参数（例：story 没有 --research 参数）

5. **验证**
   - 检查文件大小（应该减少 50-70%）
   - 确保所有初始化逻辑仍然完整
   - 运行 npm run repo:check（在完成所有 6 个文件后）

---

## 预期效果

### 文件大小缩减

| 模式 | 原始行数 | 预期重构后 | 缩减比例 | 核心改进 |
|------|---------|-----------|--------|---------|
| feature | 1,058 | 322 | 70% | ✅ 已完成 |
| story | 590 | ~180 | 70% | 待完成 |
| implement | 535 | ~160 | 70% | 待完成 |
| fix | 472 | ~140 | 70% | 待完成 |
| resume | 331 | ~100 | 70% | 待完成 |
| sync | 297 | ~90 | 70% | 待完成 |
| doc | 729 | ~220 | 70% | 待完成 |
| **合计** | **3,850** | **~1,200** | **~70%** | **→** |

### 核心收益

1. **可维护性**：编排逻辑集中在 orchestration.yaml，不分散在 7 个文件中
2. **可读性**：SKILL.md 焦点从编排细节转向高层流程说明
3. **可扩展性**：新增模式（如 093 refactor）只需在 orchestration.yaml 中添加，无需改动 SKILL.md
4. **容错性**：后备配置确保即使 YAML 加载失败也能自动降级运行
5. **一致性**：所有 7 种模式使用同一套编排查询接口

---

## 测试验证（T3）

重构完成后，通过 T3 的烟雾测试验证：

```bash
# 验证所有 7 种模式仍能正常执行
npm run test:orchestrator -- --pattern "orchestrator.test.mjs"

# 验证向后兼容性（使用 fallback 配置）
npm run test:orchestrator -- --pattern "fallback"

# 最终验证
npm run repo:check
```

---

**版本**：1.0
**完成日期**：2026-04-06（T2.4 完成，T2.5 模板确立）
**负责**：spec-driver-feature refactoring demonstration
