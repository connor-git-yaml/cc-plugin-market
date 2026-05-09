# Feature 156 — Code Quality Review

## 1. 架构与设计

**评分：5/5**

模块边界清晰：persistence（存储层）、incremental（算法层）、module-derivation（视图派生层）、import-resolver（路径解析工具）职责单一，无跨层反向依赖。CLI 层（commands/index.ts）只调 incremental 不直接访问 persistence，层次干净。FR-31"禁止读取全局 cache"约束在 incremental 和 module-derivation 两处均以注释标注并实现正确。`runFullReindex` 内聚在 incremental 模块避免 cli ↔ incremental 循环依赖——设计决策合理。

改进建议：无。

## 2. 错误处理

**评分：4/5**

所有降级路径（no-snapshot / shallow-clone / corruption / no-diff）均有明确的 fallbackReason 枚举，调用方不需要猜原因。`saveSnapshot` 失败触发 full re-index 而非抛出—符合 post-commit hook 场景的非阻断要求。`analyzeFile` 单文件失败不阻断整体（与 batch-orchestrator 策略一致）。

**WARNING**：`runFullReindex`（incremental.ts:519）内部 catch 块是空的（无日志输出），单文件失败静默吞掉，不如增量路径一样输出 stderr 警告，调试时较难排查。

## 3. 类型安全

**评分：4/5**

全量代码未发现 `as any` 或 `: any`。Zod schema（SnapshotWrapperSchema / ModuleGraphSchema）与类型定义对齐，merge 后 safeParse 验证避免坏数据写盘。

**INFO**：`resolveImportsForFile`（import-resolver.ts:354）处有一处 `(imp as ImportReference & { importType?: ImportType }).importType` 类型断言，是因为 `ImportReference` 的 `importType` 字段声明为 optional 但 TypeScript 不自动推断——可通过在 `ImportReferenceSchema` 正式加字段消除此断言。

`computeAllFileHashes` 签名有一个 `_projectRoot` 未使用参数（persistence.ts:88）——接口冗余，应删除或标注"预留"。

## 4. 测试质量

**评分：4/5**

新增 81 个测试，覆盖 expandCallers depth=1/2 BFS、mergeIncremental 三态、gitDiff 命令注入 / shallow clone 降级、persistence 原子写 / load-corruption 等关键路径。fixture 用工厂函数而非文件——合理。

**WARNING**：`detectStaleFiles` 在 persistence.ts 导出但 incremental.ts / CLI 均未调用，属于"已实现但未集成"的死代码——其对应测试虽然有，但函数当前没有生产调用路径，等于测试了一个未被使用的接口。

## 5. 简洁之道

**评分：4/5**

函数基本单一职责，`buildIncremental` 最长（约 100 行有效逻辑），但通过明确的步骤注释分段清晰可读。提前 return（空 diff 短路、降级短路）减少嵌套。`import-resolver.ts` 中 `tryFilePathVariants` / `existsAndIsFile` / `existsAndIsDir` 分离得干净。

**INFO**：`module-derivation.ts` 中 `buildModuleGraphForProject` 函数约 110 行，扫描 + tsconfig 解析 + AST 解析 + UnifiedGraph 推导四段逻辑可拆分为子函数增加可测性，目前集成测试少。

## 6. 安全性

**评分：5/5**

gitDiff 的命令注入风险（W3 WARN-2）已用 `execFileSync` + `spawnSync` 数组参数 + `parseGitRange` 白名单三重加固，无 shell=true 字符串拼接。post-commit.sh 中 ORIG_HEAD HEAD 写死为字面量参数，无外部注入面。无硬编码 credentials。

## 7. 性能

**评分：4/5**

`expandCallers` 算法为 O(depth × nodes + depth × edges)，depth=1 场景近似 O(edges)，合理。`mergeIncremental` 先建 Set 再 filter 为两次线性扫描，O(nodes + edges)，合理。

**WARNING**：`computeAllFileHashes` 串行读取所有文件（persistence.ts:92），对大项目（数千文件）全量索引时 IO 串行是性能瓶颈。注释说"clarify Q-D4 并行收益有限"，但对 500+ 文件项目建议重新评估或加并发上限（如 `Promise.all` with p-limit）。

## 8. 主要发现

**优点：**
1. 命令注入防护完整：parseGitRange 白名单 + spawnSync 数组参数，安全措施层次分明
2. fallback 决策树清晰：4 种降级原因枚举，机器可读 JSON 进度输出方便上游脚本
3. 原子写入保证 snapshot 完整性（pid + random hex tmp + POSIX rename）
4. 模块职责划分符合 plan.md 架构边界，无循环依赖
5. Zod schema 在 merge 出口处做 safeParse 守卫，防止坏 snapshot 写盘

**问题：**
- **WARNING**：`detectStaleFiles` 导出后未被任何生产代码调用（persistence.ts:215），是未集成的死接口，应删除或在 CLI 中接入
- **WARNING**：`runFullReindex` 内部空 catch（incremental.ts:524），单文件分析失败静默吞掉，增量路径有日志但全量降级路径无，不一致
- **WARNING**：`computeAllFileHashes` 串行 IO，大项目全量索引时是性能瓶颈
- **INFO**：`ImportReference` 类型断言可通过正式扩展 schema 消除
- **INFO**：`_projectRoot` 未使用参数冗余，混淆接口语义

## 9. 总体评估

**质量评分：30/35**

**是否可以交付 master？yes-with-conditions**

**必修项（建议交付前修复）：**
1. 删除或集成 `detectStaleFiles`——当前是已测试但无生产调用路径的死接口，会误导维护者
2. `runFullReindex` 的 catch 块补充 stderr 日志（与增量路径保持一致）

其余 WARNING / INFO 可在后续 PR 修复，不阻断本次交付。
