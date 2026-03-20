# Implementation Plan: 架构中间表示（Architecture IR）导出

**Branch**: `codex/056-architecture-ir-export` | **Date**: 2026-03-20 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/056-architecture-ir-export/spec.md`

---

## Summary

实现 056 的核心目标是：基于现有 panoramic 输出建立统一 `ArchitectureIR`，并从同一份 IR 导出 Structurizr DSL、结构化 JSON 与 Mermaid 互通结果。该 Feature 不重写 `architecture-overview`、`runtime-topology`、`workspace-index`、`cross-package-deps` 的事实提取，而是在其结构化输出之上新增一层复用型 builder / exporter。

落地策略：

1. 以 045 `ArchitectureOverviewModel` 作为统一结构主入口
2. 用 043/040/041 输出补齐 deployment / component 属性和证据
3. 新增 `architecture-ir` panoramic generator，并接入 registry / batch / barrel
4. 扩展 multi-format writer，在 `all` 模式下额外写出 `.dsl`

---

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js >= 20  
**Primary Dependencies**: 现有 panoramic generators、`handlebars`、Node.js built-ins、`vitest`  
**Storage**: 文件系统（`src/panoramic/`、`templates/`、`tests/`、`specs/056-architecture-ir-export/`）  
**Testing**: `vitest`, `npm run lint`, `npm run build`  
**Target Platform**: Node.js CLI / MCP panoramic pipeline  
**Project Type**: 单仓库 TypeScript project  
**Performance Goals**: 056 的增量开销应主要来自现有 045/043/040/041 组合调用与导出渲染，不新增新的 AST/配置全量扫描阶段  
**Constraints**:

- 不新增第二套架构事实源
- Structurizr 只作为导出合同，不作为事实模型
- 保持 `markdown/json/all` 兼容
- batch 写盘与 coverage 命名保持一致
- 所有写操作限于 `specs/056-architecture-ir-export/`、`src/panoramic/`、`templates/`、`tests/` 与必要的插件版本文件

**Scale/Scope**: 1 个新 shared model、1 组 builder/exporter/adapter、1 个新 generator、1 个模板、batch/writer/registry 集成、若干测试

---

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| **Spec-Driven Development** | 适用 | PASS | 按 research -> spec -> plan -> tasks -> implementation -> verification 推进 |
| **诚实标注不确定性** | 适用 | PASS | 视图缺失时保留 unavailable / warning，而不是伪造实体 |
| **AST / 静态提取优先** | 适用 | PASS | 056 复用现有静态结构化输出，不引入运行时 introspection |
| **混合分析流水线** | 部分适用 | PASS | 本 Feature 只做结构统一与导出，不新增 LLM 依赖 |
| **只读安全性** | 适用 | PASS | 仅修改允许范围内文件 |
| **纯 Node.js 生态** | 适用 | PASS | 无新增非 Node 运行时依赖 |
| **双端兼容** | 适用 | PASS | 不引入 Claude-only 或 Codex-only 方案 |
| **质量门控不可绕过** | 适用 | PASS | 将执行测试、lint、build，并附验证记录 |

**结论**: 设计通过，无需豁免。

---

## Project Structure

### Documentation

```text
specs/056-architecture-ir-export/
├── research.md
├── spec.md
├── plan.md
├── tasks.md
└── verification.md
```

### Source Code

```text
src/panoramic/
├── architecture-ir-model.ts            # [新增] 056 统一 IR 数据模型
├── architecture-ir-builder.ts          # [新增] 045/043/040/041 -> IR 映射
├── architecture-ir-exporters.ts        # [新增] JSON / Structurizr DSL 导出
├── architecture-ir-mermaid-adapter.ts  # [新增] IR <-> Mermaid 互通适配
├── architecture-ir-generator.ts        # [新增] panoramic generator
├── generator-registry.ts               # [修改] 注册 architecture-ir
├── output-filenames.ts                 # [修改] batch 命名映射
├── batch-project-docs.ts               # [修改] 写出 .dsl 与 mermaid
├── utils/multi-format-writer.ts        # [修改] 支持额外导出文件
└── index.ts                            # [修改] 导出 056 类型与工具

