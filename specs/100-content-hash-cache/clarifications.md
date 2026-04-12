---
type: clarifications
feature: 100-content-hash-cache
created: 2026-04-12
---

# 需求澄清：content-hash-cache

## Q1: `runProjectGenerator()` 执行失败时，manifest 应如何处理？

**问题**：spec 第 3.3 节拦截逻辑第 4 步写道"执行 runProjectGenerator → 成功后更新 manifest entry"，但 `batch-project-docs.ts` 实际对 generator 失败采用 try/catch 吞错（继续执行下一个），不会抛出异常中断循环。此时若 manifest 中已有该 generator 的旧 entry（上次成功缓存），失败后应：(a) 保留旧 entry 不变，(b) 主动删除旧 entry，还是 (c) 不作任何变更直至下次成功时覆盖？

**建议答案**：保留旧 entry 不变（选项 a）。原因：旧 entry 的输出文件依然存在，保留有助于下次 batch 仍能复用；主动删除会导致一次偶发失败破坏历次成功缓存，违反"最小副作用"原则。仅在本次执行"有新的成功输出"时才更新 entry。

**影响**：需在 `CacheManager.record()` 注释中明确"仅由执行成功的代码路径调用"，禁止在 catch 块中调用 `record()`。plan 阶段应在注入点描述中补充失败路径的分支说明。

**已编码**：是 — 本文件作为 plan 阶段前置约束记录。

---

## Q2: `configFiles` 字段为何从 cache key 排除，以及如何处理配置文件变更导致的缓存误命中？

**问题**：spec 第 3.1 节 cache key 排除了 `configFiles`（注释：Map 序列化不稳定），但 `configFiles` 是 `ProjectContext` 的核心字段（代码中为 `Map<string, string>` 类型），多个 generator（如 `config-reference-generator`）在 `extract()` 中实际读取这些配置文件内容。若配置文件路径或内容变化，cache key 不变，将导致误命中（stale 输出被复用）。

**建议答案**：对 `getDependencies()` 未实现的 generator，fallback 扫描策略（`projectRoot` 下所有源文件的聚合 hash）本身已能感知配置文件变更，可作为安全底网。对实现了 `getDependencies()` 的 generator，应将相关配置文件路径也纳入返回列表。因此排除 `configFiles` 本身可接受，但须在 `getDependencies()` 的 JSDoc 中明确要求实现者将依赖的配置文件路径也纳入返回集合。

**影响**：需在 `DocumentGenerator.getDependencies()` 可选方法的接口注释中补充说明："应包含 generator 在 `extract()` 中直接读取的所有配置文件路径，而不仅是源代码文件"。

**已编码**：是 — 接口注释约束已编码为本文件中的设计约束。

---

## Q3: `cache stats` 的 `totalSizeBytes` 计算的是 manifest 文件本身大小，还是所有 `inputFiles` 的 `size` 字段累加值？

**问题**：spec 第 3.4 节 `stats` 示例输出显示 `Total size: 4.2 MB`，但 `ManifestStats` 接口（第 5.2 节）仅定义了 `totalSizeBytes: number`，未说明该字段的语义。从用户视角看，"4.2 MB"更有可能是被缓存的输入源文件总大小（体现缓存覆盖范围），而非 manifest JSON 文件本身的磁盘占用（通常远小于此量级）。

**建议答案**：`totalSizeBytes` 为所有 `ManifestEntry.inputFiles[*].size` 字段的累加值，即被纳入缓存管理的输入源文件总字节数。manifest 文件本身大小不单独暴露（实际远小于源文件总量，信息价值有限）。

**影响**：`ManifestManager.stats()` 的实现需遍历所有 entry 的 `inputFiles` 数组累加 `size`；相应的 `stats()` JSDoc 需补充该语义说明。

**已编码**：是 — 语义约束已在本文件确立，plan 阶段按此实现。

---

## Q4: `cache stats` 和 `cache clear` 命令的 `outputDir` 如何确定？

**问题**：spec 第 3.4 节规定 `stats` 输出应展示 `manifest` 路径（`<outputDir>/_meta/_cache-manifest.json`），`clear` 命令需要定位 manifest 文件。但 `CLICommand` 当前结构（`parse-args.ts`）中 `outputDir` 是 `batch` 子命令的选项，`cache` 是新增子命令——用户在执行 `spectra cache stats` 时如何告知系统 `outputDir`？spec 未说明 `cache` 子命令是否也支持 `--output-dir` 参数，还是从配置文件读取，或使用约定默认值。

**建议答案**：`cache` 子命令接受可选 `--output-dir <dir>` 参数，语义与 `batch` 子命令一致；未传时 fallback 为 `process.cwd()/specs`（与 batch 默认输出目录保持一致）。`CLICommand` 中追加 `cacheOperation?: 'stats' | 'clear'` 和 `cacheGeneratorId?: string` 字段，`outputDir` 字段复用现有定义。

**影响**：`parse-args.ts` 需增加 `cache` 子命令解析分支，`CLICommand` 接口的 `subcommand` 联合类型追加 `'cache'`，并需处理 `--generator` 参数解析（供 `clear --generator <id>` 使用）。

**已编码**：是 — CLI 参数设计约束已在本文件确立。

---

## Q5: `.md` 文件 frontmatter 跳过的边界情况：无 frontmatter、frontmatter 未闭合、嵌套 `---` 时如何处理？

**问题**：spec 第 3.1 节规定"对 Markdown 文件只哈希 frontmatter 分隔符（`---`）之后的正文内容"，但未定义以下边界情况的行为：(a) 文件首行不以 `---` 开头（无 frontmatter），(b) 文件有开头 `---` 但无闭合 `---`（frontmatter 未闭合），(c) 正文中包含 `---` 分隔线（Markdown 水平规则）导致误判第二段为 frontmatter 结束。

**建议答案**：
- **(a) 无 frontmatter**：直接哈希全文内容（第一行不是 `---` 则视为无 frontmatter）。
- **(b) 未闭合 frontmatter**：哈希全文内容（降级为安全模式，避免漏掉正文变更）。
- **(c) 正文中 `---`**：frontmatter 解析仅处理文件开头到第一个闭合 `---` 之间的内容，找到后即停止，不继续扫描后续 `---`。实现方式：从第 2 行开始找下一个仅含 `---` 的行，找到即截止；若扫描超过前 50 行仍未找到，视为未闭合，fallback 哈希全文。

**影响**：`ContentHasher.hashFile()` 的实现需覆盖上述三个边界情况；验收标准 11 的测试用例应补充"无 frontmatter 的 `.md` 文件内容变化时正确触发缓存失效"这一反向验证。

**已编码**：是 — frontmatter 解析边界规则已在本文件确立为实现约束。
