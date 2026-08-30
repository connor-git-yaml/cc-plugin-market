# 契约：零执行测试文件守卫输出（FR-011 / 决策 3）

**载体**：`tests/integration/zero-execution-test-file-guard.test.ts`
**覆盖域边界（诚实声明，异构对抗审查 F272 缺陷 7 后收窄措辞）**：仅 vitest 域
（`**/*.test.ts` / `**/*.spec.ts`）。`plugins/**/*.test.mjs`（`npm run test:plugins` 独立
runner，约 162 用例）不在本守卫覆盖范围内。**本守卫只能证明"磁盘侧存在的测试文件是否落在
任一 vitest project 的 include 范围内"，不能证明"落在 include 范围内的文件一定会被真的执行
到"**——`npx vitest list --filesOnly` 只做 glob 匹配，不解析文件内容判断是否被跳过；整文件
`describe.skip(...)`/`it.skip(...)` 这类"存在且被收集、但从不真正跑断言"的形态仍会被收集，
**不在本守卫覆盖面内**，是已知边界而非缺陷。早期版本的标题/注释宣称能防住"存在但从不执行"，
这个措辞过宽，已收窄为"不在任何 vitest project 的 include 范围内"。

## 输入事实源（异构对抗审查 F272 缺陷 2/3 后改为 git 枚举）

| 事实源 | 命令 | 用途 |
|---|---|---|
| 磁盘侧全集 | `git ls-files -z -- '*.test.ts' '*.spec.ts'`（tracked）∪ `git ls-files -z --others --exclude-standard -- '*.test.ts' '*.spec.ts'`（未提交但磁盘存在的游离文件），再叠加 `fs.existsSync` 过滤 | 枚举仓库里实际存在的全部 `.test.ts`/`.spec.ts` 文件 |
| vitest 收集侧全集 | 子进程 `npx vitest list --filesOnly`（stdout 每行形如 `[project] path/to/file.test.ts`，剥掉行首 `^\[[^\]]+\]\s+` 前缀取剩余 `.test.ts`/`.spec.ts` 路径，不匹配路径里的目录名）| vitest 五个 project（unit/integration/golden-master/self-hosting/e2e）实际会执行的文件集合，权威事实源，不自行解析 `vitest.config.ts` |

### 早期版本的两处缺陷（已修复，记录供审查对照）

1. **手写目录递归 + `EXCLUDED_DIR_NAMES` 名单式排除，从不查 `.gitignore`**：`.gitignore:75`
   明确登记 `.claude/worktrees/` 为"Claude Code worktree 自动管理目录"，但手写递归只按目录名
   排除 `node_modules`/`dist`/`.git`，会把嵌套 worktree checkout 里的测试文件全部扫进来，制造
   大量假阳性（本仓在多 worktree 并行开发时该目录下可能同时存在数千个 `.test.ts`）。改用
   `git ls-files` 天然遵循 `.gitignore`，不需要自己维护排除名单。
2. **`git ls-files`（不带 `--others`）报的是 index 快照，工作区里"已 `rm` 但未 stage 删除"的
   文件仍会被列出**：F272 本卡开发过程中实测复现——`src/panoramic/qa/__tests__/` 下 8 个陈旧
   副本已从磁盘删除但改动尚未 `git add`/`git rm` stage，`git ls-files` 仍会报出这 8 个路径。
   若不处理，这些磁盘上已不存在的路径会被误判为"存在但不在 include 范围内"，产生 8 条与白
   名单不符的幽灵差异。修法：磁盘侧集合 MUST 是 `git 记录到的路径 ∩ fs.existsSync 为真`，
   而不是单纯的 git index 快照。

### 符号链接语义（改用 git 后的变化）

早期版本用 `lstat`（不跟随符号链接）避免把 `_reference/`（指向仓外目录的符号链接）纳入扫描。
改用 `git ls-files` 后这个问题结构性消失，不需要额外判断：git 本身在枚举时不会跟随符号链接
展开其指向的仓外内容，`_reference/` 这类符号链接条目不会把仓外测试文件带入结果集。

## 白名单结构

```ts
interface WhitelistEntry {
  path: string;    // 相对仓库根的路径，与磁盘侧枚举格式一致
  reason: string;  // 为什么该文件允许零执行
}

const ZERO_EXECUTION_WHITELIST: WhitelistEntry[] = [
  {
    path: 'tests/fixtures/graph-quality-ts/greeter-service.test.ts',
    reason:
      'TS/JS pinned graph fixture 的输入语料（被 spectra graph-only 构建器当作目标项目源码解析），' +
      '不是待执行的 vitest 测试文件；有意不落在任何 project 的 include 范围内',
  },
];
```

白名单条目 MUST 精确到文件路径（不是目录前缀/glob 模式），MUST 附带理由；新增条目需要显式修改本文件并说明理由，不接受"目录级豁免"写法。

## 断言契约

```
diskSet = (git ls-files -z '*.test.ts' '*.spec.ts') ∪ (git ls-files -z --others --exclude-standard '*.test.ts' '*.spec.ts')，再取与 fs.existsSync 的交集
collectedSet = vitest list --filesOnly 解析得到的路径集合
diff = diskSet - collectedSet
expect(diff.sort()).toEqual(ZERO_EXECUTION_WHITELIST.map(e => e.path).sort())
```

失败时输出信息 MUST 包含：
- `diff` 中每个意外条目的完整路径
- 提示"该文件未被任何 vitest project 的 include 收集，若为语料/fixture 文件请加入白名单并附理由；若为遗漏的测试文件请检查 vitest.config.ts 的 include"

`git ls-files` 非零退出码 MUST throw，不能吞成空集合——空集合会让 `diff` 恒为空，等价于把整个守卫 fail-open 掉。

## 变异验证记录点（verify 阶段）

1. 创建 `src/panoramic/qa/zzz-probe.test.ts`（不在 `.gitignore` 覆盖范围内的路径），内容：
   ```ts
   import { it } from 'vitest';
   it('mutation probe — 不应长期存在', () => {});
   ```
2. 重跑本测试，确认失败且失败信息包含 `src/panoramic/qa/zzz-probe.test.ts`。
3. 删除该探针文件，重跑本测试，确认恢复通过。

**gitignore 排除验证**（F272 异构对抗审查缺陷 2 复测）：在 `.claude/worktrees/fake-wt/tests/unit/example.test.ts`（被 `.gitignore:75` 覆盖的路径）创建同样的探针文件，重跑本测试，确认**仍然通过**（该路径不应出现在 diskSet 中）。删除该探针目录后确认无残留。

**幽灵删除文件验证**（F272 异构对抗审查缺陷 2 复测）：在当前工作区存在"文件已 `rm` 但未 `git add`/`git rm` stage"的删除时（本仓 F272 开发过程中即为此状态），重跑本测试，确认通过（不会把这些磁盘上已不存在的路径误判为差异）。
