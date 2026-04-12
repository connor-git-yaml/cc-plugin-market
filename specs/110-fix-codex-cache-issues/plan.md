# 修复规划

## 修复目标

修复 Codex 审查发现的 3 个 HIGH 级别问题，确保缓存系统在生产场景下行为正确。

## 变更范围（最小化）

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/cli/commands/cache.ts` | 默认值修正 | outputDir 默认改为 `specs/project`（引用 `BATCH_OUTPUT_SUBDIRS.PROJECT`） |
| `src/panoramic/batch-project-docs.ts` | 新增常量 + 逻辑 | 定义 `CACHE_SKIP_GENERATOR_IDS`，在 cache check 前短路 upstream generators |
| `src/panoramic/cache/cache-key-builder.ts` | 接口 + 实现 | `scanSourceFiles` 添加 `excludePaths`；添加 `.toml`/`.lock` 和 filename prefix 匹配；`resolveInputFiles`/`buildGeneratorCacheKey` 接受可选 outputDir |
| `src/panoramic/cache/cache-manager.ts` | 透传参数 | `initialize()` 时存储 outputDir，在 `check()`/`record()` 中透传给 `buildGeneratorCacheKey`/`resolveInputFiles` |

## 接口变更

### cache-key-builder.ts 函数签名更新

```ts
// 新增 excludePaths 参数
export function scanSourceFiles(root: string, excludePaths?: string[]): string[]

// 新增可选 outputDir 参数（传入时排除该目录）
export async function resolveInputFiles(
  generator: DocumentGenerator<unknown, unknown>,
  context: ProjectContext,
  outputDir?: string,
): Promise<string[]>

// 新增可选 outputDir 参数
export async function buildGeneratorCacheKey(
  generator: DocumentGenerator<unknown, unknown>,
  context: ProjectContext,
  hasher: ContentHasher,
  outputDir?: string,
): Promise<string>
```

### cache-manager.ts 字段新增

```ts
// 存储 outputDir 供 key-builder 使用
private outputDir: string = '';
```

## 回归风险

- `scanSourceFiles` 接口变更为可选参数，向后兼容（现有调用者不传时行为不变）
- `CACHE_SKIP_GENERATOR_IDS` 豁免 5 个 upstream generators，这些 generators 仍会执行，不影响输出质量
- CLI 默认路径变更仅影响"不指定 --output-dir 时"的默认行为，明确传参时不受影响

## 验证方案

1. 检查 TypeScript 编译通过（`npm run build`）
2. 运行现有单元测试（`npm test -- src/panoramic/cache/`）
3. 人工检查：
   - 修复后 `spectra cache stats` 输出应指向 `specs/project/_meta/_cache-manifest.json`
   - upstream generators（architecture-ir 等）在缓存命中的情况下仍产出 structuredData
   - `scanSourceFiles` 在有 outputDir 时不纳入输出目录文件
