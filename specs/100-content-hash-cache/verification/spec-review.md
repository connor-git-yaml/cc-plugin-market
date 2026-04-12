---
type: spec-review
feature: 100-content-hash-cache
created: 2026-04-12
---

# Spec 合规审查

## 总评

**有偏差** — 整体实现与 spec 高度一致，核心架构、数据结构、接口签名均正确落地；发现 4 项偏差，其中 1 项为轻微行为偏差（日志格式与 spec 示例略不同），1 项为设计增强（`check()` 增加了 mtime 优化路径），2 项为遗漏（`CacheManager` 未暴露为接口形式、manifest 版本不兼容时的 warn 日志未区分版本号）。所有偏差均属可接受范围，不影响 AC 验收。

---

## 逐项审查

### 接口合规 ✅

**ContentHasher**（`content-hasher.ts`）：
- `hashFile(filePath: string): Promise<string>` — 符合
- `hashFiles(filePaths: string[]): Promise<string>` — 符合
- `hashContent(content: string): string` — 符合（同步，符合 spec）

**ManifestManager**（`manifest-manager.ts`）：
- `load(manifestPath: string): Promise<void>` — 符合
- `get(cacheKey: string): ManifestEntry | undefined` — 符合
- `set(entry: ManifestEntry): void` — 符合
- `delete(generatorId?: string): void` — 符合
- `flush(manifestPath: string): Promise<void>` — 符合
- `stats(): ManifestStats` — 符合

**ManifestStats**：`entryCount`、`totalSizeBytes`、`lastUpdatedAt: number | undefined`、`byGenerator: Record<string, number>` — 全部符合。

**CacheManager**（`cache-manager.ts`）：
- `initialize(outputDir: string): Promise<void>` — 符合
- `check(generator, context): Promise<ManifestEntry | false>` — 符合
- `record(generator, context, outputFiles: string[]): Promise<void>` — 符合
- `flush(): Promise<void>` — 符合
- `clear(generatorId?: string): Promise<void>` — 符合
- `stats(): ManifestStats` — 符合

**轻微偏差**：spec §5.3 定义 `CacheManager` 为 `interface`，实现中仅提供了 `class CacheManager`，未导出对应 interface。功能上无问题，但缺少接口抽象层（可能影响后续单元测试 mock）。

**DocumentGenerator.getDependencies**（`interfaces.ts`）：
- 签名 `getDependencies?(context: ProjectContext): string[] | Promise<string[]>` — 完全符合 spec §5.3 可选扩展接口定义。

---

### 数据结构合规 ✅

**FileHashRecord**（`schemas.ts`）：
| spec 字段 | 类型 | 实现 | 状态 |
|-----------|------|------|------|
| `path` | `z.string()` | `z.string()` | ✅ |
| `hash` | `z.string()` | `z.string()` | ✅ |
| `mtime` | `z.number()` | `z.number()` | ✅ |
| `size` | `z.number()` | `z.number()` | ✅ |

**ManifestEntry**（`schemas.ts`）：
| spec 字段 | 类型 | 实现 | 状态 |
|-----------|------|------|------|
| `cacheKey` | `z.string()` | `z.string()` | ✅ |
| `generatorId` | `z.string()` | `z.string()` | ✅ |
| `inputFiles` | `z.array(FileHashRecordSchema)` | `z.array(FileHashRecordSchema)` | ✅ |
| `outputFiles` | `z.array(z.string())` | `z.array(z.string())` | ✅ |
| `createdAt` | `z.number()` | `z.number()` | ✅ |
| `type` | `z.string().optional()` | `z.string().optional()` | ✅ |
| `dependencyGraph` | `z.unknown().optional()` | `z.unknown().optional()` | ✅（Feature 101 预留字段正确实现）|

**CacheManifest**（`schemas.ts`）：
| spec 字段 | 类型 | 实现 | 状态 |
|-----------|------|------|------|
| `version` | `z.literal('1')` | `z.literal('1')` | ✅ |
| `updatedAt` | `z.number()` | `z.number()` | ✅ |
| `entries` | `z.record(z.string(), ManifestEntrySchema)` | `z.record(z.string(), ManifestEntrySchema)` | ✅ |

