---
feature: 103-multi-format-export
branch: claude/magical-goodall
created: 2026-04-12
status: Draft
specRef: specs/103-multi-format-export/spec.md
planRef: specs/103-multi-format-export/plan.md
---

# Tasks: multi-format-export

**输入**: `specs/103-multi-format-export/spec.md` + `specs/103-multi-format-export/plan.md`
**前置条件**: Feature 101（graph-builder）和 Feature 102（community-analysis）已落地

---

## Phase 1: Setup（项目基础结构）

**目的**: 建立本 Feature 所需的目录结构和构建期工具链，无业务逻辑依赖

- [x] T001 创建 `src/panoramic/exporters/` 目录下 Feature 所需空文件占位（`export-types.ts`、`obsidian-exporter.ts`、`html-exporter.ts`、`html-template.ts`），确认模块结构符合 plan.md
- [x] T002 创建 `src/cli/commands/export.ts` 空文件占位，确认 CLI 命令目录结构与现有命令一致
- [x] T003 创建 `scripts/inline-d3.ts` 空文件占位，确认 `scripts/` 目录存在且可用

**Checkpoint**: 目录结构就绪，所有新文件位置确认无误

---

## Phase 2: Foundational（阻塞性前置依赖）

**目的**: 实现被所有后续模块依赖的类型定义和构建工具，必须先于任何 User Story 实现完成

**⚠️ CRITICAL**: T004 ~ T007 完成前，US1 和 US2 的任何实现任务均不可开始

- [x] T004 实现 `src/panoramic/exporters/export-types.ts` — 定义 `ExportFormat`、`ExportConfig`、`ExportResult`、`ObsidianPage` 四个类型；无运行时依赖，纯类型文件
  - 涉及文件: `src/panoramic/exporters/export-types.ts`
  - FR 追踪: FR-001（ExportResult）、FR-006（ExportConfig）、FR-013（ExportFormat）
  - 验收: 文件可被其他模块 import，`tsc --noEmit` 零错误

- [x] T005 实现 `scripts/inline-d3.ts` — 构建期脚本：读取 `node_modules/d3-force/dist/d3-force.min.js` 和 `node_modules/d3-force/package.json`，生成并写入 `src/panoramic/exporters/html-template.ts` 顶部的 `D3_FORCE_BUNDLE` 常量和版本注释
  - 涉及文件: `scripts/inline-d3.ts`
  - FR 追踪: FR-006a、FR-018
  - 验收: 执行 `tsx scripts/inline-d3.ts` 后，`html-template.ts` 顶部包含 `const D3_FORCE_BUNDLE` 赋值和版本号注释；bundle 字符串非空

- [x] T006 实现 `src/panoramic/exporters/html-template.ts` — 骨架实现：声明 `D3_FORCE_BUNDLE` 常量（由 T005 写入）和 `buildHtmlTemplate(graphDataJson: string): string` 函数；函数将 d3 bundle、图谱数据 JSON、内联 CSS、交互 JS 组装为单文件 HTML 字符串
  - 涉及文件: `src/panoramic/exporters/html-template.ts`
  - FR 追踪: FR-006、FR-006a、FR-007、FR-008、FR-009、FR-010、FR-011、FR-012、FR-018
  - 依赖: T005（`D3_FORCE_BUNDLE` 必须先由构建脚本填充）
  - 验收: `buildHtmlTemplate('{}')` 返回包含 `<!DOCTYPE html>` 和 d3 bundle 关键字的字符串；`tsc --noEmit` 零错误

- [x] T007 在 `package.json` 中注册 `prebuild` 脚本 — 在现有 `scripts` 字段中新增或修改 `"prebuild": "tsx scripts/inline-d3.ts"`，确保 `npm run build` 前自动执行 d3 内联
  - 涉及文件: `package.json`
  - FR 追踪: FR-006a
  - 验收: `npm run build` 时自动触发 `inline-d3.ts`；`npm run build` 零错误

**Checkpoint**: 类型定义就绪 + d3 构建工具链就绪，可开始 US1 和 US2 并行实现

---

## Phase 3: User Story 1 — Obsidian Vault 导出（Priority: P1）🎯 MVP

