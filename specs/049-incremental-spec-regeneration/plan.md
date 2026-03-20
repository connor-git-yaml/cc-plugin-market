# Implementation Plan: 增量差量 Spec 重生成

## 目标

在现有 batch 流程上增加增量模式，使 `reverse-spec batch --incremental` 能：

- 基于 `skeletonHash` 找出直接变化的 sourceTarget
- 通过 dependency graph 反向传播找到受影响 spec
- 只重生成这些 spec
- 对未受影响的 module spec 保持文件内容和 mtime 不变
- 继续输出完整的 index / doc graph / coverage / delta report

## 范围

- 新增 `DeltaRegenerator`
- 新增旧 spec 摘要扫描能力
- batch 增量模式与 delta report 接入
- CLI 参数 `--incremental`
- 单测 / 集成测试 / CLI runner 回归

## 非目标

- 不做文件级 patch 更新或 section 级局部重写
- 不删除 stale spec 文件
- 不改变单模块 `generate` 命令行为

## 设计

### 1. Stored Module Spec Summary

新增对既有 `*.spec.md` 的最小摘要解析，供三个消费方复用：

- 049: 读取 `version` / `skeletonHash` / `sourceTarget`
- 044/046: 读取 `linked` / `confidence`
- index: 读取 `intentSummary`

### 2. DeltaRegenerator

输入：

- `projectRoot`
- `DependencyGraph`
- `ModuleGroup[]`
- 旧 spec 摘要

输出：

- 直接命中的 sourceTarget
- 传播命中的 sourceTarget
- unchanged sourceTarget
- fallback / full-regenerate reason

流程：

1. 为每个当前 sourceTarget 计算最新 skeleton hash
2. 与既有 spec 的 `skeletonHash` 比较，得到直接变化集合
3. 以直接变化对应源码文件为起点，沿 dependency graph 做反向遍历
4. 使用 doc graph owner resolution 将受影响源码文件映射回 spec owner
5. 产出增量计划与差量报告

### 3. batch 接入

- `BatchOptions` / CLI 新增 `incremental`
- `force=true` 时忽略增量计划并执行全量
- 未受影响的 sourceTarget 直接跳过写入
- 汇总阶段使用“本次生成 spec + 旧 spec 摘要”共同构建 index / doc graph / coverage

### 4. 报告输出

新增：

- `specs/_delta-report.md`
- `specs/_delta-report.json`

CLI 成功输出中追加 delta report 路径。

## 文件变更

### 新增

- `src/batch/delta-regenerator.ts`
- `templates/delta-report.hbs`
- `tests/panoramic/delta-regenerator.test.ts`
- `tests/integration/batch-incremental.test.ts`
- `specs/049-incremental-spec-regeneration/*`

### 修改

- `src/batch/batch-orchestrator.ts`
- `src/batch/delta-regenerator.ts`
- `src/cli/utils/parse-args.ts`
- `src/cli/commands/batch.ts`
- `src/cli/index.ts`
- `src/generator/index-generator.ts`
- `src/panoramic/doc-graph-builder.ts`
- `tests/unit/cli-commands.test.ts`
- `tests/unit/cli-command-runners.test.ts`
