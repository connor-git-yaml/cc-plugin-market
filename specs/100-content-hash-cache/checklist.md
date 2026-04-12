---
type: quality-checklist
feature: 100-content-hash-cache
created: 2026-04-12
---

# 质量检查：content-hash-cache

## 总评

设计整体完善、自洽，技术选型与代码库实际结构高度吻合，可以条件通过；有 3 处需在实施前确认或补充的细节，2 处轻微不一致需修订。

---

## 维度评估

### 完整性 ✅

核心能力全部覆盖：哈希引擎（第 3.1 节）、manifest 持久化（3.2）、generator 级拦截逻辑（3.3）、CLI 子命令（3.4）、数据结构（第 4 节）、接口契约（第 5 节）、性能指标（第 6 节）、系统关系（第 7 节）、目录结构（第 8 节）、验收标准（第 9 节）、约束与风险（第 10 节）、未来扩展（第 11 节）。

以下一处有细节缺口：

- `runProjectGenerator()` 函数签名中是否返回了"输出文件路径列表（outputFiles）"尚未确认。spec 第 3.3 节假设 `runProjectGenerator()` 执行成功后能提供输出文件列表以供 `CacheManager.record()` 使用，但对照 `batch-project-docs.ts` 的实际实现，`runProjectGenerator()` 的返回值结构（`GeneratedProjectDocResult`）只包含 `writtenFiles`，与 spec 的接口文字一致，但 spec 未明确说明这一来源映射关系。建议在第 3.3 节注明 `outputFiles` 来自 `generatedDoc.writtenFiles`，避免实施者歧义。

### 一致性 ⚠️

存在 2 处轻微不一致，需在 spec 中修正：

**不一致 1：CLI 子命令名称冲突**

spec 第 3.4 节"子命令设计"定义的子命令为 `stats` 和 `clear`，而 tech-research（第 4 节"cache 子命令规划操作"）建议的是 `status`、`clear`、`manifest` 三个操作。spec 正文已明确选择 `stats`（不是 `status`），且验收标准第 8 条也使用 `spectra cache stats`，内部自洽；但与 tech-research 的建议操作名 `status` 和 `manifest`（spec 正文未提供 `manifest` 子命令）存在分歧。若 `manifest` 操作属于 P2 延迟实现，应在 spec 第 3.4 节"非目标"或"未来扩展"中明确说明。

**不一致 2：`configFiles` 字段排除说明**

spec 第 10.2 节风险表中提到 `configFiles`（Map 序列化不稳定）被排除在 cache key 之外，但第 3.1 节 cache key 构成列表中并未出现 `configFiles`，两处字段处理逻辑一致，但风险表的说明位置导致读者需跨节拼凑完整排除清单。建议在第 3.1 节的 cache key 构成说明后补充一行"不包含字段"清单，与第 10.2 节的风险说明形成对应。

### 可测试性 ✅

验收标准 12 条全部满足"具体、可量化、可复现"的要求：

- 条目 1-2：时间和命中率均有数字阈值（< 30 秒，≥ 90%）
- 条目 3：原子性测试手段明确（强制中断进程后重启验证）
- 条目 4：性能基准有明确场景（1000 条 entry，< 100ms）
- 条目 5-6：缓存失效场景的复现步骤清晰，条目 6 特别提到 `--preserve-timestamps` 模拟 mtime 不变的边界情况
- 条目 7：版本兼容测试步骤手动可操作
- 条目 8-10：CLI 输出内容和文件状态可断言
- 条目 11：frontmatter 跳过测试步骤明确
- 条目 12：tsc 编译测试可自动化

唯一细节：条目 2 的"整体命中率 ≥ 90%"依赖 generator 数量和文件分布，建议在执行测试时注明测试所用的 generator 数量（如"10 个 generator 中有 9 个命中"），使数字可复现。

### 可实现性 ✅

设计与实际代码库高度吻合，逐项验证：

- **注入点**：`batch-project-docs.ts` L87-107 的 `for...of` 循环结构与 spec 第 3.3 节描述完全一致，注入方式可行。
- **原子写入**：`checkpoint.ts` L45-60 实现了与 spec 第 3.2 节相同的 write-tmp-then-rename 模式，提取为 `writeAtomicJson()` 无障碍。
- **接口扩展**：`DocumentGenerator` 接口当前有四段生命周期方法，追加可选 `getDependencies?()` 不影响现有实现（TypeScript 可选方法，向后兼容）。
- **CLI 注册**：tech-research 已识别 `parse-args.ts` + `commands/cache.ts` + `index.ts` 三处变更点，模式与现有 `panoramic` 子命令一致。
- **Zod + strict**：代码库全面使用 Zod，新 schema 可无缝集成。
- **外部依赖**：纯 Node.js 标准库，零外部依赖，无引入风险。