**目标**: 实现完整的 Obsidian Vault 导出管道，开发者可通过纯函数调用将 `GraphJSON + CommunityResult + GodNode[]` 转换为结构完整的 Markdown 文件集

**独立测试**: 构造包含 3-5 个节点、2 个社区、1 个 God Node 的 mock 数据，直接调用 `generateObsidianVault()`，验证输出目录结构和文件内容正确

### US1 测试任务（先写测试，确认失败后再实现）

- [x] T008 [P] [US1] 编写 `sanitizeFilename()` 单元测试 — 覆盖：正常路径含 `/`、含 `:`、连续 `--` 合并、首尾 `-` 去除、超 200 字符截断（取前 195 字符 + 4 字符 FNV-1a 哈希）、空字符串；确认测试在实现前失败
  - 涉及文件: `src/panoramic/exporters/export-types.test.ts`
  - FR 追踪: FR-005

- [x] T009 [P] [US1] 编写 `buildIndexPage`、`buildCommunityPage`、`buildGodNodePage` 单元测试 — 覆盖：正常数据生成 `[[双向链接]]`、空邻居列表显示"无直接依赖关系"、节点无社区归属时显示"未分类"、spec 节点 `metadata.sourceTarget` 存在/不存在两种条件；确认测试在实现前失败
  - 涉及文件: `src/panoramic/exporters/obsidian-exporter.test.ts`
  - FR 追踪: FR-001、FR-002、FR-003、FR-004、FR-019

### US1 实现任务

- [x] T010 [US1] 实现 `sanitizeFilename(name: string): string` — 规则：替换 `/ \ : * ? " < > |` 和空格为 `-`；合并连续 `-` 为单个；去除首尾 `-`；长度 > 200 时截取前 195 字符 + FNV-1a 32-bit 短哈希（纯 JS 实现，无 `crypto` 依赖）
  - 涉及文件: `src/panoramic/exporters/obsidian-exporter.ts`
  - FR 追踪: FR-005
  - 依赖: T004（export-types）、T008（测试先行）
  - 验收: T008 的所有测试通过

- [x] T011 [US1] 实现 `buildIndexPage()` — 生成 `index.md` 内容：图谱总节点数、总边数、社区数量统计；遍历所有社区生成 `[[community-{id}]]` 链接列表；遍历所有 God Node 生成 `[[{sanitized-name}]]` 链接列表
  - 涉及文件: `src/panoramic/exporters/obsidian-exporter.ts`
  - FR 追踪: FR-001、FR-004
  - 依赖: T010（sanitizeFilename 先实现）
  - 验收: 返回的 `ObsidianPage.relativePath === 'index.md'`；内容包含所有社区和 God Node 的 `[[链接]]`

- [x] T012 [US1] 实现 `buildCommunityPage()` — 生成单个社区页内容：社区 ID 标题、cohesion 评分、核心节点 Top 3（通过 `nodeIdToLabel` Map 反查 label，生成 `[[链接]]`）、社区内所有节点列表（`[[链接]]`）、跨社区链接；`relativePath` 格式为 `communities/community-{id}.md`
  - 涉及文件: `src/panoramic/exporters/obsidian-exporter.ts`
  - FR 追踪: FR-002、FR-004
  - 依赖: T011（buildIndexPage 模式参考）
  - 验收: 返回 `ObsidianPage.relativePath` 匹配 `communities/community-{id}.md`；内容包含 cohesion 评分和双向链接

- [x] T013 [US1] 实现 `buildGodNodePage()` — 生成单个 God Node 页：节点度数、连接最多的关系类型、所属社区 `[[链接]]`（查 `nodeCommunityMap`）、直接邻居节点列表（无邻居时显示"无直接依赖关系"）；条件判断 `metadata.sourceTarget` 和 `metadata.relatedFiles`，存在时生成额外双向链接；`relativePath` 格式为 `god-nodes/{sanitized-name}.md`
  - 涉及文件: `src/panoramic/exporters/obsidian-exporter.ts`
  - FR 追踪: FR-003、FR-004、FR-019
  - 依赖: T012
  - 验收: 返回路径匹配 `god-nodes/*.md`；邻居列表空时包含"无直接依赖关系"文本

