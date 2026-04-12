# 修复规划 — Fix 113：M-100 评审后真实问题批量修复

## 修复原则
- 最小化变更范围：每处修复只改动必要代码
- 不改变对外行为契约：API 签名、配置文件格式保持兼容
- 每处修复附带对应单元测试

## 变更清单（按文件）

### 1. src/hooks/hook-installer.ts
**变更**：
- L43: `GRAPH_FILE="_meta/graph.json"` → `GRAPH_FILE="specs/_meta/graph.json"`
- L44: `REPORT_FILE="_meta/GRAPH_REPORT.md"` → `REPORT_FILE="specs/_meta/GRAPH_REPORT.md"`
- L85: echo 信息同步修正（提示用户看 specs/_meta/GRAPH_REPORT.md）
- L149: console.log 路径提示同步修正
- degree filter（L74）不需要单独修复，由 graph-builder 补写 degree 后自动有效

### 2. src/panoramic/graph/graph-builder.ts
**变更**：
- 在 `writeKnowledgeGraph` 写入 GraphJSON 前，遍历 GodNode 列表，
  将每个 god node 的 degree 写入对应节点的 metadata
- 需要在函数签名中接收 godNodes（或在内部从已有数据计算）
- 检查 buildKnowledgeGraph 调用链：godNodes 已在 detectCommunities 后计算

### 3. src/extraction/openapi-extractor.ts
**变更 A（AsyncAPI service 节点）**：
- 在 `parseAsyncApiDocument` 中，遍历 channels 时同步创建 `service:${relativeSourceFile}` 节点
- 节点 label 为文件的 basename（不含扩展名），type 为 'service'

**变更 B（YAML 数组解析）**：
- `parseYamlBlock` 中添加对 `- item` 格式行的解析
- 已有的 key:value 解析保持不变
- 数组值作为字段的数组值返回

### 4. src/extraction/image-extractor.ts
**变更**：
- depicts 边的 target 改为 `diagram:${nodeId}`（即 diagram 节点自身），去掉 `component:${component}` 这条路径
- 或者：depicts 边不生成（更简单），diagram 节点通过 Vision API 解析的 components 字段作为 metadata 保存
- **选择**：删除 depicts 边（方案 B 变种），将 components 保留在 diagram 节点 metadata 中

### 5. src/panoramic/exporters/obsidian-exporter.ts
**变更**：
- `buildCommunityPage` 中节点列表改为纯文本（去掉 [[wikilink]] 包裹）
- 只有 god-node 页面在 index.md 中保留 [[wikilink]]
- community 核心节点（Top 3）和全节点列表改为：`- {label}` 纯文本

### 6. src/batch/batch-orchestrator.ts
**变更**：
- L738: 在函数顶部 import 或用 fs.readFileSync 读取 package.json，提取 version 字段
- 用读取到的 version 替换硬编码的 '2.9.0'

### 7. src/panoramic/graph/graph-query.ts
**变更**：
- L573: 将路径修正为 `join(process.cwd(), 'specs', '_meta', 'GRAPH_REPORT.md')`
- L586: 同步修正错误提示信息

### 8. src/cli/commands/watch.ts
**变更 A（外部 batch 不丢事件）**：
- L124-127: 在 return 前先将 events 加入 pendingNextRound

**变更 B（透传 includeDocs/includeImages）**：
- `executeBatchLoop` 函数签名新增 `includeDocs?: boolean` 和 `includeImages?: boolean`
- L186: runBatch 调用新增这两个参数
- handleChange 调用 executeBatchLoop 时从 merged 透传

### 9. src/config/project-config.ts
**变更**：
- `ProjectConfig` 接口新增 `includeDocs?: boolean` 和 `includeImages?: boolean`
- `validateConfig` 中添加对这两个 boolean 字段的解析
- 向后兼容（缺失时为 undefined）

### 10. src/cli/commands/export.ts
**变更**：
- 5 处 `process.exit(1)` 改为 `process.exitCode = 1; return;`
- L73: 默认输出目录 `path.join(cwd, '_meta', 'export')` → `path.join(cwd, 'specs', '_meta', 'export')`

### 11. src/cli/commands/community.ts
**变更**：
- 4 处 `process.exit(1)` 改为 `process.exitCode = 1; return;`

### 12. src/cli/commands/graph.ts
**变更**：
- 1 处 `process.exit(1)` 改为 `process.exitCode = 1; return;`

## 回归风险评估
- **低风险**：路径修正（影响范围明确，只改常量字符串）
- **低风险**：process.exitCode 替换（语义等价，仅影响测试中 mocked process）
- **中风险**：Obsidian wikilink 改为纯文本（改变了 community 页面输出，需更新相关测试）
- **中风险**：graph-builder degree 写入（需确认调用链上 godNodes 可用时机）
- **低风险**：AsyncAPI service 节点创建（新增节点，不移除任何现有节点）
- **低风险**：image depicts 边删除（减少错误数据，无业务回归）