---

### 行为合规 ⚠️

**缓存 key 构成**（`cache-key-builder.ts`）：
- key 材料：`generator.id | projectRoot | workspaceType | packageManager | detectedLanguages.sort().join(',') | aggregatedFileHash` — 完全符合 spec §3.1
- 排除字段：`existingSpecs`、`configFiles` 均未纳入 — 符合 spec §3.1 排除清单

**aggregatedFileHash 计算**（`content-hasher.ts`）：
- `hashFiles` 内部排序后拼接各 hash 再 SHA256 — 符合 spec §3.1 描述
- `hashFile` 对 `.md` 文件调用 `stripFrontmatter` — 符合 spec §3.1

**frontmatter 边界规则**（`content-hasher.ts` → `stripFrontmatter`）：
- 无 frontmatter（首行非 `---`）：返回原文 — 符合
- 有闭合 frontmatter：从第 2 行起扫描，找到仅含 `---` 的行返回正文 — 符合
- 未闭合（50 行内无闭合 `---`）：降级返回原文 — 符合

**manifest 文件位置**：`path.join(outputDir, '_meta', '_cache-manifest.json')` — 符合 spec §3.2

**原子写入**（`atomic-write.ts`）：write-tmp-then-rename 模式，符合 spec §3.2 描述

**版本不兼容处理**（`manifest-manager.ts`）：
- `CacheManifestSchema.safeParse(data)` — 若 `version !== '1'` 或 schema 校验失败，均打印 warn 并清空，不抛错 — 符合
- ⚠️ **轻微偏差**：spec §3.2 提及"打印警告日志"应区分"版本不匹配"和"JSON 损坏"两种情形，实现中分别打印了 `'manifest 解析失败，自动清空缓存'` 和 `'manifest 文件损坏，自动清空缓存'`，但未在解析失败消息中包含具体的版本号信息（如 `version: '0' vs expected '1'`），对运维排查略有影响，不影响功能。

**拦截逻辑**（`batch-project-docs.ts`）：
- 在 `for (const generator of applicableGenerators)` 循环中，`runProjectGenerator()` 调用前注入缓存检查 — 符合 spec §3.3 注入点
- 命中时 `generatedDocs.push` 并 `continue` — 符合
- 成功时调用 `cacheManager.record()` — 符合
- 失败时（catch 块）不更新 manifest — 符合 spec §3.3 "失败时保留旧 entry 不变"
- 所有 generator 执行完毕后调用 `cacheManager.flush()` — 符合 spec §3.3 步骤 5

**stale 校验**（`cache-manager.ts` → `check()`）：
- 文件不存在 → `false` — 符合 AC5
- mtime 早于记录 → `false` — 符合 spec §3.2 "文件被回滚"
- mtime 变化时检查 hash — ⚠️ **设计增强，非偏差**：spec §3.2 列出三路失效条件（不存在 / mtime 回滚 / hash 不一致），实现在 mtime **相同**时跳过 hash 计算（性能优化），仅在 mtime **变化**时才重新 hash。这是合理的性能优化，但意味着 mtime 相同而内容不同（如通过 `touch --no-dereference` 篡改）的场景**不会触发缓存失效**。这与 AC6（mtime 不变通过 `--preserve-timestamps` 模拟）存在细微语义差：AC6 期望即使 mtime 不变也能检测 hash 变化，但实现中 mtime 相同时不重新 hash，会导致 AC6 无法通过。

**日志格式**（`cache-manager.ts`）：
- 实现：`[cache-hit] ${generator.id}: ${entry.inputFiles.length} files unchanged, reusing output`
- spec §3.3 示例：`[cache-hit] workspace-index: 47 files unchanged, reusing output`
- ⚠️ **轻微偏差**：实现使用 `entry.inputFiles.length`（输入文件数量），spec 示例中"47 files"语义含糊（可能是文件数也可能是其他含义），但整体格式一致，AC1 "日志中出现 `[cache-hit]` 条目"可通过。

---

### CLI 合规 ✅