- [x] T014 [US1] 实现 `generateObsidianVault()` — 写盘入口：构建 `nodeIdToLabel` Map；依次调用 `buildIndexPage`、各 `buildCommunityPage`、各 `buildGodNodePage`；用 `fs.mkdirSync` 创建目录结构；用 `fs.writeFileSync`（或现有 `atomic-write.ts`）写入所有 Markdown 文件；返回 `ExportResult`（files 列表、fileCount、durationMs）
  - 涉及文件: `src/panoramic/exporters/obsidian-exporter.ts`
  - FR 追踪: FR-001、FR-002、FR-003、FR-004、FR-005、FR-016
  - 依赖: T011、T012、T013（所有 page builder 先实现）
  - 验收: T009 的所有测试通过；在 500 节点图谱上执行时间 < 5 秒

**Checkpoint**: US1 独立可测——可直接调用 `generateObsidianVault()` 验证 Vault 产物，无需 CLI

---

## Phase 4: User Story 2 — HTML 交互式可视化导出（Priority: P1）

**目标**: 实现完整的单文件 HTML 导出管道，生成可在浏览器独立运行的交互式知识图谱，支持节点搜索、社区过滤、点击详情、缩放拖拽

**独立测试**: 构造 mock 数据，调用 `generateHtmlExport()`，验证生成的 HTML 文件大小 < 2 MB，浏览器打开后节点可正常渲染和交互

**注**: US2 与 US1 可并行开发（不同文件），两者共同依赖 Phase 2 的 T004 ~ T007

### US2 测试任务（先写测试，确认失败后再实现）

- [x] T015 [P] [US2] 编写 `communityColor`、`nodeRadius`、`edgeOpacity` 单元测试 — 覆盖：颜色输出格式为 `hsl(...)` 字符串；节点半径在 [4, 20] 范围内；边透明度在 [0.1, 0.8] 范围内；度数为 0 时半径取最小值；confidenceScore 为边界值（0、1）时透明度正确
  - 涉及文件: `src/panoramic/exporters/html-exporter.test.ts`
  - FR 追踪: FR-007

- [x] T016 [P] [US2] 编写 `computeGridLayout` 和大图降级单元测试 — 覆盖：列数计算公式 `Math.ceil(Math.sqrt(n))`；节点间距 60px；节点数 > 5000 时 `buildGraphData` 输出包含 `fx`/`fy` 固定坐标；节点数 ≤ 5000 时不包含固定坐标
  - 涉及文件: `src/panoramic/exporters/html-exporter.test.ts`
  - FR 追踪: FR-012

### US2 实现任务

- [x] T017 [P] [US2] 实现 `communityColor(communityId, totalCommunities): string` — 按社区 ID 均匀分布色相（HSL 色彩空间），返回 `hsl(...)` 字符串；实现 `nodeRadius(degree): number` — 对数缩放，范围 [4, 20]px，度数为 0 时取 4；实现 `edgeOpacity(confidenceScore): number` — 线性映射，范围 [0.1, 0.8]
  - 涉及文件: `src/panoramic/exporters/html-exporter.ts`
  - FR 追踪: FR-007
  - 依赖: T004（export-types）、T015（测试先行）
  - 验收: T015 的所有测试通过

- [x] T018 [P] [US2] 实现 `computeGridLayout(nodeIds: string[]): Map<string, {x, y}>` — 计算网格布局坐标：列数 = `Math.ceil(Math.sqrt(nodeCount))`，节点间距 60px，按行列均匀分配 `(x, y)` 坐标
  - 涉及文件: `src/panoramic/exporters/html-exporter.ts`
  - FR 追踪: FR-012
  - 依赖: T016（测试先行）
  - 验收: T016 的网格布局测试通过

