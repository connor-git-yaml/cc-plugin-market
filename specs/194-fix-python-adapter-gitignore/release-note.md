# F194 Release Note — 源文件扫描接入 .gitignore 规则

## 修复内容摘要

三处自写文件扫描 walk 此前不解析项目 `.gitignore`，仅按硬编码目录集 + 点前缀剪枝：

| 路径 | 位置 | 影响面 |
|------|------|--------|
| `scanPyFiles` | src/adapters/python-adapter.ts | Python module graph + 符号提取（F145 起） |
| `walkPyFiles` | src/batch/batch-orchestrator.ts | Python CodeSkeleton 收集 → UnifiedGraph / graph.json（F151 起） |
| `walkTsJsFiles` | src/batch/batch-orchestrator.ts | TS/JS CodeSkeleton 收集 → UnifiedGraph / graph.json（F152 起） |

本次修复让三处 walk 叠加接入与 `src/utils/file-scanner.ts` 同源的 `.gitignore` 规则（新导出 `createGitignoreFilter` 单一事实源）：目录命中剪枝、文件命中跳过。各 walk 原有硬编码忽略集与点前缀剪枝**保持不变**（只叠加不替换，文件集单调收紧）。

来源：F182 Codex Phase 3 对抗审查 C1 项（定级 CRITICAL 的上游既有缺陷，独立成 fix）。

## 影响范围

- **受影响**：项目 `.gitignore` 匹配到 `.py` / `.pyi` / `.ts` / `.tsx` / `.js` / `.jsx` 源文件的项目（如 `generated/` 产物目录、`local_*.py` 本地脚本）
- **不受影响**：gitignore 排除项已被硬编码集覆盖的项目（`__pycache__` / `node_modules` / `venv` / `dist` 等）——文件集零变化

## 升级后预期行为

1. **含 gitignored .py 的 Python 项目**：module graph 与增量 skeletonHash 口径收紧 → **首轮 batch 触发全量重生成，属预期行为，无数据丢失**；此前这类项目因读侧（scanPyFiles）/ 写侧（scanFiles）文件集分叉，增量缓存永久 miss——修复后口径统一，增量恢复正常
2. **UnifiedGraph（graph.json）口径同步收紧**：gitignored 源文件不再出现在知识图谱节点 / callSites / import 边中，`graph_query` / `impact` 等 MCP 工具结果相应变化
3. 与 F182（增量缓存正确性，分支待合入）兼容：本修复在 F182 合入前（消除读写分叉）与合入后（写读统一 group.files、内容同步净化）均为正确行为

## baseline 验证结论

micrograd / nanoGPT（全 Python baseline）fix 前后**全口径零差异**（module graph / 符号提取 / skeleton 收集，实测 diff 见 verification/baseline-diff-results.md）→ **baseline fixture 无需重采集**；self-dogfood（本仓 TS）无任何文件被新过滤层移除。

## 已知限制

- **Windows 平台**：gitignore 匹配沿用 file-scanner 现有实现（`/` 分隔正则 + raw `path.relative`），Windows 反斜杠路径下过滤可能不生效——此为 file-scanner 存量限制（非本 fix 新增），且为安全降级（不生效 = 回到修复前行为，不会错杀文件）。跨平台 sep 归一化已登记后续候选

## 不在本 fix 范围

- `scanTestFiles`（single-spec-orchestrator）自写 walk：仅供 spec 文本测试统计，不进 graph/hash 口径，登记后续候选
- 三处 walk 的扩展名集合与硬编码忽略集差异（如 walkPyFiles 收 .pyi 而 scanPyFiles 不收）：维持现状，避免行为变更扩面
- repo 根部同名异语言文件 per-file spec 命名碰撞：依赖 F182 的 outputFileName 机制，留待 F182 合入 master 后另议
