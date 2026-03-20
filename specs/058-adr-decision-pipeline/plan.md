# Implementation Plan: 058 ADR 决策流水线

## 目标

在不破坏现有 batch / project docs / coverage 语义的前提下，为项目级文档输出增加 `docs/adr` 目录，自动生成 ADR 索引与候选草稿。

## 技术方案

### 1. 新增 ADR pipeline 模块

创建 `src/panoramic/adr-decision-pipeline.ts`，职责分为四层：

1. **Corpus 收集**
   - `architecture-narrative`
   - `pattern-hints`
   - `architecture-overview`
   - `specs/**/*.md` 中的 `spec.md` / `blueprint.md` / `current-spec.md`
   - `git log -n 20`
   - 源码路径信号

2. **规则识别**
   - `cli-hosted-runtime`
   - `stream-json-protocol`
   - `registry-extensibility`
   - `deterministic-facts`
   - `current-spec-fact-source`
   - `append-only-session-metadata`
   - `containerized-runtime-boundary`
   - `modular-surface-separation`

3. **ADR 草稿模型**
   - `AdrDraft`
   - `AdrEvidenceRef`
   - `AdrIndexOutput`

4. **渲染输出**
   - `docs/adr/index.md + index.json`
   - `docs/adr/adr-0001-*.md + .json`

### 2. 接入 batch 项目级编排

修改 `src/panoramic/batch-project-docs.ts`：

- 保留现有 generator 扫描与 `architecture-narrative`
- 在其后调用 `generateBatchAdrDocs(...)`
- 把 ADR 写出的文件纳入 `generatedDocs`
- 失败时只记录 warning，不中断其他项目级文档输出

### 3. 输出结构

```text
<outputDir>/
  docs/
    adr/
      index.md
      index.json
      adr-0001-<slug>.md
      adr-0001-<slug>.json
      ...
```

### 4. 验证策略

- 单测：
  - current-spec / registry / fallback 组合
  - CLI transport / JSON protocol 组合
- 集成：
  - `runBatch()` 后出现 `specs/docs/adr/index.md`
  - 至少 2 篇草稿被写出
- 编译：
  - `npm run lint`
  - `npm run build`

## 风险与缓解

1. **证据命中过少**
   - 用 `architecture-narrative` 关键模块作为最终兜底
2. **真实仓库没有 specs/current-spec**
   - 允许只用 narrative + pattern hints + git/source paths 继续生成
3. **ADR 输出过多**
   - 候选规则评分后截断到最多 4 篇