一处需要确认：spec 第 8 节目录结构将 `atomic-write.ts` 放在 `src/utils/`，但当前 `src/utils/` 目录下只有 `chunk-splitter.ts`、`file-scanner.ts`、`specify-template-sync.ts`，无通用工具文件先例。tech-research 也提到可选 `src/batch/atomic-writer.ts`。两个路径均可行，但 spec 与 tech-research 给出了不同建议，实施前需统一。

### 向前兼容 ✅

Feature 101（graph-persistence）预留到位：

- `ManifestEntry` 包含 `dependencyGraph?: unknown` 可选字段（第 4.1 节）
- manifest `version` 字段设计了 v1 → v2 迁移路径（第 11 节），说明了具体升级时机和 load 时的补填策略
- `CacheManager.initialize()` 对 `outputDir` 来源无硬编码，Feature 102 配置路径变更时可透明适配（第 11 节）
- 注入点 B（模块级 Spec 生成缓存）已列为独立后续 Feature，不混入当前实现范围，边界清晰

### 风险覆盖 ✅

风险表（第 10.2 节）覆盖了 tech-research 识别的全部 7 类风险，且每条都有对应缓解措施：

| 风险 | spec 中的缓解 | 评价 |
|------|------------|------|
| 哈希粒度不一致 | 文档化两层差异，解耦 cache key | 措施充分 |
| generator 读取未声明依赖 | `getDependencies?()` + fallback 全扫描 | 措施充分，短/长期策略分层 |
| ProjectContext 易变字段 | 明确排除 `existingSpecs`、`configFiles` | 措施充分 |
| 并发写入 manifest | 原子写入 + 文档约束当前串行 | 措施合理（低优先级） |
| 旧版 manifest 兼容性 | `version` 校验 + 自动清空 | 措施充分 |
| cache CLI 与 batch 并发 | 文档约束 | 措施轻，但当前场景下风险确实低 |

tech-research 第 7.1 节额外提出"建议新缓存与 delta 使用相同的 skeleton hash 机制"，spec 选择了不同方向（内容哈希而非 AST skeleton hash），并在第 10.2 节风险说明中给出了合理理由（两者粒度和目的不同）。这是有意识的技术取舍，非遗漏。

---

## 建议改进项

1. **补充 `outputFiles` 来源映射**（第 3.3 节）：在拦截逻辑伪代码之后或 `CacheManager.record()` 说明中注明，`outputFiles` 参数来自 `runProjectGenerator()` 返回的 `generatedDoc.writtenFiles`，避免实施时歧义。

2. **统一 `atomic-write.ts` 路径**（第 8 节目录结构）：spec 写的是 `src/utils/atomic-write.ts`，tech-research 建议 `src/batch/atomic-writer.ts`。鉴于该函数是通用工具（不只服务 batch），建议在 spec 中保留 `src/utils/atomic-write.ts` 并删除歧义，同时在第 7.2 节的"复用模式"说明中显式标注最终路径。

3. **明确 `manifest` 子命令是否纳入 Feature 100 范围**（第 3.4 节）：tech-research 建议了 `manifest` 子操作（输出 manifest JSON），spec 未提及。若属于 P2 延迟，在第 2.2 节"非目标"中补充一行说明；若属于 P0-P1 范围，在第 3.4 节补充子命令定义和对应验收标准。

4. **第 3.1 节补充"不包含字段"清单**：在 cache key 构成描述后增加明确的"排除字段"列表（`existingSpecs`、`configFiles`），与第 10.2 节风险说明形成呼应，避免读者跨节拼凑。

5. **验收条目 2 的可复现性**：在第 9 节条目 2 中补充测试前提说明，如"假设有 N 个 applicableGenerators，期望其中 ≥ N×90% 个输出 `[cache-hit]`"，使命中率断言具有明确的分母。

---

## 结论

**条件通过**

spec 设计成熟，与代码库实际结构对齐良好，风险识别完整，接口设计自洽。改进项 1-2（路径和参数来源）属于低风险文本修订，改进项 3（`manifest` 子命令范围）需 PM/负责人确认后填入。可在修订上述 5 处文本后直接进入 plan 阶段。