templates/
└── architecture-ir.hbs                 # [新增] IR 摘要文档模板

tests/panoramic/
├── architecture-ir-builder.test.ts     # [新增] builder 单测
├── architecture-ir-generator.test.ts   # [新增] exporter / generator 测试
└── utils/multi-format-writer.test.ts   # [修改] 额外文件写盘测试

tests/integration/
└── batch-panoramic-doc-suite.test.ts   # [修改] batch 写出 architecture-ir.* 集成验证
```

---

## Design

### 1. `ArchitectureIR` Shared Model

新增共享模型，至少包含：

- `ArchitectureIR`
- `ArchitectureIRElement`
- `ArchitectureIRRelationship`
- `ArchitectureIRView`
- `ArchitectureIRViewRef`
- `ArchitectureIRSourceTag`
- `ArchitectureIRExportBundle`

建模规则：

- 元素与关系是唯一事实集合
- 各视图只引用元素/关系 ID，不复制建模
- 证据与来源标签直接挂在元素/关系上
- view 保留 `available` / `warnings` / `mermaidSection`

### 2. Builder Strategy

`buildArchitectureIR()` 输入：

- 必选：`ArchitectureOverviewOutput`
- 可选：`RuntimeTopologyOutput`
- 可选：`WorkspaceOutput`
- 可选：`CrossPackageOutput`

映射优先级：

1. `architecture-overview.model.sections`
2. `runtime-topology.topology`
3. `workspace-index`
4. `cross-package-deps`

职责：

- 把 045 的 node/edge 转成统一 element/relationship
- 把 deployment unit / module summary 归并到 element metadata
- 为 system context / deployment / component 生成 view refs
- 聚合 warnings / stats / sources

### 3. Exporters

新增两个主要导出器：

- `exportArchitectureIRJson()`
- `exportArchitectureIRStructurizrDsl()`

Structurizr DSL 导出规则：

- workspace -> model -> views
- `softwareSystem` 作为顶层系统
- runtime 服务与容器映射到 container / deployment node
- workspace package/group 映射到 component 粒度
- 关系描述优先使用已有 relation kind + 来源标签

### 4. Mermaid Interop

新增 `buildArchitectureIRMermaidInterop()`：

- 从 IR 的 `views.systemContext` 生成 system-context Mermaid
- 从 IR 的 `views.deployment` 生成 deployment Mermaid
- 从 IR 的 `views.component` 生成 component/layered Mermaid
- 聚合为单一 `.mmd` 输出，沿用 batch 当前 section 拼接格式

### 5. Generator & Batch Integration

新增 `ArchitectureIRGenerator`：

- `id = 'architecture-ir'`
- `extract()` 组合 045/043/040/041 输出
- `generate()` 构建 `ArchitectureIR` 和导出 bundle
- `render()` 输出 IR 摘要 Markdown

batch 集成点：

- `generator-registry.ts` 注册新 generator
- `output-filenames.ts` 新增 `architecture-ir`
- `batch-project-docs.ts` 从结构化输出取 Mermaid 与 DSL
- `writeMultiFormat()` 新增可选 `extraFiles`

### 6. Verification Plan

- 单测：IR builder、exporters、writer
- 集成：batch 实际写出 `architecture-ir.md/.json/.mmd/.dsl`
- 回归：registry 可发现 056 generator
- 工程验证：`npm run lint`、`npm run build`
- 真实样例：优先对当前仓库或稳定 fixture 做一次实际导出，并写入 `verification.md`

---

## Implementation Order

1. 新增 IR model / builder / exporter / mermaid adapter
2. 实现 generator 与模板
3. 接入 registry / barrel / batch / writer
4. 增补单测与集成测试
5. 跑验证并输出 verification report
