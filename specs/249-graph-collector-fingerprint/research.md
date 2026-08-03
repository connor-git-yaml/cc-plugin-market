# Phase 0 研究：Graph Collector Fingerprint

本需求的绝大部分技术决策已在 `spec.md`（四轮 Codex 对抗审查收敛）与 `codebase-context.md`（v4）中定案，不再重复研究。本文件仅补充 spec 未定案、纯属实现路线选择的三处技术决策。

## 决策 1：SSoT 模块落位

- **Decision**：`src/collector-surface.ts`（`src/` 顶层单文件，零依赖）。
- **Rationale**：`src/models/*.ts` 现有文件全部 `import zod`，语义上是"数据结构 Schema 层"而非"零依赖叶子层"，放入 `models/` 会造成目录语义混淆；`src/` 顶层已有单文件模块先例（`runtime-bootstrap.ts`）。
- **Alternatives considered**：
  - `src/models/collector-surface.ts` —— 拒绝，理由见上。
  - `src/panoramic/graph/collector-surface.ts`（与 `source-commit.ts` 同层）—— 拒绝，因为 `adapters/`、`panoramic/cache/` 等消费方引用 `panoramic/graph/` 下的模块会构成跨层引用面（尽管技术上不循环，但语义上"采集面单一事实源"不应绑死在 `panoramic/graph` 这一具体消费者的目录下）。

## 决策 2：`getDirtySourceExtensions()` 的去留

- **Decision**：移除该导出函数，替换为 `source-commit.ts` 内部谓词（遍历 `collector-surface.ts` 的 `ALL_PRODUCER_SURFACES`，按各自 `matchSemantics` 分别判定）。
- **Rationale**：该函数原有契约（返回单一 `ReadonlySet<string>` 供 `.has()` 判定）无法表达"不同管线大小写匹配语义不同"这一 FR-003 的核心要求；若不改契约、只改内容，会重新引入 FIX-4 已修复的大小写误判问题。
- **Alternatives considered**：
  - 保留函数名，改返回类型为一个"判定函数"（如 `(filePath: string) => boolean`）——技术上可行，但函数名 `getDirtySourceExtensions`（"获取扩展名集合"）与新语义（"判定函数"）字面不符，容易误导后续维护者；改为不导出的内部实现更贴合实际状态转移。
  - 保留旧函数并新增第二个函数并存——拒绝，YAGNI：没有已知消费方需要两种形态同时存在。

## 决策 3：b-track 再生脚本运行方式

- **Decision**：`scripts/regen-collector-fingerprint-fixtures.ts`，用 `tsx` 直接运行，直接 import 项目 TS 源码，不依赖 `dist/` 构建产物、不 spawn CLI 子进程。
- **Rationale**：本仓库已有 `tsx` 直跑 TS 脚本的先例（`package.json` 的 `"prebuild": "tsx scripts/inline-d3.ts"`）；相比 spawn `dist/cli/index.js` 子进程（`graph-quality-core.mjs` 的既有模式），直接 import 源码可以让"再生脚本"与"vitest 护栏测试"共用同一份 `tests/helpers/module-graph-snapshot-normalize.ts` 规范化工具，避免出现"测试用一套比较逻辑、脚本用另一套"的镜像风险；同时消除"必须先 `npm run build`"这一前置门槛，降低重跑护栏的操作成本。
- **Alternatives considered**：
  - spawn `dist/cli/index.js batch --mode graph-only` 子进程（沿用既有 micrograd fixture 的重生模式）——拒绝：micrograd fixture 的场景是"对外部 clone 项目跑完整 CLI"，本需求的 fixture 是仓内 hermetic 小样本，且需要额外调用 `buildModuleGraphForProject`（b-track），该函数没有对应的独立 CLI 子命令可 spawn，若仍要用子进程方式则需要新增一个"仅供测试使用"的 CLI 子命令，属于不必要的额外接口（违反 YAGNI）。
