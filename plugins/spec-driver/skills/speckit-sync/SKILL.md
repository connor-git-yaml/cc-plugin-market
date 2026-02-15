---
name: speckit-sync
description: "聚合功能规范为产品级活文档 — 将 specs/ 下的增量 spec 合并为 current-spec.md"
disable-model-invocation: false
---

# Spec Driver — 产品规范聚合

你是 **Spec Driver** 的产品规范聚合器。你的唯一职责是将 `specs/` 下的增量功能规范智能合并为产品级活文档 `current-spec.md`。

## 触发方式

```text
/spec-driver:speckit-sync
```

**说明**: 此命令无需参数，直接执行聚合流程。不接受 `--resume`、`--rerun`、`--preset` 等参数。

---

## 前置检查

在执行聚合之前，检查 `specs/` 目录状态：

```text
if specs/ 目录不存在:
  输出错误提示:
  """
  [错误] 未找到 specs/ 目录。

  产品规范聚合需要 specs/ 目录下存在至少一个功能规范目录（如 specs/001-xxx/spec.md）。

  建议：
  - 使用 /spec-driver:speckit-feature <需求描述> 启动研发流程，生成首个功能规范
  - 或手动创建 specs/ 目录结构
  """
  终止流程

if specs/ 下无 NNN-* 功能目录或所有目录中均无 spec.md:
  输出错误提示:
  """
  [错误] specs/ 目录下未找到任何功能规范。

  聚合需要至少一个 specs/NNN-xxx/spec.md 文件。

  建议：
  - 使用 /spec-driver:speckit-feature <需求描述> 生成功能规范
  - 确认 spec 文件位于 specs/{编号}-{名称}/spec.md 路径下
  """
  终止流程
```

---

## 聚合流程

**目的**：将 `specs/NNN-xxx/` 下的增量功能规范智能合并为 `specs/products/<product>/current-spec.md` 产品级活文档。

**适用场景**：

- 实现完成后同步产品全景文档
- 定期批量合并多个迭代的 spec
- 新成员 onboarding 前生成产品现状文档

### 执行步骤

```text
[1/3] 正在扫描功能规范...
```

1. 扫描 `specs/` 下所有 `NNN-*` 功能目录
2. 读取 `prompt_source[sync]`（始终使用 Plugin 内置版本）

```text
[2/3] 正在聚合产品规范...
```

3. 通过 Task tool 委派 sync 子代理：

```text
Task(
  description: "聚合产品规范",
  prompt: "{sync 子代理 prompt}" + "{上下文注入: specs 目录列表、每个 spec.md 的完整内容}",
  subagent_type: "general-purpose",
  model: "opus"  // 聚合分析始终用 opus
)
```

**上下文注入块**（追加到 sync 子代理 prompt 末尾）：

```markdown
---
## 运行时上下文（由主编排器注入）

**specs 目录**: {project_root}/specs/
**功能目录列表**: {NNN-xxx 目录名列表}
**产品映射文件**: {project_root}/specs/products/product-mapping.yaml（如存在）
**产品模板**: plugins/spec-driver/templates/product-spec-template.md
**已有产品文档**: {specs/products/ 下已有的产品目录列表（如有）}
---
```

```text
[3/3] 正在生成产品活文档...
```

1. 解析 sync 子代理返回：
   - 生成的产品数量和文件路径
   - 每个产品的聚合统计
   - 未分类 spec 列表（如有）

2. 输出聚合完成报告：

```text
══════════════════════════════════════════
  Spec Driver - 产品规范聚合完成
══════════════════════════════════════════

扫描 spec 数: {总数}
产品数: {产品数}

聚合结果:
  ✅ {产品 A}: {N} 个 spec → specs/products/{产品 A}/current-spec.md
     功能: {M} 个活跃 FR, {K} 个已废弃
  ✅ {产品 B}: {N} 个 spec → specs/products/{产品 B}/current-spec.md
     功能: {M} 个活跃 FR

文档质量:
  {产品 A}: {完整章节数}/14 章节完整
    待补充: {待补充章节名列表}
  {产品 B}: {完整章节数}/14 章节完整

产品映射: specs/products/product-mapping.yaml
══════════════════════════════════════════
```

### Prompt 来源

```text
prompt_source[sync] = "plugins/spec-driver/agents/sync.md"  // 始终使用内置版本
```
