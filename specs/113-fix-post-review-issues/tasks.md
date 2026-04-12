# 任务列表 — Fix 113

## T1: hook-installer.ts 路径修正
- [ ] 修正 GRAPH_FILE 为 "specs/_meta/graph.json"
- [ ] 修正 REPORT_FILE 为 "specs/_meta/GRAPH_REPORT.md"
- [ ] 修正 L85 echo 提示文本
- [ ] 修正 L149 console.log 路径提示

## T2: graph-builder.ts 写入 degree 到节点 metadata
- [ ] 定位 writeKnowledgeGraph / buildKnowledgeGraph 入口
- [ ] 找到 godNodes 在调用链中的位置（detectCommunities 后）
- [ ] 在写入 GraphJSON 前补写每个 god node 的 degree 到 metadata

## T3: openapi-extractor.ts AsyncAPI service 节点
- [ ] 在 parseAsyncApiDocument 中添加 service 节点创建逻辑
- [ ] service 节点 ID 为 service:${relativeSourceFile}，label 为 basename
- [ ] 确保节点去重（一个文件只创建一个 service 节点）

## T4: openapi-extractor.ts YAML 数组解析
- [ ] parseYamlBlock 中添加 `- item` 行的处理逻辑
- [ ] 数组 item 累积到对应 key 的数组中

## T5: image-extractor.ts depicts 边修正
- [ ] 删除 depicts 边生成逻辑（source: diagram nodeId, target: component:X）
- [ ] 将 components 数组保留在 diagram 节点的 metadata 中（已有字段）

## T6: obsidian-exporter.ts community 页面纯文本节点
- [ ] buildCommunityPage 核心节点（Top 3）改为纯文本 `- {label}`
- [ ] buildCommunityPage 所有节点列表改为纯文本 `- {label}`
- [ ] 更新 obsidian-exporter.test.ts 中对应测试断言

## T7: batch-orchestrator.ts 版本号从 package.json 读取
- [ ] 在 runBatch 函数中用 fs/createRequire 读取 package.json version
- [ ] 替换 L738 hardcoded '2.9.0'

## T8: graph-query.ts cohesion 路径修正
- [ ] L573 路径改为 join(process.cwd(), 'specs', '_meta', 'GRAPH_REPORT.md')
- [ ] L586 错误提示文本同步修正

## T9: watch.ts 外部 batch 事件队列
- [ ] L124-127 return 前先将 events 加入 pendingNextRound

## T10: watch.ts 透传 includeDocs/includeImages
- [ ] executeBatchLoop 签名新增 includeDocs/includeImages 参数
- [ ] L186 runBatch 调用新增这两个参数
- [ ] handleChange 调用处从 merged 透传

## T11: project-config.ts 添加 includeDocs/includeImages
- [ ] ProjectConfig 接口新增两个 boolean 字段
- [ ] validateConfig 中添加解析逻辑

## T12: export.ts process.exit 统一
- [ ] 5 处 process.exit(1) 改为 process.exitCode = 1; return;
- [ ] 默认输出目录改为 specs/_meta/export

## T13: community.ts process.exit 统一
- [ ] 4 处 process.exit(1) 改为 process.exitCode = 1; return;

## T14: graph.ts process.exit 统一
- [ ] 1 处 process.exit(1) 改为 process.exitCode = 1; return;

## T15: 运行构建 + 测试
- [ ] npm run build 零错误
- [ ] npx vitest run 零失败