- [x] T019 [US2] 实现 `buildGraphData()` — 将 `GraphJSON + CommunityResult + GodNode[]` 序列化为嵌入 HTML 的 JSON 字符串：节点附加 `color`（communityColor）、`radius`（nodeRadius）、`communityId`（nodeCommunityMap 查询，不存在时为 -1 / "未分类"）；悬空边静默跳过（FR-017）；节点数 > 5000 时调用 `computeGridLayout` 并注入 `fx`/`fy`
  - 涉及文件: `src/panoramic/exporters/html-exporter.ts`
  - FR 追踪: FR-007、FR-012、FR-016、FR-017
  - 依赖: T017、T018
  - 验收: 返回合法 JSON 字符串；大图场景包含 `fx`/`fy`；悬空边不出现在输出中

- [x] T020 [US2] 实现 `generateHtml()` — 纯函数，不写盘：调用 `buildGraphData()` 获取图谱 JSON，调用 `buildHtmlTemplate()` 组装完整 HTML 字符串（含 d3 bundle、搜索面板 JS、社区图例 JS、节点点击侧栏 JS、缩放拖拽 JS）
  - 涉及文件: `src/panoramic/exporters/html-exporter.ts`
  - FR 追踪: FR-006、FR-007、FR-008、FR-009、FR-010、FR-011、FR-012、FR-018
  - 依赖: T019、T006（html-template buildHtmlTemplate 先实现）
  - 验收: 返回字符串包含 `<!DOCTYPE html>`、`D3_FORCE_BUNDLE` 关键字、图谱数据 JSON；Buffer.byteLength < 2 MB（500 节点测试集）

- [x] T021 [US2] 实现 `generateHtmlExport()` — 写盘入口：调用 `generateHtml()` 获取 HTML 字符串；用 `fs.mkdirSync` 确保目录存在；写入 `{outputDir}/graph.html`；返回 `ExportResult`
  - 涉及文件: `src/panoramic/exporters/html-exporter.ts`
  - FR 追踪: FR-006、FR-016
  - 依赖: T020
  - 验收: T015、T016 的所有测试通过；500 节点图谱执行时间 < 3 秒

**Checkpoint**: US2 独立可测——可直接调用 `generateHtmlExport()` 生成 HTML，在浏览器验证交互功能，无需 CLI

---

## Phase 5: User Story 3 — CLI 命令集成（Priority: P2）

**目标**: 将 Obsidian 和 HTML 导出功能接入 `spectra` CLI，实现 `spectra export --format <obsidian|html> [--output-dir <dir>]` 命令，与现有命令风格一致

**独立测试**: 运行 `npx spectra export --format obsidian`，验证命令可被识别、参数解析正确、默认输出目录为 `_meta/export/`；运行 `spectra --help` 验证 `export` 子命令出现在帮助输出中

**注**: US3 依赖 US1 和 US2 的核心导出函数，在 Phase 3 和 Phase 4 完成后开始

### US3 测试任务（先写测试，确认失败后再实现）

- [x] T022 [P] [US3] 编写 CLI 命令测试 — 覆盖：graph.json 缺失时 graceful exit 并输出正确提示；`--format invalid` 时错误提示且退出码非零；空图（0 节点）时 graceful exit；`--output-dir` 未指定时默认值为 `_meta/export/`；community 数据缺失时降级单色方案
  - 涉及文件: `src/cli/commands/export.test.ts`
  - FR 追踪: FR-013、FR-014、FR-015

### US3 实现任务

- [x] T023 [US3] 修改 `src/cli/utils/parse-args.ts` — 在 `subcommand` 联合类型新增 `'export'`；在 `CLICommand` 接口新增 `exportFormat?: 'obsidian' | 'html'` 字段（与现有 `format` 并存避免语义冲突）；在参数解析逻辑中新增 `export` 分支，解析 `--format` 和 `--output-dir` 参数
  - 涉及文件: `src/cli/utils/parse-args.ts`
  - FR 追踪: FR-013、FR-014
  - 依赖: T022（测试先行）
  - 验收: `parseArgs(['export', '--format', 'obsidian'])` 返回 `{ subcommand: 'export', exportFormat: 'obsidian', outputDir: '_meta/export/' }`

