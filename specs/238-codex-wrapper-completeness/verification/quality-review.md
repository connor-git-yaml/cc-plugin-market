# Feature 238 代码质量审查（quality-review）

审查范围：`git diff 0ae3eb7..HEAD` 中的实现文件（新增 3 个 + 修改 6 个 + 测试改动面）。

## 结论：PASS

无 critical / warning 项。仅记录 3 条 info 级建议，均为可选风格改进，不阻断本 Feature。

## 逐维度评估

### 单一职责 / 命名即文档

- `detect-codex-capability.mjs`：`parseFeaturesListOutput`（纯函数）/`classifySubprocessError`（子进程边界分类）/`detectCodexCapability`/`detectCodexVersion`/`renderCapabilityMarkdown` 五个函数各司其职，纯解析与子进程 IO 严格分离，符合文件头声明的架构意图。命名精确（`CapabilityState`/`CapabilityReason` 类型别名即文档）。
- `model-literal-gate-core.mjs` 与既有 `codex-plugin-consistency-core.mjs` 结构同型（`{status, checks, warnings, errors}` 三段式契约、`createCheck` 辅助函数命名一致），`resolveScanFiles`/`collectSkillMdFiles`/`scanFile` 职责边界清晰，无跨职责耦合。
- `model-selection.ts` 新增 `resolveCodexModelDecision`（原子 decision resolver）与既有 `resolveReverseSpecModel`（通用 provider 路径）职责边界明确：前者仅服务 codex modelFlagMode 决策矩阵，后者仍服务 claude/generic 路径，两者未产生功能重叠或复制粘贴式重复（已用注释显式说明为何不复用 `toCodexModelId()`）。

### 尽早 return / 死代码 / 重复逻辑

- `resolveCodexModelDecision` 判定顺序 1→5 均为提前 return，无冗余嵌套。
- `getTimeoutForModel` 新增 `delegated:` 分支放在其余关键字判断之前并附因果注释，避免了后续 `.includes('sonnet')` 等分支产生的误判死角，属于必要的顺序约束而非死代码。
- 未发现未使用的导出符号或注释掉的代码块。

### 注释质量（why 而非 what）

- 全部新增注释聚焦"为什么这样设计"（如 `codex-proxy.ts` 中 delegate 判定为何只认 `model` 字符串前缀而不消费 `modelFlagMode` 字段、`llm-client.ts` 中日志为何落在该层而非 `codex-proxy.ts`），符合仓库 `agent-code-quality` 约定；未见"给 reviewer 看的"噪声注释或复述代码本身的注释。

### 类型约束

- TS 侧新增 `CodexModelFlagMode`（'required'|'delegate'）判别联合类型，`ResolvedCodexCLIProxyConfig` 显式声明"仅供日志/测试断言消费、不进入 `CodexCLIProxyConfig` 公共入参"的类型边界，避免了非法状态空间。
- mjs 侧 JSDoc `@typedef` 覆盖 `CapabilityState`/`CapabilityReason`/`CapabilityVerdict`，为无原生类型系统的脚本层提供了等价约束描述。

### 新旧模块结构一致性

- `detect-codex-capability.mjs` 与 `extract-wrapper-body.mjs` 共享 `isDirectExecution()` 实现手法（`fs.realpathSync` 而非 `URL.pathname`，注释显式指出复用理由），两模块 CLI 入口风格统一。
- `model-literal-gate-core.mjs` 与 `codex-plugin-consistency-core.mjs`（141 行 vs 344 行）在契约形态、`createCheck` 辅助函数、`aggregateValidation` 接线方式上保持一致，`repo-maintenance-core.mjs` 中新增第 14 族检查的接线代码与其余 13 族同构。

### 文件行数纪律（F218 先例）

| 文件 | 修改前 | 修改后 | 判定 |
|------|-------|-------|------|
| `src/core/llm-client.ts` | 776 | 806 | 正常增长（+30），远低于 500→800 CRITICAL 阈值 |
| `src/core/model-selection.ts` | 533 | 633 | 已处于 >500 区间但未跨越 800 CRITICAL 阈值；新增内容（`resolveCodexModelDecision` + 类型定义）是本 Feature 核心决策逻辑，非可轻易外置的旁支代码，暂不要求拆分 |
| 新增 3 个文件 | — | 193/141/30 行 | 均为小粒度单一职责模块，无行数问题 |

无文件触发 CRITICAL 拆分要求。`model-selection.ts` 建议后续若再新增类似规模的 provider 专属决策逻辑，可考虑拆出 `model-selection/codex-decision.ts` 子模块，但本 Feature 范围内不构成阻断项。

### Shell 脚本质量（`codex-skills.sh`）

- 新增段落（`spec-driver-refactor` 加入 `SKILLS`/`write_wrapper` 列表、capability 探测 + sidecar 写入）延续既有风格：`local` 变量声明、失败仅告警不阻断（`|| { ... }` 等价写法用 `if !`）、中文注释标注 Feature/FR 来源。
- Sidecar 路径推导 `dirname "$TARGET_DIR"` 与 `.mjs` 文件头注释中声明的 `.codex/spec-driver-capability.md` 落点一致，已核实两处引用互相吻合。
- 未见破坏 `set -euo pipefail` 的裸风险命令（`2>/dev/null` + `if !` 结构規避了探测失败导致脚本中止）。

### 测试改动面抽查

- `tests/unit/spec-driver/detect-codex-capability.test.ts`：断言强度高（精确 `toEqual` 而非模糊 `toBeTruthy`），覆盖七类 reason 全集 + 两类干扰行edge case + tab/单空格列宽变体，fixture 自包含（stdout 样例内联，无外部依赖），mock 边界与 `codex-proxy.test.ts` 保持一致手法。
- `tests/unit/model-literal-gate-core.test.ts`：用 `mkdtempSync` 构造临时 fixtureRoot 而非依赖仓库真实文件内容，避免了"改仓库文件导致测试联动失败"的脆弱性；与 `codex-plugin-consistency-core.test.ts` 手法一致。

## Info 级建议（非阻断，供后续参考）

1. `scripts/lib/model-literal-gate-core.mjs:12` — `MODEL_LITERAL_PATTERN` 是模块级共享 `RegExp`（`g` 标志），当前每次 `scanFile` 调用前手动 `lastIndex = 0` 规避了状态污染，行为正确；但如未来该模块被并发调用（如引入 worker 池）需注意共享可变状态风险。建议后续如需并发化可改为函数内 `new RegExp(...)` 局部实例，当前单线程场景下无需改动。
2. `src/core/model-selection.ts` 中 `resolveCodexModelDecision` 与 `resolveCodexExecutionConfig` 两者都会调用 `loadDriverConfig(cwd)`（前者内部一次，后者调用前者时又用同一 cwd 重新走一次 `loadDriverConfig`），存在一次可合并的重复配置加载。性能影响可忽略（install/CLI 场景非热路径），仅记录供未来性能敏感场景参考。
3. `plugins/spec-driver/scripts/codex-skills.sh` 新增 capability 探测调用块位于 `install_all()` 尾部、`opt-in --sync-plugin-distribution` 判断之前——语义上合理（先装 wrapper 再探测能力），但若未来 `install_all` 继续增长建议连同其余诊断类副作用一起提取为独立函数（如 `write_capability_sidecar()`），提升该函数的单一职责度。

## 与既有约定核对

- 未发现违反 `agent-code-quality.md` 简洁之道/零基思维原则的实现
- 未发现超出 spec 范围的额外改动（scope creep）
- shell 脚本保持 `set -euo pipefail`（继承文件头既有声明，未改动）
