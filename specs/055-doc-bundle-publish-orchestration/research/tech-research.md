# 技术调研报告: 文档 Bundle 与发布编排

**特性分支**: `055-doc-bundle-publish-orchestration`  
**调研日期**: 2026-03-20  
**调研模式**: 离线 / 独立模式  
**产品调研基础**: 无（本次为 `tech-only`，未执行产品调研）

## 1. 调研目标

**核心问题**:
- 如何在不重新抽取项目事实的前提下，为 053 batch 输出追加 docs bundle 编排层
- 如何把 batch 已生成的模块 spec、项目级 panoramic 文档和 `_index.spec.md` 组织成 4 套受众导向的阅读包
- 如何生成足够轻量、但又能被 MkDocs / TechDocs 直接消费的目录结构与 manifest

**需求范围（来自需求描述与 054 蓝图 5.1 Phase 0）**:
- 055 是“文档交付与发布编排层”，不是新的事实抽取器
- 强依赖只有 053，可与 056 并行，不能提前实现 056/057/059
- 交付物至少包含 `docs-bundle.yaml`、4 个 bundle profile、自动 landing page 和 MkDocs / TechDocs 兼容骨架

## 2. 架构方案对比

### 方案对比表

| 维度 | 方案 A: batch 后置 bundle orchestrator | 方案 B: 每个 generator 自己输出 bundle 片段 | 方案 C: 独立 CLI 二次扫描 specs/ 工程 |
|------|----------------------------------------|------------------------------------------|------------------------------------|
| 概述 | 在 `runBatch()` 末尾统一消费已有输出，生成 manifest + profile 目录 | 各 generator 自己声明 bundle 页面，batch 再拼装 | 新增独立命令重新扫描输出目录或源码再建 bundle |
| 与蓝图定位一致性 | 高，完全符合“交付与发布编排层” | 中，bundle 逻辑会泄漏到 generator 内部 | 中，虽然解耦但会重复发现与排序逻辑 |
| 对 053 复用程度 | 高，直接复用 `projectDocs`、module spec、`_index.spec.md` | 中，仍要改多个 generator | 中，需要重新理解输出结构 |
| 可维护性 | 高，编排规则集中管理 | 低，profile 规则分散在多个 generator | 中，代码位置独立但与 batch 脱节 |
| 非回归风险 | 低，可作为 batch 后置追加步骤 | 中高，修改面遍布 generator 实现 | 中，需要额外命令和新入口 |
| 适用规模 | 最适合 055 当前范围 | 不适合快速落地 | 更像后续 publish backend，不适合 055 |

### 推荐方案

**推荐**: 方案 A — 在 `runBatch()` 末尾新增统一的 `DocsBundleOrchestrator`

**理由**:
1. 055 的价值不是“多一个 generator”，而是把既有批量输出组织成可交付包；放在 batch 后置阶段最符合职责边界。
2. 它能直接复用 053 已产出的项目级文档列表、module specs 和 `_index.spec.md`，不需要再扫描源码或二次推断事实。
3. profile 选文、导航顺序、MkDocs skeleton 和 manifest 都可以集中定义，后续给 056/057/059 复用时也更稳定。

## 3. 输出结构与生态兼容性评估

### MkDocs / TechDocs 最小兼容骨架

当前需求并不要求在仓库内运行完整站点系统，只要求生成“可被消费”的结构。最小可行骨架应包括：

- `mkdocs.yml`
- `docs/` 目录
- `docs/index.md`
- 其余 Markdown 页面按导航顺序复制到 `docs/` 下

这符合 MkDocs 的基础目录结构，也能作为 TechDocs 的站点输入骨架。055 不需要把 `mkdocs-techdocs-core` 作为仓库运行前提，只需输出 TechDocs-friendly 的 `mkdocs.yml` 与导航结构。

### Manifest 形态选择

| 方案 | 优点 | 风险 |
|------|------|------|
| 仅 `mkdocs.yml` | 对站点直接可用 | 缺少统一 bundle 元数据，不利于后续 059/发布链路消费 |
| 仅 `docs-bundle.yaml` | 适合编排与发布元数据 | 站点系统仍需额外配置 |
| `docs-bundle.yaml` + 每个 profile 自带 `mkdocs.yml` | 同时满足 orchestration 与 site consumption | 需要维护两份结构，但数据可共享生成 |

**结论**: 同时输出根级 `docs-bundle.yaml` 和每个 profile 的 `mkdocs.yml`

## 4. 依赖与代码复用评估

### 现有入口复用

