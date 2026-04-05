# 技术调研报告: Script Platform 共享层收敛

**特性分支**: `078-script-platform-shared-layer`  
**调研日期**: 2026-04-05  
**调研模式**: codebase-scan  
**在线调研**: 跳过，`project-context` 标记 `online_required=false`，且本特性只涉及仓内脚本共享层收敛

## 1. 调研目标

**核心问题**:
- `plugins/spec-driver/scripts/*.mjs` 的重复逻辑具体集中在哪些脚本、哪些 helper 类型
- 078 应该把共享层放在什么位置，才能同时兼容 Codex / Claude 和当前 `.mjs` 执行方式
- 哪些逻辑适合抽成真正共享 primitive，哪些仍应保留在脚本内各自渲染
- 如何在不改变外部产物合同的前提下，为 081 提前打好共享层基础

**需求范围（来自蓝图 076 / 6.2）**:
- 统一 YAML parse / stringify
- 统一 report file IO
- 统一 entity / catalog / index patch
- 统一 Markdown renderer helpers
- 统一 diagnostics / warning shape
- 优先覆盖 `entity / workflow / quality / scorecard / adoption / suggestions` 六条主链

## 2. 代码面扫描结果

### 重复点清单

| 类型 | 当前位置 | 观察 |
|------|----------|------|
| `parseYamlDocument` | `generate-workflow-registry.mjs`, `generate-product-quality-reports.mjs`, `generate-product-scorecards.mjs` | 已有共享 `lib/simple-yaml.mjs`，但这三条主链仍内嵌等价实现 |
| `stringifyYaml` | `generate-product-entity-catalog.mjs`, `generate-product-quality-reports.mjs`, `generate-product-scorecards.mjs`, `generate-project-context-suggestions.mjs` | 4 份实现高度相似，仅在 scalar formatting 上有轻微差异 |
| `patchCatalogIndex` / entity patch | `generate-product-quality-reports.mjs`, `generate-product-scorecards.mjs` | 都是读取 YAML、按 `id` 合并摘要再回写 |
| report IO | `quality / scorecard / adoption / suggestions / workflow / entity` | 都在脚本里重复 `mkdirSync + writeFileSync + JSON.stringify` 模式 |
| warning section 渲染 | `workflow / quality / scorecard / adoption / suggestions` | 都以 `## Warnings` + bullets 结尾，只是前文结构不同 |

### 现有共享层现状

- `plugins/spec-driver/scripts/lib/simple-yaml.mjs`
  - 已提供共享 `parseYamlDocument`
  - 尚未提供共享 `stringifyYaml`
- `plugins/spec-driver/scripts/lib/product-artifact-paths.mjs`
  - 已集中路径合同和 preferred/legacy path 规则
- `plugins/spec-driver/scripts/lib/project-profile-resolver.mjs`
  - 已证明 `.mjs + lib` 方式适合承载可测试的共享逻辑

### 关键文件

- `plugins/spec-driver/scripts/generate-product-entity-catalog.mjs`
- `plugins/spec-driver/scripts/generate-workflow-registry.mjs`
- `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`
- `plugins/spec-driver/scripts/generate-product-scorecards.mjs`
- `plugins/spec-driver/scripts/generate-adoption-insights.mjs`
- `plugins/spec-driver/scripts/generate-project-context-suggestions.mjs`

## 3. 架构方案对比

| 维度 | 方案 A: 继续局部复制 | 方案 B: 扩展 `scripts/lib` 共享层 | 方案 C: 把六条脚本整体迁到 `src/**` TypeScript |
|------|----------------------|----------------------------------|----------------------------------------------|
| 概述 | 只修某个脚本的重复点，不统一抽象 | 在 `plugins/spec-driver/scripts/lib/` 新增共享 primitives，并逐步迁移六条主链 | 建立 TS 共享平台，再改脚本入口去调用编译产物 |
| 改动风险 | 低 | 中 | 高 |
| 维护收益 | 低 | 高 | 高 |
| 与蓝图 076 对齐度 | 低 | 高 | 中 |
| 对外合同稳定性 | 中 | 高 | 中 |
| 实施成本 | 低 | 中 | 高 |
| Codex / Claude 兼容性 | 高 | 高 | 中 |
| 适合 078 | 否 | 是 | 否 |

### 推荐方案

**推荐**: 方案 B，扩展 `plugins/spec-driver/scripts/lib/` 共享层