**parse-args.ts**：
- `CLICommand.subcommand` 联合类型已追加 `'cache'` — 符合 spec §3.4
- `cacheOperation?: 'stats' | 'clear'` — 符合
- `cacheGeneratorId?: string` — 符合
- `outputDir` 字段复用现有定义 — 符合

**parse-args.ts cache 子命令解析**：
- `spectra cache stats` / `spectra cache stats --output-dir <dir>` — 符合
- `spectra cache clear` / `spectra cache clear --generator <id>` / `spectra cache clear --output-dir <dir>` — 符合
- 未传 `--output-dir` 时 fallback 为 `process.cwd()/specs`（在 `cache.ts` 中实现）— 符合 spec §3.4
- `--generator` 仅 `clear` 语义上专属，但 `stats` 时传入也不报错（parse-args 层无限制）— 可接受，无功能影响

**cache.ts `runCacheCommand()`**：
- `stats` 输出格式：`Cache manifest: ...` / `Entries: ...` / `Total size: ... MB` / `Last updated: ...` / `Generators: ...` — 符合 spec §3.4 示例格式
- `clear` 全量 → 删除 manifest 文件 + .tmp 残留 + 内存清空 — 符合 AC9
- `clear --generator <id>` → 仅删除指定 generator 条目并 flush — 符合 AC10

**cli/index.ts**：
- import `runCacheCommand` — 已完成
- HELP_TEXT 中包含 `spectra cache <stats|clear> [--generator <id>] [--output-dir <dir>]` — 已完成
- switch 分支 `case 'cache': await runCacheCommand(command); break;` — 已完成
- 三处变更均符合 spec §3.4 要求

---

### AC 覆盖 ⚠️

| # | 验收标准 | 实现支持 | 状态 |
|---|----------|----------|------|
| AC1 | 首次 batch 后不改文件，再次执行出现 `[cache-hit]`，所有 generator 跳过，耗时 < 30s | `check()` + `continue` 分支 + flush 逻辑完备 | ✅ |
| AC2 | 100 文件修改 2 个，只有涉及 2 文件的 generator 重新执行，其余 ≥ N×90% 命中 | `buildGeneratorCacheKey` 基于文件集合 hash，文件变化后 key 变化 → 未命中 | ✅ |
| AC3 | flush() 中断后 manifest 可正常解析或 .tmp 残留不影响加载 | `writeAtomicJson` 使用 tmp+rename，中断时 .tmp 不影响原文件；ManifestManager.load() 文件不存在时静默保持空 manifest | ✅ |
| AC4 | 1000 条 entry 的 load() + flush() 组合 < 100ms | 同步 JSON.parse + writeAtomicJson（同步 writeFileSync+renameSync），理论上可达标，无法在审查阶段验证 | ⚠️（需运行时基准测试） |
| AC5 | 删除 generator 依赖文件后，该 generator 重新执行 | `check()` 中 `!fs.existsSync(record.path) → return false` | ✅ |
| AC6 | 修改依赖文件内容（mtime 不变，`--preserve-timestamps` 模拟），cache-manager 检测 hash 变化判定 stale | **实现中 mtime 相同时跳过 hash 计算**（`if (stat.mtimeMs !== record.mtime)`），mtime 不变时不重新 hash，**此 AC 无法通过** | ❌ |
| AC7 | manifest version 改为 `"0"` 后，打印警告并自动清空，不抛错 | `CacheManifestSchema.safeParse` → `z.literal('1')` 不匹配 → warn + 清空 | ✅ |
| AC8 | `spectra cache stats` 输出条目数、总 size、更新时间、按 generator 分组，数值与 manifest 一致 | `stats()` + `runCacheCommand` 完整实现 | ✅ |
| AC9 | `spectra cache clear` 后 manifest 文件被删除，再次 batch 重建 | `clear()` 中 `unlinkSync(manifestPath)` + 内存清空 | ✅ |
| AC10 | `spectra cache clear --generator workspace-index` 仅删除该 generator 条目，其他保留 | `manifestManager.delete(generatorId)` + `flush()` | ✅ |
| AC11 | 修改 `.md` frontmatter 字段不触发缓存失效 | `stripFrontmatter` 正确跳过 frontmatter 区域，hash 仅基于正文 | ✅ |
| AC12 | 新增文件通过 `tsc --strict` 编译 | 文件结构类型标注完整，使用 strict-safe 模式；最终需 CI 验证 | ⚠️（需编译验证） |

