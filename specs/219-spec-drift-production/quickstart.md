# Quickstart：Spec Drift 建锚与检测

**Feature**: `219-spec-drift-production`
**适用版本**：`normalizationProfile = ts-morph-canonical-v2`、`fingerprintVersion = 1`

Spec Drift 解决一个具体问题：**spec / 设计文档里引用了某个代码 symbol，代码改了但文档没跟着改**。
它的做法是给「文档里的这一处引用」建一个锚（anchor），记录被引用 symbol 当前的 canonical AST
指纹；之后每次 `drift check` 重新计算指纹并比对，指纹变了就报 `stale`。

---

## 1. 三十秒上手

```bash
# 1) 准备引用清单（见 §2），例如 docs-refs.json
# 2) 建锚：把清单里的每条引用解析成 symbolId + 指纹，写入 lock
npm run drift:link -- --manifest docs-refs.json

# 3) 检测：按 lock 内已持久化的 symbolId 精确重算指纹
npm run drift:check

# 4) 某条引用不再需要时按 id 精确删除
npm run drift:unlink -- ref-parser-entry
```

`drift check` 同时已作为 `npm run repo:check` 的第 13 个检查族接入：默认输出 warning，
加 `--strict` 提升为 error，lock 损坏则恒为 fail。

---

## 2. 引用清单（manifest）编写

清单是一个**独立的 JSON 文件**，内容为条目数组：

```jsonc
[
  {
    "id": "ref-parser-entry",          // 锚的稳定唯一 id，unlink / refresh 都按它定位
    "ref": "src/core/parser.ts::parseDocument", // ⚠️ MUST 为 file-qualified 形式
    "docPath": "specs/042-x/spec.md",  // 引用出现在哪个文档
    "line": 87                          // 引用在文档中的行号
  }
]
```

**`ref` 合同（最容易踩的一条）**：必须写成 `<相对路径>::<symbolName>`。

| 写法 | 结果 |
|------|------|
| `src/core/parser.ts::parseDocument` | ✅ 正常解析 |
| `parseDocument`（裸 symbol 名） | ❌ `unresolved` —— 无法确定是哪个文件里的同名 symbol |
| `src/core/parser.ts::Parser.parse` | ❌ `fingerprint-unavailable` —— member 粒度本期显式不支持 |
| `src/core/parser.py::parse` | ❌ `unsupported-language` —— 首发仅 TypeScript / JavaScript |

**member 粒度为什么直接拒绝而不是回退到整个 Class**：回退会让同一个类里**另一个** method 的
改动误伤这条锚（sibling 误报），这正是 SC-002 要防的事。需要 method 级精度时，请把该 method
提取为 top-level 导出后再建锚。

**首发支持的扩展名**（与仓内 `TsJsLanguageAdapter` 完全一致）：
`.ts` / `.tsx` / `.js` / `.jsx` / `.mjs` / `.cjs` / `.mts` / `.cts`。

---

## 3. 三条命令

### `drift link`

```bash
npm run drift:link -- --manifest docs-refs.json              # 新增锚
npm run drift:link -- --manifest docs-refs.json --refresh    # 按当前代码重算全部锚的指纹
npm run drift:link -- --manifest docs-refs.json --refresh --id ref-parser-entry  # 只刷新一条
```

- 整批**原子写入**：全部条目在内存里算完才一次性落盘，不会留半成品 lock。
- 同一个 `id` 已存在且**没加** `--refresh` 时会被拒绝（防止静默覆盖既有锚）。
- `--refresh` 时若某条引用重新解析落到 `ambiguous` / `unresolved`，会**保留刷新前最后一次
  已知良好的整条记录**，而不是把它写成失败态。

### `drift check`

```bash
npm run drift:check
npm run drift:check -- --format json
```

- **只做精确匹配**：按 lock 里已持久化的 canonical `symbolId` 定位，MUST NOT 重新模糊解析。
  否则「symbol 被删除、同文件新增了一个名字相近的 symbol」会被悄悄洗成 `fresh`。
- 判定语义（canonical AST 指纹）：
  - 判 **fresh**：只改注释、只改 JSDoc、只改缩进 / 换行 / 空格、加括号、引号风格变化、
    数字与 BigInt 分隔符（`1000` ↔ `1_000`、`1000n` ↔ `1_000n`）。
  - 判 **stale**：标识符改名、字面值改变、控制结构变化（`if` ↔ `while`）、一元运算符变化
    （`+a` ↔ `-a`、`++a` ↔ `--a`、`a++` ↔ `a--`）、声明关键字变化（`const` ↔ `let` ↔ `var`
    ↔ `using` ↔ `await using`）、函数重载中**任意一个**签名或实现体变化。