**理由**:
1. 蓝图 076 明确要求“Bash 只保留轻量入口，真正的解析、渲染、patch、report 逻辑进入共享库”，方案 B 正好符合该约束。
2. 当前 `.mjs` 脚本已经有共享 lib 模式；继续沿用 ESM lib 可以保持零额外运行时依赖和双端兼容。
3. 方案 C 会把 078 从“共享层收敛”扩大成“平台迁移”，风险超过蓝图要求。

## 4. 推荐共享层切分

### 4.1 YAML

**建议**: 在 `plugins/spec-driver/scripts/lib/simple-yaml.mjs` 中补齐 `stringifyYaml`，让 `parseYamlDocument` / `stringifyYaml` 成为同一个 shared module 的正式导出。

**原因**:
- 当前已经有共享 parse helper，直接补 stringify 的迁移成本最低
- 可以把当前四份 stringify 的 quote / scalar 规则压到一处，并用单测固定

### 4.2 Report IO

**建议**: 新增 `plugins/spec-driver/scripts/lib/script-report-io.mjs`

**职责**:
- `writeJsonArtifact`
- `writeMarkdownArtifact`
- `writeYamlArtifact`
- `readJsonArtifact`
- `ensureArtifactDir`

**边界**:
- 只抽“路径父目录创建 + 序列化写入 + 常见读取”
- 不把每份报告的业务结构揉成统一 schema

### 4.3 Artifact Patch

**建议**: 新增 `plugins/spec-driver/scripts/lib/product-artifact-patchers.mjs`

**职责**:
- 读 `entity.yaml` / `catalog-index.yaml`
- 按 `id` 合并 summary
- 保留 preferred/legacy path 与 missing-file skip 语义

**边界**:
- 共享“读-改-写骨架”与匹配逻辑
- 每个报告的字段映射通过 callback / patch descriptor 传入

### 4.4 Diagnostics / Markdown Helpers

**建议**: 新增轻量 `script-diagnostics.mjs` 或等价 helper

**职责**:
- `dedupeStringValues`
- `normalizeWarnings`
- `appendWarningsSection`
- 可能的 `escapeTableCell` / `renderBulletList`

**边界**:
- 只抽共性块
- 各报告主体模板仍留在脚本内

## 5. 兼容性与验证面

### 兼容性约束

- 不改变以下外部合同：
  - 脚本入口名
  - `--project-root` / `--json` 参数
  - `specs/products/**` 与 `.specify/**` 产物路径
  - 现有返回 JSON payload 的关键字段
- 不引入新的 npm 依赖
- 不要求先 `npm run build` 才能运行这些 `.mjs` 脚本

### 现有测试面

- `tests/integration/spec-driver-product-entity-catalog.test.ts`
- `tests/integration/spec-driver-workflow-registry.test.ts`
- `tests/integration/spec-driver-product-quality-reports.test.ts`
- `tests/integration/spec-driver-product-scorecards.test.ts`
- `tests/integration/spec-driver-adoption-insights.test.ts`
- `tests/integration/spec-driver-project-context-suggestions.test.ts`

### 078 需要新增的验证

- 共享层 unit tests，至少覆盖：
  - YAML parse / stringify 子集
  - artifact patch helper
  - report IO helper
  - warnings / diagnostics helper

## 6. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | 统一 stringify 后 quote 行为变化，导致 fixture 文本细节漂移 | 中 | 高 | 先用单测固定当前最常见标量与数组/对象格式，再用 integration tests 兜底 |
| 2 | patch helper 过度抽象，反而掩盖 `quality` 与 `scorecard` 的字段差异 | 中 | 中 | 只抽读写骨架和按 `id` merge，字段映射保持由脚本显式提供 |
| 3 | 为了“共享”而重写所有 Markdown render，导致实现面膨胀 | 高 | 中 | 只抽 warnings / table escape / bullet helpers，不统一整份报告模板 |
| 4 | adoption 脚本没有 YAML 输出，错误地被强迫接入不必要抽象 | 中 | 低 | 让共享层按需组合，脚本只使用自己需要的 helper |

## 7. 结论与建议

### 总结

078 的本质不是新能力，而是把 script platform 的重复基础设施显式产品化。最合适的实现方式是在 `plugins/spec-driver/scripts/lib/` 继续生长可测试共享层，并把六条主链迁到同一套 YAML、IO、patch 和 diagnostics primitives 上。

### 对后续规格与规划的建议

- spec 中应把“只收敛基础能力、不统一所有报告模板”写成明确边界。
- plan 中建议按 `shared lib -> six-chain migration -> tests` 三段推进，避免一边抽象一边混改所有脚本。
- tasks 中需要把“代码检索确认不再存在重复 parse/stringify 定义”列为验收检查，而不只依赖测试绿灯。
