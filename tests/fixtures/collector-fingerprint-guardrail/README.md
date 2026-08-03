# collector-fingerprint-guardrail fixture（F249）

本目录是 F249 双轨重建-对比护栏（FR-005）的 **hermetic 输入**：内容完全钉死，任何改动都会
被再生脚本的二元拒绝判据当作"行为面基线变更"处理。

## 目录结构与覆盖意图

| 路径 | 覆盖的采集管线 | 意图 |
|------|---------------|------|
| `src/ts/foo.ts`、`foo.tsx`、`bar.js`、`bar.jsx` | #1 `tsjsSkeletonWalk` | 声明面前四扩展（大小写敏感面） |
| `src/py/mod.py`、`mod.pyi` | #2 `pyWalk` | 含 FIX-4 曾漏报的 `.pyi` |
| `src/java/Foo.JAVA` | #3 `genericAdapters`（java 分量） | 大小写变体样本，证明大小写不敏感面被真实覆盖 |
| `src/go/main.go` | #3 `genericAdapters`（go 分量） | go 扩展 |
| `src/module-only/entry.mjs` | #1 `tsjsSkeletonWalk` ∩ #7/#8 `moduleDerivationScan` | **双轨可见**样本（见下方"rebase 调和"） |

### rebase 调和补记 · 2026-08-03（`.mjs` 从单轨变双轨）

`entry.mjs` 原本的覆盖意图是"`.mjs` 只被 module 派生扫描面识别，是 a-track 的护栏盲区、
b-track 的存在理由"。master 的 d27ba75 把 `.mjs`/`.cjs` 纳入 `tsjsSkeletonWalk` 采集面后，
该盲区**不再存在**：`entry.mjs` 现在同时出现在 a-track 的 graph-only 产物里。两份 pinned
资产因此经再生脚本的"extensionSurface 变化=自动放行"路径重新生成（a-track 期望图变大）。

b-track 的存在理由改由 `.mts`/`.cts` 承担——`tsjsSkeletonWalk` 显式不含这两个扩展（沿用
d27ba75 登记的残留口径），仅 `moduleDerivationScan` 覆盖；且 a-track 比较的是 symbol/file 图，
b-track 比较的是 module 投影，两者本就不是同一投影面。护栏测试里有一条专门用例把"两轨覆盖面
不等价"钉死，防止将来有人以"两轨都能看到 entry.mjs"为由裁掉 b-track。

`src/` 这一层子目录是**必需的**：`buildModuleGraphForProject` 优先扫描 `<root>/src`，且默认
`includeOnly` 为 `/^src\//`（见 `src/knowledge-graph/module-derivation.ts`）。把样本平铺到
fixture 根目录会让 b-track 扫不到任何文件、退化为空图假绿。

`src/module-only/entry.mjs` 的内容（`import { foo } from '../ts/foo.ts';`）是**逐字钉死**的：
显式带 `.ts` 扩展名的相对路径让 `resolveTsJsImport` 的相对路径分支第一候选即命中真实文件，
不依赖扩展名推断或 tsconfig paths alias，因此 b-track 才能稳定断言 `entry.mjs → foo.ts` 这条
具体端点的边（禁止退化为"边数非空"式断言）。

## pinned 期望资产

- `expected-graph-only-graph.json`：`{ fixtureInputHash, graph }`，`graph` 是 `buildAstGraphOnly` 产物。
- `expected-module-graph.json`：`{ fixtureInputHash, fingerprint, moduleGraph }`，`moduleGraph` 是
  `buildModuleGraphForProject` 产物经 `tests/helpers/module-graph-snapshot-normalize.ts` 规范化后的投影。

两份资产 **MUST** 经 `tests/helpers/pinned-asset-loader.ts` 的 typed loader 解包读取，
**MUST NOT** 裸 `JSON.parse` 后直接传给要求裸 `GraphJSON`/`ModuleGraph` 的入口（外层多一层包装）。

重新生成：`npm run fixtures:regen:collector-fingerprint`（首次冷启动加 `--init`）。

## 禁止事项

1. **禁止在本目录（含任意子目录）新增与既有大小写变体样本仅大小写不同的文件。**
   具体地：既有 `src/java/Foo.JAVA`，则 **MUST NOT** 新增 `src/java/foo.java`、`Foo.java`、
   `FOO.JAVA` 等任何仅大小写不同的同名文件。
   原因：macOS（APFS 默认 case-insensitive / case-preserving）与 Windows 的文件系统会把两者
   判定为**同一个文件**并静默覆盖，导致 fixture 实际内容与 git 记录不符；而 Linux CI 默认
   case-sensitive 文件系统上两个文件并存，该错误不可复现——构成隐蔽的跨平台不一致风险，
   表现为"本机护栏红、CI 绿"或反之，且排查成本极高。
   如需新增大小写变体覆盖，请换一个 basename（如新增 `src/java/Bar.Java`）而非同名变体。
2. **禁止手工编辑 `expected-*.json`**（除 quickstart 的拒绝路径演示后立即 `git checkout` 还原）。
   两份资产的 `fixtureInputHash`/`fingerprint` 由再生脚本保持彼此一致，手工编辑会在下次运行时
   触发前置一致性校验报错阻塞。
3. **禁止新增 `*.test.ts` / `*.spec.ts` 命名的样本**：虽然本目录不在任何 vitest project 的
   include glob 内，但 `buildModuleGraphForProject` 会按 ts-js adapter 的 test pattern 过滤这类
   文件，导致 registry 已注册 / 未注册两条路径产出不同的图，破坏 b-track 的可对比性。