### `drift unlink`

```bash
npm run drift:unlink -- ref-parser-entry
```

按 `id` 精确删除，不接受用 `ref` / `docPath` 反查（避免误删同名引用）。

---

## 4. 退出码

| 退出码 | 含义 |
|--------|------|
| `0` | 全部 fresh / 操作成功 |
| `1` | 存在 `stale` 或 `orphaned`（已确认的 drift） |
| `2` | 存在不可验证态（`graph-unavailable` / `ambiguous` / `unresolved` / `fingerprint-unavailable` / `unsupported-language` / `parser-degrade` / `graph-stale`），或操作性失败 |
| `3` | lock 文件损坏 |

**混合优先级**：多种状态共存时按 `lock-corrupt (3) > graph-unavailable (2) > stale/orphaned (1)
> 其余不可验证态 (2) > fresh (0)` 分层求值，**不是**按数组里第一个非 fresh 项取值。
特别地，`graph-unavailable` 与 `stale` 共存时整体退出码是 **2 而非 1**——「结论不可信」比
「已确认 drift」更需要先处理。

---

## 5. 常见状态与处置

| 状态 | 含义 | 下一步 |
|------|------|--------|
| `stale` | AST 结构 / token 已变化 | 确认 spec 引用是否仍准确：准确则 `drift link --refresh`，不准确则修订 spec 文案 |
| `orphaned` | 被锚 symbol 已消失（删除 / 重命名） | `drift unlink` 清理，如有替代 symbol 重新 `drift link`（M9 不做 rename-follow） |
| `fingerprint-unavailable` | symbol 已解析但取不到可用指纹 | 看 `reason`：版本不匹配 → `drift link --refresh`；member 粒度 → 改锚 top-level symbol |
| `graph-unavailable` | AST 分析环境不可用（dist 编译产物缺失 / 加载失败） | `npm run build` 后重跑 |
| `ambiguous` | 引用命中多个候选 | 在清单里把 `ref` 改写成更精确的 `file::Symbol` 形式后重新建锚 |
| `lock-corrupt` | lock 无法解析 / schema 不兼容 / 缺必需字段 | 修复 `.specify/spec-drift.lock.json` 后重跑 |

### `graph-stale`：本版本不会在正常使用中产生

状态矩阵里保留了 `graph-stale`（消费的 graph 制品早于当前工作树），但**当前版本没有自然触发
路径**：drift 每次都对目标文件即时重新解析，不消费预生成的 graph 制品。该状态是为将来引入
graph 新鲜度判定预留的接口位；如果你在真实运行中看到它，请当作缺陷上报。

---

## 6. 已知边界

- **dist 陈旧无信号（未缓解的已知风险）**：drift 通过动态 `import()` 加载 `dist/**` 的编译产物
  来做 AST 分析。dist **完全缺失**时会明确报 `graph-unavailable`；但 dist **存在却落后于
  `src/`** 时没有任何信号，drift 会静默使用旧编译逻辑。
  👉 **改动 `src/` 后请先 `npm run build` 再跑 drift。**
- **升级 profile / version 不会误报批量 stale**：`normalizationProfile` 或 `fingerprintVersion`
  与当前工具常量不一致时，锚一律标 `fingerprint-unavailable` 并提示 `--refresh`，**不会**拿新旧
  哈希直接比较而把全部存量锚冲成 `stale`。C1 阶段产出的 `source-slice-whitespace-v1` 锚、以及
  `ts-morph-canonical-v1` 锚（该版本的 token 流基于 `forEachChild`，**不枚举关键字 / 修饰符
  token**，会把 `extends`→`implements`、`export {}`→`export type {}` 等语义变化误判为 fresh，
  已在 v2 修复）都属此类，跑一次 `drift link --refresh` 即可。
- **跨文件 re-export 不支持**：`export { foo } from './other'` 形态不定义跨文件指纹归属，请直接
  锚定 `foo` 真实声明所在的文件。此类锚在 `drift check` 中会稳定报
  `fingerprint-unavailable`（reason 含 `reexport-unsupported`），而不是被误判为
  `orphaned`——工具能识别该导出确实存在，只是拒绝为它定义跨文件指纹。
- **文档侧锚失效非本期目标**：本期只检测「代码变了」，不检测「文档行号漂移 / 文档被删」。