- [x] T024 [US3] 实现 `src/cli/commands/export.ts` — `runExportCommand(command: CLICommand): Promise<void>`：校验 `exportFormat` 有效性（`obsidian` 或 `html`，否则 graceful exit）；读取 `_meta/graph.json`（不存在或空图则 graceful exit，输出提示先运行 `spectra graph`）；调用 `detectCommunities` 和 `findGodNodes` 重建社区数据（FR-016）；community 数据缺失时降级单色处理；路由到 `generateObsidianVault` 或 `generateHtmlExport`；输出成功信息（文件数、耗时）
  - 涉及文件: `src/cli/commands/export.ts`
  - FR 追踪: FR-013、FR-014、FR-015、FR-016
  - 依赖: T014（generateObsidianVault）、T021（generateHtmlExport）、T023（parse-args 先修改）
  - 验收: T022 的所有测试通过；`--format invalid` 退出码非零

- [x] T025 [US3] 修改 `src/cli/index.ts` — 新增 `import { runExportCommand } from './commands/export.js'`；在 `switch` 语句新增 `case 'export'`；在 `HELP_TEXT` 中新增 `export` 子命令说明（包含 `--format <obsidian|html>` 和 `--output-dir <dir>` 参数描述）
  - 涉及文件: `src/cli/index.ts`
  - FR 追踪: FR-013
  - 依赖: T024（export.ts 先实现）
  - 验收: `spectra --help` 输出包含 `export` 子命令说明；`spectra export --format obsidian` 可正常路由执行

**Checkpoint**: US3 完成后，`spectra export` 命令完全可用，三个 User Story 均独立可测

---

## Phase 6: Polish & Cross-Cutting Concerns（全面验收）

**目的**: 集成测试、边界场景验证、性能验收、文档补全

- [x] T026 [P] 编写 Obsidian 导出集成测试 — 使用真实 500 节点图谱 fixture：验证文件总数（1 + 社区数 + god node 数）；验证所有文件名无 `/ \ : * ? " < > |` 字符且长度 < 200；验证 `[[链接]]` 双向链接格式正确；验证执行时间 < 5 秒
  - 涉及文件: `src/panoramic/exporters/obsidian-exporter.test.ts`
  - FR 追踪: SC-001、SC-004、SC-005

- [x] T027 [P] 编写 HTML 导出集成测试 — 使用真实 500 节点图谱 fixture：验证单文件大小 < 2 MB；验证无外部 URL 引用（`http://` 或 `https://` 不出现在 HTML 中）；验证执行时间 < 3 秒；验证 HTML 包含 `D3_FORCE_BUNDLE` 版本注释
  - 涉及文件: `src/panoramic/exporters/html-exporter.test.ts`
  - FR 追踪: SC-002、FR-018

- [x] T028 [P] 编写边界场景集成测试 — 覆盖：空图（0 节点）两种格式均不生成文件；孤立节点图（有节点无边）正常导出，Obsidian 邻居列表含"无直接依赖关系"；含特殊字符节点 ID（`src/utils/helper`、`module:type?x`）的文件名符合规范
  - 涉及文件: `src/panoramic/exporters/obsidian-exporter.test.ts`、`src/panoramic/exporters/html-exporter.test.ts`
  - FR 追踪: SC-006、SC-007、FR-015

- [x] T029 执行全量测试 `npx vitest run` — 确认所有单元测试和集成测试零失败；记录测试覆盖情况
  - 涉及文件: 无新文件
  - 验收: 控制台输出零 FAILED

- [x] T030 执行 `npm run build` — 确认 TypeScript 编译（含 `prebuild` 执行 inline-d3）零错误；确认 strict + `noUncheckedIndexedAccess` 模式下无类型报错
  - 涉及文件: 无新文件
  - 验收: `npm run build` 零错误，`html-template.ts` 含有效 D3_FORCE_BUNDLE 常量

---

## FR 覆盖映射表