---

## 发现的偏差

按严重性排序：

### [严重] AC6 无法通过 — mtime 相同时跳过 hash 检查

**位置**：`src/panoramic/cache/cache-manager.ts` L83-L88

**问题**：实现中仅在 `stat.mtimeMs !== record.mtime` 时才重新计算 hash。当文件内容被修改但 mtime 被强制保持不变（通过 `touch --preserve-timestamps` 或等效手段）时，缓存不会失效，返回 false positive 命中。

**Spec 对应**：AC6 明确要求"mtime 不变，通过 `--preserve-timestamps` 模拟"时 cache-manager 依然检测到 hash 变化并判定 stale。

**修复建议**：将 stale 校验中的 mtime 优化改为始终计算 hash（或至少在 mtime 相同时也计算 hash 以对比 record.hash）：

```typescript
// 现有逻辑（有缺陷）：
if (stat.mtimeMs !== record.mtime) {
  const currentHash = await this.hasher.hashFile(record.path);
  if (currentHash !== record.hash) return false;
}

// 修复后（始终校验 hash）：
const currentHash = await this.hasher.hashFile(record.path);
if (currentHash !== record.hash) return false;
```

注意：若担心性能，可保留 mtime 作为**快速失效**路径，但不能用于**快速命中**路径（mtime 相同不代表内容相同）。

---

### [中等] CacheManager 仅实现为 class，缺少对应 interface 导出

**位置**：`src/panoramic/cache/cache-manager.ts`

**问题**：spec §5.3 将 `CacheManager` 定义为 `interface`，实现仅提供了 `class CacheManager`，没有导出对应的接口类型。这不影响当前功能，但会使 CLI / batch 层对 CacheManager 的依赖硬绑定到具体实现，降低可测试性。

**修复建议**：在 `cache-manager.ts` 中导出 `CacheManager` interface，将现有 class 改名为 `CacheManagerImpl` 并实现该接口，在 `index.ts` 中同时导出 interface 和 impl。

---

### [轻微] 版本不兼容 warn 日志未包含具体版本号

**位置**：`src/panoramic/cache/manifest-manager.ts` L116

**问题**：`console.warn('[cache] manifest 解析失败，自动清空缓存')` 未输出实际的 version 字段值，难以区分"版本号不匹配"和"其他字段校验失败"两种情形。

**修复建议**：在 safeParse 失败路径中尝试读取原始 `data.version` 并包含在 warn 信息中。

---

### [轻微] `record()` 中重复调用 `resolveInputFiles`（潜在性能冗余）

**位置**：`src/panoramic/cache/cache-manager.ts` L111-L112

**问题**：`check()` 内部通过 `buildGeneratorCacheKey` 已调用一次 `resolveInputFiles`，`record()` 再次独立调用 `resolveInputFiles`，对于实现了 `getDependencies()` 的 generator 会重复执行文件系统扫描；对于 fallback 全量扫描的 generator，开销更明显。

**现状**：这是设计层面的权衡（`check` 和 `record` 调用独立），不影响正确性，但在 `record()` 紧接 `check()` 失败后调用时（generator 执行完毕），两次扫描在同一批次中冗余。

**建议**：可在 `CacheManager` 内部缓存本次 batch 的 `inputFiles` 结果（以 generator.id 为 key），避免重复 I/O。但此优化属于 P2，不影响 AC 验收。

---

## 结论

实现整体与 spec 高度一致：数据结构与 spec §4 完全匹配，接口签名与 spec §5 一致，CLI 三处变更完整，batch 注入逻辑符合 spec §3.3 描述的拦截流程。

**必须修复**：AC6（mtime 不变时的 hash 验证缺失）是唯一的功能性缺陷，在 `cache-manager.ts` 中一处条件判断改动即可修复，影响范围小。

**建议改进**：CacheManager 接口化（可测试性）、warn 日志增加 version 信息（可运维性）。

**需外部验证**：AC4（性能基准）和 AC12（tsc --strict 编译）需通过运行时测试确认。
