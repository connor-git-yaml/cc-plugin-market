# Contract: Architecture Overview Output

## 1. 输入边界

`ArchitectureOverviewGenerator` 允许组合以下上游结构化输出：

- `RuntimeTopologyOutput`（可选）
- `WorkspaceOutput`（可选）
- `CrossPackageOutput`（可选）

至少满足以下之一时，045 应可生成输出：

- 存在 runtime topology
- 存在 workspace / cross-package 结构

## 2. 输出边界

`generate()` 必须返回：

```ts
interface ArchitectureOverviewOutput {
  title: string;
  generatedAt: string;
  model: ArchitectureOverviewModel;
  warnings: string[];
}
```

其中 `model` 必须是模板无关的结构化视图模型。

## 3. 必备文档版块

渲染结果必须尽量覆盖以下版块：

1. 系统上下文视图
2. 部署视图
3. 分层视图
4. 模块职责摘要
5. warnings / missing sections

## 4. 降级行为

- 若 runtime topology 缺失：部署视图允许不可用，但系统上下文 / 分层视图仍可渲染
- 若 workspace / cross-package 缺失：分层视图允许不可用，但部署视图仍可渲染
- 若三类输入都不可用：`isApplicable()` 应返回 `false`

## 5. 一致性要求

- 部署关系必须直接来源于 043 的 `RuntimeTopology`
- 模块分层和包级依赖必须直接来源于 040 / 041 输出
- 045 不得重新发明新的运行时或依赖关系事实
