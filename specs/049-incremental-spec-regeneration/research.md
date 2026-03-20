# Research Summary: 增量差量 Spec 重生成

## 结论

049 适合建立在现有三块事实上：

1. `single-spec-orchestrator` 已稳定产出 `frontmatter.skeletonHash`
2. `doc-graph-builder` 已能把源码映射回 spec owner
3. `batch-orchestrator` 已掌握当前模块分组与依赖图

因此 049 不需要重做生成链路，重点是补一层“旧 spec 扫描 + 影响传播 + 选择性重生成”。

## 关键决策

- 直接变更检测使用 `skeletonHash`
- 影响传播使用 dependency graph 反向遍历
- source file -> spec owner 映射复用 044 的 DocGraph 语义
- 汇总文档继续每次重建；只有未受影响的 module spec 严格禁止重写
- `root` 组按文件级 sourceTarget 处理，避免整个 root 组被粗暴刷新