| 入口 | 可复用点 | 结论 |
|------|----------|------|
| `src/batch/batch-orchestrator.ts` | 055 的最佳集成点；已拥有 module specs、`_index`、project docs、coverage 结果 | ✅ 作为主挂接点 |
| `src/panoramic/batch-project-docs.ts` | 提供 053 项目级文档套件的产出列表与命名约定 | ✅ 作为 bundle 来源之一 |
| `src/panoramic/output-filenames.ts` | 当前项目级文档 base name 口径统一源 | ✅ 继续复用，必要时补 bundle 相关 helper |
| `src/panoramic/utils/multi-format-writer.ts` | 可继续用于现有 panoramic 文档写出；bundle manifest / mkdocs skeleton 不完全适用 | ⚠ 部分复用 |
| `tests/integration/batch-panoramic-doc-suite.test.ts` | 可直接扩展为 055 集成验证 fixture | ✅ 最佳现成验证入口 |

### 不建议复用的路径

- 不应把 bundle 编排塞进任一 `DocumentGenerator`，否则 055 会被误建模为“文档生成器”而不是“交付编排器”
- 不应重新调用 panoramic generators 再生成一套 Markdown，只需消费 batch 已写出的输出

## 5. Profile 设计建议

### 建议的核心阅读路径

1. `developer-onboarding`
   - `index`
   - `architecture-narrative`
   - `architecture-overview`
   - `runtime-topology`
   - `workspace-index` / `config-reference`
   - `module specs`

2. `architecture-review`
   - `index`
   - `architecture-overview`
   - `pattern-hints`
   - `architecture-narrative`
   - `cross-package-analysis`
   - `runtime-topology`
   - `event-surface`
   - `module specs`

3. `api-consumer`
   - `index`
   - `api-surface`
   - `config-reference`
   - `data-model`
   - `event-surface`
   - `troubleshooting`

4. `ops-handover`
   - `index`
   - `runtime-topology`
   - `troubleshooting`
   - `config-reference`
   - `architecture-overview`
   - `event-surface`

### 结论

- 四个 profile 不能只是“同一组页面换个文件夹”，必须在核心页面集合和排序上体现差异
- `developer-onboarding` / `architecture-review` 应纳入模块 spec section
- `api-consumer` / `ops-handover` 应优先强调项目级文档，不强制附带全量模块 spec

## 6. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | profile 规则写得过死，导致部分项目 bundle 过空 | 中 | 中 | 允许 profile 在核心文档缺失时降级保留 landing + 可用页面，并输出 warning |
| 2 | bundle 导航顺序退化为源文件名排序 | 中 | 高 | 用显式 profile 定义驱动导航与 target path，不从目录扫描排序推导 |
| 3 | 055 回头重新生成文档或重新扫描源码 | 低 | 高 | 约束输入只能来自 batch 现有输出与 module spec 元数据 |
| 4 | MkDocs / TechDocs 骨架做得过重，变成站点系统 | 中 | 中 | 只输出 `mkdocs.yml` + `docs/` + landing page，不增加构建依赖 |
| 5 | 自定义 `outputDir`、`incremental`、已有旧文档场景下路径错乱 | 中 | 高 | 统一以 `projectRoot` + batch 输出目录为基准，bundle 只消费“当前输出目录中存在的文件” |

## 7. 需求-技术对齐度

| 需求 | 技术方案覆盖 | 说明 |
|------|-------------|------|
| 4 个 profile | ✅ 完全覆盖 | 通过内置 profile 定义表实现 |
| docs-bundle manifest | ✅ 完全覆盖 | 根级 `docs-bundle.yaml` 汇总 profile 与源文件映射 |
| landing page / index | ✅ 完全覆盖 | 每个 profile 自动生成 `docs/index.md` |
| MkDocs / TechDocs 骨架 | ✅ 完全覆盖 | 每个 profile 输出 `mkdocs.yml` + `docs/` 目录 |
| 不重新生成事实 | ✅ 完全覆盖 | 只消费 053 已输出文档、`_index.spec.md` 和 module specs |
| 与 056/057/059 解耦 | ✅ 完全覆盖 | 只提供 bundle manifest/types，不提前做 IR / publish backend |

## 8. 结论与建议

055 的最佳实现方式，是在 `runBatch()` 末尾增加一个轻量的 `DocsBundleOrchestrator`：输入为当前 batch 输出目录中已经存在的模块 spec、`_index.spec.md` 和 053 项目级文档；输出为根级 `docs-bundle.yaml` 与 4 个 profile 的 MkDocs / TechDocs 兼容目录结构。这样既满足蓝图 Phase 0 的“交付与发布编排层”定位，又不会提前侵入 056/057/059 的建模和发布职责。