| FR | 描述（摘要） | 覆盖任务 |
|----|------------|---------|
| FR-001 | 生成 `index.md` 总览页 | T004、T011、T014 |
| FR-002 | 生成 `communities/community-{id}.md` | T012、T014 |
| FR-003 | 生成 `god-nodes/{node-name}.md` | T013、T014 |
| FR-004 | 使用 `[[filename]]` 双向链接格式 | T011、T012、T013 |
| FR-005 | `sanitizeFilename()` 完整规则 | T010、T008 |
| FR-006 | 单文件 HTML，大小 < 2 MB | T020、T021、T027 |
| FR-006a | `inline-d3.ts` 构建脚本 | T005、T006、T007 |
| FR-007 | 节点颜色/大小/边透明度 | T017、T019 |
| FR-008 | 搜索面板，模糊搜索高亮 | T006（html-template JS）、T020 |
| FR-009 | 节点点击侧栏详情 | T006（html-template JS）、T020 |
| FR-010 | 社区图例，点击切换显隐 | T006（html-template JS）、T020 |
| FR-011 | 缩放和拖拽 | T006（html-template JS）、T020 |
| FR-012 | 大图（> 5000 节点）网格布局降级 | T018、T019、T016 |
| FR-013 | `spectra export` 子命令 | T023、T024、T025 |
| FR-014 | `--output-dir` 默认 `_meta/export/` | T023、T024 |
| FR-015 | 数据缺失 / 空图 graceful exit | T024、T022 |
| FR-016 | 导出时重建社区归属映射 | T014、T019、T024 |
| FR-017 | 悬空边静默跳过 | T019 |
| FR-018 | HTML 产物记录 d3 版本号 | T005、T006 |
| FR-019 | 条件提取 sourceTarget/relatedFiles 双向链接 | T013、T009 |

**覆盖率**: 19/19 FR = **100%**

---

## 依赖关系与执行顺序

### Phase 依赖

```
Phase 1（Setup）
    ↓
Phase 2（Foundational）: T004 ~ T007
    ↓ ↓
Phase 3（US1）   Phase 4（US2）   ← 可并行（不同文件）
    ↓     ↓
    ↓   Phase 5（US3）            ← 依赖 US1 + US2 核心函数
            ↓
        Phase 6（Polish）
```

### User Story 间依赖

- **US1 和 US2**：完全独立，依赖 Phase 2，可并行实现
- **US3**：依赖 US1 的 `generateObsidianVault` 和 US2 的 `generateHtmlExport`，需在 Phase 3/4 之后
- **Phase 6**：需要 US1 + US2 + US3 全部完成

### Story 内部并行机会

- T008、T009 可并行（各自独立的测试文件）
- T011、T012、T013 中 T011 先行，T012 和 T013 可在 T011 完成后并行
- T015、T016 可并行（独立测试函数）
- T017、T018 可并行（独立工具函数）
- T026、T027、T028 可并行（独立集成测试场景）

---

## 实现策略

### MVP First（US1 优先验证）

1. 完成 Phase 1（Setup）
2. 完成 Phase 2（Foundational）— 必须先完成，阻塞后续
3. 完成 Phase 3（US1 Obsidian 导出）
4. **停止验证**：直接调用 `generateObsidianVault()` 检查 vault 产物，在 Obsidian 中打开确认链接正确
5. 继续 Phase 4（US2 HTML 导出）

### 增量交付顺序

1. Phase 1 + 2 → 基础设施就绪
2. Phase 3（US1）→ 独立测试 → Obsidian Vault MVP 可用
3. Phase 4（US2）→ 独立测试 → HTML 交互式可视化可用
4. Phase 5（US3）→ CLI 集成 → 两种格式可通过命令行触发
5. Phase 6（Polish）→ 全量验收

### 并行团队策略

- 开发者 A：Phase 2 T004 + Phase 3（US1）全部任务
- 开发者 B：Phase 2 T005/T006/T007 + Phase 4（US2）全部任务
- 两者合流后：Phase 5（US3）+ Phase 6（Polish）

---

## 注意事项

- `[P]` 标记的任务表示与同阶段其他任务无文件冲突，可并行执行
- `[US1]` / `[US2]` / `[US3]` 标记用于 FR 追踪和进度监控
- 所有测试任务必须在对应实现任务前执行，确认失败后再实现
- import 语句使用 `.js` 后缀（`module: "NodeNext"` 要求）
- `TypeScript strict` + `noUncheckedIndexedAccess: true` 在所有新文件中强制生效
- `obsidian-exporter.ts` 中的 FNV-1a 哈希为纯 JS 实现，不引入 `crypto` 模块
