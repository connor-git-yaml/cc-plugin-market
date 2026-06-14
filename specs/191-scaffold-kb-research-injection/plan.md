---
feature_id: 191
name: scaffold-kb research 预查注入 — 技术方案
status: draft
created: 2026-06-14
phase: plan
---

# Feature 191 — 技术方案

## 1. 架构概览（跨两插件）

```
spec-driver 插件                          spectra 包
─────────────                            ──────────
project-context.yaml                     spectra scaffold-kb query
  knowledge_sources: {...}                 --requirement "<需求>"
        │                                   --vendor-kb <p> [--project-kb <p>]
        ▼                                   [--top-k N] [--format markdown|json]
resolve-project-context.mjs                     │
  → knowledgeSources（FR-002）                   ├─ extractKeywords(需求)  ← 复用 tokenize（CJK 感知）
        │                                        ├─ searchKbCore × 双库 → mergeResults（复用 F190）
        ▼                                        └─ formatInjectionBlock（envelope + 非指令前导）
scripts/kb-prequery.mjs（新）                          │
  ① 读 knowledgeSources                              stdout: 注入块 markdown / json
  ② bin 发现 + 版本探测（FR-007）  ───shell out───────┘
  ③ 拿 stdout 注入块
  ④ 空/降级 → 不注入
        │
        ▼
SKILL（feature/story）specify 阶段：dispatch specify 子代理前拼注入块进 Task prompt（固定注入点，两模式皆有 specify）
```

## 2. 关键设计决策

### 2.1 关键词提取放 spectra 侧（解跨插件 tokenize 依赖）
FR-008 要复用 CJK 感知的 `tokenize`，但它在 spectra 包（`src/scaffold-kb/tokenizer.ts`），kb-prequery 在 spec-driver 插件。**决策**：keyword 提取放进 `spectra scaffold-kb query`（spectra 侧，能直接 import tokenize）；kb-prequery 只传原始需求文本 `--requirement`，不自己分词。→ 跨插件零代码依赖（只跨进程 shell out）。

`extractKeywords(text)`（`src/scaffold-kb/keyword-extract.ts` 新）：`tokenize(text)` → 去停用词（内置中英小表）→ 排序**优先 bigram/符号、单字降权** → top-N（默认 8）→ **返回空格拼接串（不含 OR，修 Codex C3：OR 由 sanitizeQuery 负责）**；为空则整句 surrogate-safe 截断前 64 字符 fallback（EC-003）。

### 2.2 `scaffold-kb query` 复用 F190 检索栈
新增 `query` op 到 `src/cli/commands/scaffold-kb.ts` + parse-args（`query` 子操作 + `--requirement`/`--vendor-kb`/`--project-kb`/`--top-k`/`--format`）。流程：extractKeywords → loadKbContext（复用 kb-locator）→ searchKbCore 双库 → mergeResults → formatInjectionBlock。**退出契约（统一）**：KB 不可用 / 无命中 → exit 0 + stdout 空；仅 bin 缺失 / 参数错误 → 非零 exit（FR-001）。

`formatInjectionBlock(results, format)`（`src/scaffold-kb/injection-format.ts` 新）：
- markdown：非指令前导句 + 每条 `[KB-EVIDENCE doc_id src built_at]…[/KB-EVIDENCE]`（复用 kb-search 的 envelope/defang/safeAttr/safeTruncate）+ 总量 ≤ max_inject_chars
- json：结构化 results（供脚本消费）

### 2.3 bin 发现（FR-007，kb-prequery 侧）
`resolveSpectraBin()`（**覆盖优先顺序，修 Codex C7**）：① `$SPECTRA_BIN` → ② `<projectRoot>/node_modules/.bin/spectra` → ③ PATH `spectra`。能力探测用 `<bin> scaffold-kb query --probe`（stdout sentinel `scaffold-kb-query:1` + exit 0），**非 --help 文本匹配**；ENOENT/旧版/超时 → stderr 诊断 `spectra-unavailable`/`spectra-too-old` + 降级（stdout 空，exit 0）。probe+query 各设超时 + stdout 上限，run 内 probe 缓存。

