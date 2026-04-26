# Graphify Mini — 架构文档

## Full Ingestion Pipeline

完整管线由 5 个阶段串联，是 Graphify 的核心数据流：

1. **`ingest_files`** 在 `ingestion.py` 中扫描原始文本文件并产出 `Document` 流
2. **`parse_document`** 在 `parser.py` 中从 `Document.text` 抽取 `Entity` 列表
3. **`extract_relations`** 在 `parser.py` 中根据相邻 entity 组装 `Relation`
4. **`GraphStore.add_entity` / `add_relation`** 在 `store.py` 中将 entity / relation 写入内存图
5. **`find_path`** 在 `query.py` 中对 `GraphStore` 跑 BFS，给出实体间路径

整条 pipeline 的设计 rationale 是「让 raw text → 知识图谱 → 可查询路径」三跳之间通过 dataclass 解耦，每一层只依赖下一层的输入类型。

## 共享数据结构

`utils.py` 定义 3 个 dataclass：`Document` / `Entity` / `Relation`。这是层间合同，
任何阶段升级都不应该悄悄修改字段，否则会破坏 `parse_document` 与 `GraphStore` 的契约。

## BFS 决策

`find_path` 选择 BFS 而非 DFS 的原因：
- BFS 给出的是层级最浅的路径（边数最少），适合"两个实体之间最短关联"这一典型查询
- BFS 支持自然的深度截断（`max_depth`），DFS 截断时容易漏掉浅层解
- 内存图典型规模 < 100k 节点，BFS 的 O(V+E) 队列开销可控

## 边界与未来工作

- 当前 `parse_document` 只识别 `ENTITY:` 前缀的简单格式，未来会接入更精细的 NER
- `GraphStore` 是 in-memory，重启即丢；持久化到 SQLite / DuckDB 是 P2 工作
- `find_path` 没有 confidence 评分，所有边等权——未来要按 relation kind 做加权