### 2.4 schema/resolver（FR-002，spec-driver 侧）
- `project-profile-schema.mjs`：`ALLOWED_TOP_LEVEL_FIELDS` 加 `knowledge_sources`；`resolvedProjectProfileSchema` 加 `knowledgeSources` zod 对象（enabled/vendorKb/projectKb/topK/maxInjectChars）—— **无 injectPhases 字段**（注入点固定 specify，删可配项，修 Codex 复验）
- `project-profile-resolver.mjs`：仿 `normalizeResearchPolicy` 写 `normalizeKnowledgeSources`（默认形态 + 路径解析相对 projectRoot + 非法值 diagnostics 回落）；在 resolve 返回对象加 `knowledgeSources`
- `project-context-template.yaml`：补 `knowledge_sources` 注释样例
- **projectContextBlock 静态文本不变**（knowledge_sources 不进静态块，仅作预查配置）

## 3. 新增/修改文件

### spectra 侧
| 文件 | 改动 |
|------|------|
| `src/scaffold-kb/keyword-extract.ts` | 新增 extractKeywords |
| `src/scaffold-kb/injection-format.ts` | 新增 formatInjectionBlock（复用 envelope 工具，从 kb-search 抽共享或重用）|
| `src/cli/commands/scaffold-kb.ts` | 加 `query` 分支 |
| `src/cli/utils/parse-args.ts` | `query` 子操作 + `--requirement`/`--top-k`/`--format` 解析 |
| `src/cli/index.ts` | HELP_TEXT 加 query 用法 |

### spec-driver 侧
| 文件 | 改动 |
|------|------|
| `plugins/spec-driver/scripts/lib/project-profile-schema.mjs` | 白名单 + resolved schema 加 knowledge_sources |
| `plugins/spec-driver/scripts/lib/project-profile-resolver.mjs` | normalizeKnowledgeSources |
| `plugins/spec-driver/scripts/kb-prequery.mjs` | 新增（config 读 + bin 发现 + shell out + 输出注入块）|
| `plugins/spec-driver/templates/.../project-context-template.yaml` | 注释样例 |
| `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` + story | specify 阶段前接线 kb-prequery（注入区拼接说明）|

> envelope/defang/safeAttr/safeTruncate 当前在 `src/kb-mcp/tools/kb-search.ts`；plan 决策：抽到 `src/scaffold-kb/evidence-envelope.ts` 共享，kb-search + injection-format 同源（避免重复 + 防漂移）。
> **依赖方向（修 Codex W）**：`evidence-envelope.ts` 在 scaffold-kb，**不得** import kb-mcp 的 `SourceKind`（否则 scaffold-kb→kb-mcp 反向依赖）——helper 用本地 `'vendor'|'project'` union 或接受普通 string 参数；`SourceKind` 类型一并下沉到 scaffold-kb 由 result-merger re-export。
> **cap 口径（修 Codex W）**：`formatInjectionBlock` 的 `max_inject_chars` 按**最终 markdown 字符数**计（含 envelope + 前导句），surrogate-safe 截断，元数据不截。

## 4. 测试计划
- `tests/kb/keyword-extract.test.ts`：中/英需求 → 关键词；空 → fallback（FR-008/EC-003）
- `tests/kb/injection-format.test.ts`：envelope + 非指令前导 + char cap + 恶意注入 defang（SC-001/004a）
- `tests/kb/scaffold-kb-query.test.ts`：query CLI 端到端（demo fixture，markdown/json）（SC-001）
- `tests/spec-driver/kb-prequery.test.ts`（或 integration）：配 knowledge_sources 临时项目 → 注入块（SC-003）；缺 bin/旧版降级（SC-006）；恶意 KB（SC-004a）
- `tests/integration/spec-driver-project-context-resolver.test.ts`（扩展）：knowledgeSources 默认形态 + 解析 + 9 字段快照不变（SC-002/005）
- 注入块自洽断言：kb-prequery stdout 块自含定界 + 非指令前导 + envelope（SC-003b；无独立拼接 helper，拼接由 SKILL 完成）

## 5. 零回归 / 约束
- `evidence-envelope` 抽取后 kb-search 行为 MUST 不变（F190 测试全绿）
- project-context resolver 9 字段快照不变（新字段为加法）
- schema/resolver 合约敏感 → codex 对抗审查 + 全量门禁
- 全程通用定位红线

## 6. 范围外
plan 阶段注入（默认仅 specify 前；plan 注入 opt-in）、门禁集成、锚定（F189）、三方导入、Wiki 层 —— 见 spec §6。
