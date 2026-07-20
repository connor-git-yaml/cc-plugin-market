> **发布版本**: v4.3.0

# Feature 213 — Codex Plugin 一体分发（A1）技术实施方案

**分支**: `claude/codex-plugin-distribution-2940d3` | **基线**: `origin/master` @ `2466905`
**输入**: `spec.md`（Approved，GATE_DESIGN 2026-07-20 已通过）、`_grounding.md`（含本机 codex 0.142.0 实测）、`clarifications.md`（2 条 NON-BLOCKING 建议澄清）
**状态**: Draft，供 GATE_TASKS 审查（尤其 OQ-004 落位方案与 skills-codex 命名）

---

## 1. 技术上下文

| 维度 | 取值 |
|------|------|
| **语言/运行时** | Node.js 20.x（`.mjs` ESM 脚本）+ Bash 5.x（`codex-skills.sh` 扩展）+ JSON（manifest）+ YAML（contract） |
| **新增依赖** | 0（复用 `plugins/spec-driver/scripts/lib/simple-yaml.mjs` 解析 YAML，复用 `fs`/`path`/`crypto` Node 内置模块） |
| **存储/持久化** | 纯文件系统制品（无数据库、无迁移） |
| **测试策略** | vitest 单元 + 集成（结构性断言，无 codex binary 依赖）+ 可选真 CLI e2e（本机 codex 0.142.0 / 0.145.0-alpha.18，CI 跳过） |
| **接入命令链** | `npm run repo:check` / `npm run repo:sync` / `npm run release:check` / `npm run release:sync`（不新增独立命令，FR-009） |
| **不确定项** | 无 BLOCKING `NEEDS CLARIFICATION`；2 条 clarifications 已用默认解释处理（见 §3.2、§3.7），不重开 |

**关键既有实现复用点**（已读取确认，见下文各决策引用）：
- `scripts/lib/repo-maintenance-core.mjs` 的 `aggregateValidation(prefix, result, warnings, errors, checks)` 聚合模式
- `scripts/lib/release-contract-core.mjs` 的 `expectEqual(id, label, actual, expected)` 累加器模式
- `plugins/spec-driver/scripts/codex-skills.sh` 的 `write_wrapper` 生成器 + F186 `extract-wrapper-body.mjs --sha256` 盖章链
- `plugins/spec-driver/scripts/validate-wrapper-sources.mjs` 的 `validateWrapperMarkers` 复算比对逻辑
- `plugins/spectra/scripts/sync-skill-mirrors.mjs` + `skill-source-of-truth.yaml` 的"多目标镜像"先例（虽是 Claude 侧 compat mirror，非 Codex 适配，但证明"一份 canonical source→多目标写入"模式在本仓已有惯例）

---

## 2. Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | PASS | plan/研究文档正文中文，JSON manifest 字段名英文，YAML key 英文 |
| II. Spec-Driven Development | 适用 | PASS | 本 feature 全程走 spec→plan→tasks→implement→verify |
| III. 如无必要勿增实体（YAGNI） | 适用 | PASS（带说明） | 新增组件均直接映射 FR：2 manifest（FR-001/002）、1 marketplace（FR-013）、1 矩阵模块（FR-007）、1 tracked 适配目录（FR-005）。未引入额外抽象层（如未新增"multi-runtime adapter registry"泛化框架，`skills-codex/` 只是既有生成器的第二写入目标，非新架构） |
| IV. 诚实标注不确定性 | 适用 | PASS（带标注） | `.codex-plugin/plugin.json` 的 `"skills"` 字段路径解析语义（相对插件根而非相对 `.codex-plugin/` 自身目录）基于 spec FR-004 既定事实与本机 2 份真实 manifest 采样，非规范文档逐字确认，本 plan 在 §4.1 标注 `[推断: 基于 spec 既定事实外推，样本量小]` |
| V. AST 精确性优先 | 不适用 | N/A | 本 feature 不涉及 Spectra 的代码结构化提取 |
| VI. 混合分析流水线 | 不适用 | N/A | 同上 |
| VII. 只读安全性 | 不适用 | N/A | 本 feature 修改的是仓库治理/分发脚本，不是 Spectra 对目标代码库的分析行为 |
| VIII. 纯 Node.js 生态 | 适用 | PASS | 新模块仅用 Node 内置 `fs`/`path` + 仓内既有 YAML parser，零新增 npm 包 |
| IX. Prompt 编排 + Harness 强制 | 适用 | PASS | 不改动任何 `agents/*.md` 编排决策逻辑；`codex-skills.sh` 扩展与新矩阵校验均属"辅助脚本"范畴 |
| X. 零运行时依赖 | 适用 | PASS | `codex-plugin-consistency-core.mjs` 属仓库级治理脚本（`scripts/lib/`），非随 plugin 安装的运行时代码；spec-driver 插件包内不新增任何 npm 依赖 |
| XI. 质量门控不可绕过 | 适用 | PASS（强化） | 本 feature 新增一致性矩阵门禁，直接强化该原则 |
| XII. 验证铁律 | 适用 | PASS | §6 测试策略提供结构性断言 + 可选真实 CLI 复核双层证据，非推测性声明 |
| XIII. 向后兼容 | 适用 | PASS（关键约束） | `.gitignore`/`SYMLINK_TARGETS` 收窄、`wrapper-source-of-truth.yaml` 扩展字段、`codex-skills.sh` 双写均为**加法变更**；`.codex/skills`、`.claude-plugin/**`、Claude 侧测试结果保持逐字节不变（FR-011） |
| XIV. 可观测性与架构守护 | 适用 | PASS | 新校验输出结构化 `{id,title,status,evidence}`；`validate-wrapper-sources.mjs` 扩展后预计增长 ~60-80 行，不逼近架构劣化阈值 |

**结论**：无 VIOLATION，无需豁免。

---

## 3. 架构设计（7 项关键决策）

### 3.1 决策 1 — OQ-004：Spec Driver Codex 适配 skills 目录落位方案

**候选方案比选**：

| 维度 | 方案 A：扩展 `codex-skills.sh` 增第二写入目标 `plugins/spec-driver/skills-codex/` | 方案 B：`.codex-plugin/` 内建 `skills/` 子目录 | 方案 C：新建独立生成脚本 |
|------|------|------|------|
| F186 sha 链兼容 | 完全复用：`write_wrapper_source_contract` 与 `write_skill_body` 均不依赖写入目标路径，两处产出字节级相同内容（含相同 `Source SHA256` 行） | 需重新验证 markdown 内嵌路径字符串（`Canonical source: $PLUGIN_DIR/skills/...`）是否仍准确；额外风险点 | 需重新实现 sha 计算逻辑或额外 import，双实现漂移风险（F186 T2 明确要规避的问题） |
| wrapper contract 扩展面 | `wrapper-source-of-truth.yaml` 加 1 个新顶层字段 `codexWrappers.pluginDistributionRoot`，`entries[]` 复用不变 | 需要新增平行的 `entries` 数组或复杂路径映射规则 | 需要全新 contract 文件，与既有 `wrapper-source-of-truth.yaml` 割裂，双重维护 |
| repo:sync 接线 | 复用既有 `spec-driver-codex-wrappers` runStep（`codex-skills.sh install`），零新增 step | 需要新 runStep + 新 import | 需要新 runStep + 新 import + 新脚本维护成本 |
| Claude 侧零影响 | 是（仅新增文件，不触碰 `.claude-plugin/**`、canonical `skills/**`） | 是 | 是 |
| **manifest 路径解析约束**（关键） | `plugins/spec-driver/.codex-plugin/plugin.json` 的 `"skills"` 字段按 FR-004 既定事实解析相对插件根（`plugins/spec-driver/`），`skills-codex/` 作为插件根下与 `skills/`、`hooks/`、`.codex-plugin/` 平级的兄弟目录，符合该解析语义 | 若 Codex 实际按"相对 manifest 自身文件所在目录"解析（`.codex-plugin/skills/`），两种解析假设都能满足；但若按 FR-004 已验证的"相对插件根"解析，`.codex-plugin/skills/` 会指向不存在的 `plugins/spec-driver/.codex-plugin/skills/`，与 spectra 侧已验证的解析语义矛盾，一致性风险高 | 视脚本自行放置位置而定，无天然优势 |
| A2 未来扩展性 | A2 落地新增 `spec-driver-refactor` 时，只需在 `SKILLS` 数组追加一项，双目标自动同步生成，`codex-plugin-consistency.yaml` 删除对应 waiver 条目即完成收口 | 同样可行，但因路径解析风险不确定，扩展前需先解决路径歧义 | 同上，且需在独立脚本中同步维护 |

**推荐**：**方案 A**——扩展 `plugins/spec-driver/scripts/codex-skills.sh`，在现有 `install_all()` 完成对 `$TARGET_DIR`（`.codex/skills` 或 `--global` 时的 `~/.codex/skills`，行为不变）的写入后，**仅在显式传入 `--sync-plugin-distribution` flag 时**追加一次**同内容复制**（非重新生成，避免逻辑分叉）到固定目标 `$PLUGIN_DIR/skills-codex/`：

**opt-in 设计动因（CRITICAL 修订，Codex 对抗审查 + 主编排器独立核实实锤）**：`tests/integration/spec-driver-codex-skills.test.ts` 用 `cwd: tempDir` 反复调用**同一份真实脚本**（`SCRIPT_PATH = resolve('plugins/spec-driver/scripts/codex-skills.sh')`，脚本路径固定，不是拷贝到 tempDir 的副本），而脚本内 `$PLUGIN_DIR` 恒由脚本自身物理位置派生（`SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"`），与调用方传入的 `cwd`/`--project-root` 无关。若 `sync_plugin_distribution_copy()` 在每次 `install` 时无条件执行，测试套件每次运行（`beforeEach`/多个 `it` 反复调用 `runScript(['install'], {cwd: tempDir})`）都会对**真实工作树**里 tracked 的 `plugins/spec-driver/skills-codex/` 做 `rm -rf` + 重写；测试进程若中断（超时、断言失败提前退出、CI kill），真实仓库会残留被删除或部分重写的 `skills-codex/` 脏树，需要手工 `git checkout` 才能恢复——这是本 feature 的一条真实回归风险，而非假设性担忧。因此该 copy 步骤必须与"生成 wrapper 到 `$TARGET_DIR`"解耦为独立、默认关闭的动作：

- 新增变量 `SYNC_PLUGIN_DIST="false"`（与现有 `MODE`/`ACTION` 同级初始化）；仅在参数解析循环中匹配到 `--sync-plugin-distribution` 时置 `"true"`，写法与既有 `--global`/`-g` 分支一致。**选用 CLI flag 而非环境变量**（二选一定死）：脚本当前的模式开关（`--global`）已是 flag 惯例，flag 在调用处显式可见、不依赖调用方记得预先 `export` 环境变量，且不会像环境变量那样可能被 shell 会话意外保留、污染后续无关调用。`usage()` 帮助文本同步补充该 flag 说明。
- `install_all()` 末尾改为条件调用：

```bash
# install_all() 末尾追加（伪代码，tasks 阶段落实）
sync_plugin_distribution_copy() {
  local dist_dir="$PLUGIN_DIR/skills-codex"
  rm -rf "$dist_dir"
  mkdir -p "$dist_dir"
  for skill in "${SKILLS[@]}"; do
    cp -R "$TARGET_DIR/$skill" "$dist_dir/$skill"
  done
}

install_all() {
  write_wrapper "spec-driver-constitution" "spec-driver-constitution"
  # ...（既有 8 条 write_wrapper 调用不变）
  write_wrapper "spec-driver-doc" "spec-driver-doc"

  # opt-in：仅显式 --sync-plugin-distribution 时才重写 tracked skills-codex/，
  # 避免测试套件以 cwd=tempDir 反复调用真实脚本时误删/重写真实工作树内容（CRITICAL 修订）
  if [[ "$SYNC_PLUGIN_DIST" == "true" ]]; then
    sync_plugin_distribution_copy
  fi

  echo "Spec Driver Codex skills 安装完成: $TARGET_DIR"
}
```

- `repo:sync` 的 `spec-driver-codex-wrappers` runStep（`scripts/lib/repo-maintenance-core.mjs` 的 `runSpecDriverCodexInstall`）是**唯一**需要触发该 copy 的调用方，改为 `execFileSync('bash', [scriptPath, 'install', '--sync-plugin-distribution'], {...})`；普通用户 `bash codex-skills.sh install`（项目/global 安装路径）与测试路径均不传该 flag，零触发，`skills-codex/` 内容只由 `npm run repo:sync` 驱动更新，与仓库"生成产物只由 sync 命令写入"的既有惯例一致。
- 选用 **copy-after-generate**（而非"再跑一次 `write_wrapper`"）：保证两份产物字节级相同（避免未来有人只改其中一处生成逻辑导致漂移），且减少一半的 `node extract-wrapper-body.mjs` 子进程调用。
- `remove_all()` **不**清理 `skills-codex/`（与 opt-in flag 无关，保持原判断不变）——它是随插件包分发的 tracked 内容，不是用户本地安装态，`codex:spec-driver:remove` 的语义（"移除我本地环境里的 wrapper"）不应波及仓库内容。
- `wrapper-source-of-truth.yaml` 新增字段：

  ```yaml
  codexWrappers:
    sourceRoot: "plugins/spec-driver/skills"
    targetRoot: ".codex/skills"                      # 既有：项目本地安装目标，行为不变
    pluginDistributionRoot: "plugins/spec-driver/skills-codex"  # 新增：tracked，随插件包分发
    generator: {...}                                  # 不变
    entries: [...]                                    # 不变，两个 root 共用同一份 entries id 列表
  ```
- `validate-wrapper-sources.mjs` 的 `validateWrapperMarkers(projectRoot, entries, errors)` 泛化为接受一个 `root` 参数与 `label`，对 `targetRoot`（既有 check id `codex-wrapper-markers`）与 `pluginDistributionRoot`（新 check id `codex-plugin-distribution-markers`）**各跑一次**，两者共用同一份 `entries[].id` 派生目标路径 `${root}/${id}/SKILL.md`。
- `plugins/spec-driver/.codex-plugin/plugin.json` 声明 `"skills": "./skills-codex/"`。

### 3.2 决策 2 — Spectra skills runtime-中立性验证

按 clarifications 澄清点 1 的默认解释，对 `plugins/spectra/skills/{spectra,spectra-batch,spectra-diff}/SKILL.md` 执行内容扫描：

```
grep -n "Task tool|mcp__plugin_|AskUserQuestion|Task\(" plugins/spectra/skills/**/*.md
```

**结果**：**零匹配**（详细扫描记录见 `research/spectra-skill-neutrality-scan.md`）。3 个 SKILL.md 均只引用：
- `spectra` CLI 命令（`spectra generate` / `spectra batch` / `spectra diff`，运行时中立）
- MCP 工具名裸调用示例（`panoramic-query`、`graph_query` 等，不含 `mcp__plugin_spectra_spectra__` 这类 Claude Code 命名空间前缀——SKILL.md 文档里工具名以简写形式出现，供人类/模型理解语义，不是 Claude 专属绑定字符串）

**结论**：**FR-004 假设成立，无需污染处理**。`plugins/spectra/.codex-plugin/plugin.json` 的 `"skills"` 字段可直接 `"./skills/"` 指向既有 canonical 目录，无需像 Spec Driver 那样生成独立适配目录。

**附加设计（超出 clarifications 建议范围，作为回归护栏）**：在新一致性矩阵中新增一条 **`warn` 级**检查 `spectra-skill-neutrality`，对 `plugins/spectra/skills/*/SKILL.md` 持续执行同一扫描逻辑，防止未来有人在 Spectra skill 文档中误引入 Claude 专属工具名而未察觉已破坏 Codex 直接复用路径。选用 `warn` 而非 `error`：避免误伤未来合法的、仅在解释性文字中提及"如在 Claude Code 中可用 XX"这类语境的内容，同时仍能提醒维护者复核。

### 3.3 决策 3 — 一致性矩阵模块设计

**契约文件** `contracts/codex-plugin-consistency.yaml`：

```yaml
schemaVersion: 1
manifests:
  spectra:
    codexManifestPath: "plugins/spectra/.codex-plugin/plugin.json"
    claudeManifestPath: "plugins/spectra/.claude-plugin/plugin.json"
    mcpConfigPath: "plugins/spectra/.mcp.json"
    canonicalSkillsRoot: "plugins/spectra/skills"
    skillSourceContract: "plugins/spectra/contracts/skill-source-of-truth.yaml"
  spec-driver:
    codexManifestPath: "plugins/spec-driver/.codex-plugin/plugin.json"
    claudeManifestPath: "plugins/spec-driver/.claude-plugin/plugin.json"
    canonicalSkillsRoot: "plugins/spec-driver/skills"
    wrapperSourceContract: "plugins/spec-driver/contracts/wrapper-source-of-truth.yaml"
marketplace:
  path: ".agents/plugins/marketplace.json"
  expectedPlugins:
    - name: "spectra"
      sourcePath: "./plugins/spectra"
    - name: "spec-driver"
      sourcePath: "./plugins/spec-driver"
waivers:
  - id: "spec-driver-refactor-codex-wrapper-gap"
    scope: "spec-driver"
    missingSkillIds:
      - "spec-driver-refactor"
    description: "spec-driver-refactor 尚无 Codex wrapper（9 canonical skill 对 8 codex 适配 wrapper 的已知缺口）。补齐属 M9 轨道 A2 范围，本 feature（213/A1）不处理。"
    tracking: "docs/design/milestone-M9-codex-trusted-live-graph.md §3 A2"
    removalCondition: "A2 落地新增 spec-driver-refactor 的 Codex wrapper 后删除本条目"
```

**合同 YAML 语法约束（CRITICAL 修订）**：`scripts/lib/codex-plugin-consistency-core.mjs` 与本仓其余 contract 校验模块共用同一手写解析器 `plugins/spec-driver/scripts/lib/simple-yaml.mjs`（已实锤：`scripts/lib/release-contract-core.mjs:3` 与 `plugins/spec-driver/scripts/validate-wrapper-sources.mjs:4` 均 `import { parseYamlDocument } from '.../simple-yaml.mjs'`）。该解析器的 `parseYamlScalar()` 只识别 `[]`（空数组字面量）与 `{}`（空对象字面量），**不支持带元素的内联数组**（如原草稿 `missingSkillIds: ["spec-driver-refactor"]`）——此类值会退化为普通字符串标量（整个 `["spec-driver-refactor"]` 被当作一段文本），而非数组，导致依赖 `.includes()`/`.length` 的差集判定逻辑在运行时静默出错或恒假。上方示例已改为块级序列写法。**新增显式约束**：`contracts/codex-plugin-consistency.yaml` 及本 feature 新增/修改的一切 YAML 内容，序列字段一律使用块级 `- ` 写法，禁止使用带元素的内联数组（`[]`/`{}` 空字面量除外）；此约束与本仓其余 contract YAML（`wrapper-source-of-truth.yaml`、`release-contract.yaml`、`skill-source-of-truth.yaml` 实测均未使用内联数组）现状一致，非新规矩，只是首次显式写明其成因（simple-yaml 解析器边界）。

**校验模块** `scripts/lib/codex-plugin-consistency-core.mjs`，导出 `validateCodexPluginConsistency({ projectRoot })`，返回 `{status, checks[], warnings[], errors[]}`，内部 check 项：

| check id | 校验内容 | 严重级别 |
|---|---|---|
| `manifest-exists:<plugin>` | `.codex-plugin/plugin.json` 存在且为合法 JSON | error |
| `no-hooks-field:<plugin>` | manifest 顶层 **MUST NOT** 含 `hooks` key（FR-006 回归护栏） | error |
| `mcp-servers-reference:spectra` | `manifest.mcpServers === "./.mcp.json"` 且 `.mcp.json` 含 `mcpServers.spectra` key（FR-003） | error |
| `skill-count:spectra` | `plugins/spectra/skills/` 下含 SKILL.md 的子目录数 === `skill-source-of-truth.yaml` `entries.length`（3） | error |
| `spectra-skill-neutrality` | 见决策 2 附加护栏 | **warn** |
| `skill-count:spec-driver-codex-dir` | `plugins/spec-driver/skills-codex/` 下子目录数 === `wrapper-source-of-truth.yaml` `entries.length`（8，精确匹配，不走 waiver——因为该目录本就是从 entries 派生，理应恒等） | error |
| `canonical-vs-codex-gap:spec-driver` | 计算 `canonicalIds \ codexAdaptedIds`（差集）；若差集非空，逐一在 `waivers[].missingSkillIds` 并集中查找覆盖；未覆盖部分才报 error，被覆盖部分记为 `waived` 并在 evidence 中列出 waiver id | error（未覆盖时）/ pass（全覆盖时，evidence 注明 waived 条目） |
| `marketplace-entries` | `.agents/plugins/marketplace.json` 存在、JSON 合法、`plugins[]` 恰好含 `spectra`/`spec-driver` 两条，`source.path` 与 `contracts/codex-plugin-consistency.yaml` `marketplace.expectedPlugins` 一致，且 `plugins/<name>/.codex-plugin/plugin.json` 真实存在 | error |

**接入 `validateRepository()`**（`scripts/lib/repo-maintenance-core.mjs`）：新增一行

```js
import { validateCodexPluginConsistency } from './codex-plugin-consistency-core.mjs';
// ...
aggregateValidation(
  'codex-plugin-consistency',
  validateCodexPluginConsistency({ projectRoot: resolvedRoot }),
  warnings, errors, checks,
);
```

紧邻既有 `spec-driver-wrappers` / `spectra-skills` check 之后插入，语义上属于同一族（分发面一致性）。

**接入 `release-contract.yaml` / `release-contract-core.mjs`**（FR-008）：产品条目新增 `codexPluginManifestPath`：

```yaml
products:
  spectra:
    # ...既有字段不变...
    codexPluginManifestPath: "plugins/spectra/.codex-plugin/plugin.json"
  spec-driver:
    # ...既有字段不变...
    codexPluginManifestPath: "plugins/spec-driver/.codex-plugin/plugin.json"
```

`syncReleaseContract()` 与 `validateReleaseContract()` 各自新增一段（紧邻现有 `pluginManifestPath` 处理块之后，逻辑完全对称）：

```js
if (product.codexPluginManifestPath) {
  const codexManifestPath = path.resolve(projectRoot, product.codexPluginManifestPath);
  const codexManifest = readJson(codexManifestPath);
  codexManifest.version = product.version;
  codexManifest.description = product.pluginDescription;   // 复用既有字段，不新增 contract 概念
  writeJson(codexManifestPath, codexManifest);
  touchedPaths.push(path.relative(projectRoot, codexManifestPath));
}
```

```js
if (product.codexPluginManifestPath) {
  const manifest = readJson(path.resolve(projectRoot, product.codexPluginManifestPath));
  expectEqual(`codex-plugin-version:${productId}`, `${productId} codex plugin manifest version`, manifest.version, product.version);
  expectEqual(`codex-plugin-description:${productId}`, `${productId} codex plugin manifest description`, manifest.description, product.pluginDescription);
}
```

`.agents/plugins/marketplace.json` **不**纳入 release-contract 的 `expectEqual` 链——本机实测的真实 schema（`{name, source, policy, category}`）**不含** version/description 字段（区别于 Claude 侧 `.claude-plugin/marketplace.json`），因此没有版本漂移风险需要跟踪；其正确性由上述 `marketplace-entries` 一致性矩阵 check 覆盖（存在性 + source.path 匹配）。

**`release:check` 薄壳接入矩阵（CRITICAL 修订，FR-009 合规）**：已读取 `scripts/validate-release-contracts.mjs`（`npm run release:check` 的真实入口）现状——该文件是一个约 20 行的极简顺序脚本：解析参数 → 调用 `validateReleaseContract(args.projectRoot)` → 按 `payload.status` 打印/设 `process.exitCode`，零抽象、不经过 `aggregateValidation`。原设计只把矩阵注册进 `validateRepository()`（`scripts/lib/repo-maintenance-core.mjs`，供 `repo:check` 使用），`release:check` 链路完全未接入——FR-009"接入既有 `npm run repo:check` **与** `npm run release:check` 命令链"字面不满足。修订：该薄壳同样调用 `validateCodexPluginConsistency({ projectRoot: args.projectRoot })`，**扁平合并**进 `validateReleaseContract()` 已有的 `{contractPath, status, checks, errors}` 输出结构（不新增嵌套字段），组合方式与该文件现有风格保持一致：

```js
import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { validateReleaseContract } from './lib/release-contract-core.mjs';
import { validateCodexPluginConsistency } from './lib/codex-plugin-consistency-core.mjs';

const args = parseCommonProjectArgs(process.argv.slice(2), { json: false });
const payload = validateReleaseContract(args.projectRoot);
const codexResult = validateCodexPluginConsistency({ projectRoot: args.projectRoot });

// 扁平合并（保持既有 JSON 输出形状 {contractPath, status, checks, errors} 不变，不引入嵌套字段，
// 避免破坏既有消费方对该 shape 的假设——见 tests/integration/release-contract-sync.test.ts 现有断言
// `JSON.parse(validate.stdout) as { status: string; errors: string[] }`）；check id 前缀风格
// 对齐 repo-maintenance-core.mjs 的 namespaceCheck（`${prefix}:${check.id}`），保持两条链路命名一致。
payload.checks = [
  ...payload.checks,
  ...codexResult.checks.map((c) => ({ ...c, id: `codex-plugin-consistency:${c.id}` })),
];
payload.errors = [
  ...payload.errors,
  ...codexResult.errors.map((e) => `[codex-plugin-consistency] ${e}`),
];
payload.status = payload.errors.length > 0 ? 'fail' : 'pass';

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else if (payload.status === 'pass') {
  console.log(`Release contract valid (${payload.contractPath})`);
} else {
  console.error(`Release contract invalid (${payload.contractPath})`);
  for (const error of payload.errors) {
    console.error(`- ${error}`);
  }
}

if (payload.status !== 'pass') {
  process.exitCode = 1;
}
```

**`repo:check`/`release:check` 双链各自独立调用矩阵是可接受设计**（幂等只读校验，一句话理由）：`validateCodexPluginConsistency` 是纯只读函数（仅读文件系统与 JSON/YAML，无副作用），本仓已有同构先例——`validateReleaseContract` 本身当前就被两条链**各自独立调用**一次（`validateRepository()` 内于 `scripts/lib/repo-maintenance-core.mjs:256` 直接调用一次；`scripts/validate-release-contracts.mjs` 内再独立调用一次），两次调用互不感知、无共享缓存，属于本仓既有惯例而非新引入的架构问题，`codex-plugin-consistency` 矩阵与此完全同构。

**关联测试 fixture 缺口**（本次修订一并核实，详见 §3.5 测试清单更新）：`tests/integration/release-contract-sync.test.ts` 与 `tests/integration/repo-maintenance-sync-check.test.ts` 的 `beforeEach` 均用 `mkdtempSync` 构造隔离 fixture 目录，`copyTree`/`copyFile` 只搬运各自测试场景需要的最小文件集，均**不包含**尚不存在的 `.codex-plugin/plugin.json`、`.agents/plugins/marketplace.json` 等 Codex 分发制品。一旦矩阵接入 `validateRepository()` 与 `validate-release-contracts.mjs`，这两个 fixture 若不同步补齐必要文件，会让矩阵在隔离 fixture 中因"文件缺失"报错，使这两个测试文件里现有的 `status === 'pass'` / `errors` 为空 的断言从当前的真实通过状态回归为假失败——这是本次矩阵接入引入的新前置条件，必须在同一批 tasks 中随测试扩展一并处理，不能只加新断言而不管现有断言是否还能过。

### 3.4 决策 4 — marketplace + `.agents` 收窄具体改法

**`.gitignore` 改动**（当前 `:59-60`）：

```diff
 .specify/scorecards/
 .specify/templates/
-.agents
-.agents/
+# Feature 213 — .agents/plugins/ 收窄放行（tracked Codex marketplace catalog）
+# 其余 .agents 内容（如 .agents/skills/ 本地个人资源）继续忽略
+.agents/*
+!.agents/plugins/
+!.agents/plugins/**
```

**语义验证**（3 场景）：
1. **fresh clone**：`.agents` 目录本不存在于工作区，`git checkout` 会按仓库 tree 正常物化 `.agents/plugins/marketplace.json`（因为它现在是 tracked blob，不受 ignore 规则影响——ignore 规则只对*未追踪*路径生效，对已 `git add` 的路径无效）；`.agents/skills/` 等其他内容因未被 tracked 且被 ignore 覆盖，不会被物化，符合预期（SC-006）。
2. **主仓（非 worktree）**：`.agents/skills/generate-readme`（用户本地个人资源，现状未 tracked）继续被 `.agents/*` 规则忽略（未被 `!.agents/plugins/**` 命中），行为不变；新增的 `.agents/plugins/marketplace.json` 因 tracked 而正常参与 git 操作。
3. **worktree**：见下方 SYMLINK_TARGETS 调整，`.agents/plugins/` 完全由 git checkout 提供（每个 worktree 独立、真实），不经过 symlink 机制，天然不会被同步脚本覆盖或写穿污染主仓。

**`scripts/sync-worktree-local-state.sh` 改动**：

```diff
 SYMLINK_TARGETS=(
   ".claude/settings.local.json"
   ".specify/.spec-driver-path"
-  ".agents"
+  ".agents/skills"
   "node_modules"
   "_reference"
   "CLAUDE.local.md"
 )
```

`link_path()` 函数逻辑无需改动：目标从整目录 `.agents` 收窄为子目录 `.agents/skills` 后，`mkdir -p "$(dirname "$target_path")"` 会在 `.agents/plugins/` 已作为真实 tracked 目录存在时正常创建/复用 `.agents/` 作为父目录，再在其内新建 `skills` 软链，与 tracked 的 `plugins/` 子目录相安无事、互不覆盖。

**已有 `.agents/skills/generate-readme`（主仓用户本地资产）迁移兼容性**：无需任何迁移动作——该资源今天已经是"gitignored + 整目录 symlink 到主仓"，改动后变成"gitignored + 子目录（`.agents/skills`）symlink 到主仓"，对该资源本身的可见性、路径、内容零影响，唯一变化是它现在与一个新的 tracked 兄弟目录（`.agents/plugins/`）共存于同一父目录下。

**本 worktree（`codex-plugin-distribution-2940d3`）当前 `.agents` 是整目录 symlink 的过渡处理**（implement 阶段必须严格按此顺序执行，避免写穿污染主仓——这是本 feature 最高操作风险点，见 §7 风险 1）：

```bash
# 1. 确认当前状态（应输出主仓绝对路径）
readlink .agents

# 2. 仅删除符号链接本身（不触碰其指向的主仓真实内容）
rm .agents

# 3. 本地新建真实目录并落地 tracked 文件
mkdir -p .agents/plugins
# （写入 .agents/plugins/marketplace.json 内容，implement 阶段产出）

# 4. 更新 .gitignore + sync-worktree-local-state.sh（本 plan 决策的改动）

# 5. 重跑同步脚本，验证 .agents/skills 被建为指向主仓的软链，
#    .agents/plugins 保持为本 worktree 的真实 tracked 内容（不被脚本覆盖）
bash scripts/sync-worktree-local-state.sh --dry-run   # 先 dry-run 确认计划动作
bash scripts/sync-worktree-local-state.sh

# 6. 验证：
ls -la .agents/                      # plugins/ 应为真实目录，skills/ 应为 symlink
git status .agents/                  # 应只看到 .agents/plugins/marketplace.json 待添加
readlink .agents/skills              # 应指向主仓 .agents/skills（若主仓已有该资源）

# 7. 确认主仓不受影响（主仓此时尚无 marketplace.json，直到本 feature 合并回 master
#    后主仓才会在下次 git pull 后自然获得该 tracked 文件——这是正常 git 传播路径，
#    不依赖也不经过 symlink 机制）
```

不做 `.worktreeinclude` 层面的更大范围重构（遵循 spec Non-Goals 与 GATE_DESIGN OQ-002 裁决边界）。

### 3.5 决策 5 — 测试与 E2E 策略（FR-010 双层）

**结构性断言测试**（vitest，无 codex binary 依赖，CI 必跑）：

1. `tests/unit/codex-plugin-consistency-core.test.ts`：`validateCodexPluginConsistency` 单元测试
   - happy path 全 pass
   - manifest 缺失 / JSON 非法 → error
   - manifest 含 `hooks` key → error（回归护栏）
   - `.mcp.json` 缺 `spectra` server 或 `mcpServers` 字段值不匹配 → error
   - spec-driver skill 数量不一致（无 waiver 覆盖）→ error；被 waiver 精确覆盖 → pass 且 evidence 含 `waived: [...]`
   - marketplace 条目缺失/`source.path` 不匹配 → error
   - spectra SKILL.md 人为注入 `mcp__plugin_` 字符串 → `spectra-skill-neutrality` 报 warn（非 error）
2. `tests/integration/codex-plugin-manifest.test.ts`：对**真实**两份 `.codex-plugin/plugin.json` 做结构性断言——JSON 合法、必需字段齐全、`mcpServers`/`skills` 字段值与文件系统实际路径吻合、无 `hooks` 字段（这是 FR-010(a) 的必选基础路径，验证真实制品而非 mock）
3. `tests/integration/codex-plugin-marketplace.test.ts`：对真实 `.agents/plugins/marketplace.json` 做结构性断言——2 条目、`source.path` 解析后目录存在且含 `.codex-plugin/plugin.json`
4. 扩展 `tests/integration/spec-driver-codex-skills.test.ts`（与决策 1 的 opt-in flag 语义对齐）：
   - `install --sync-plugin-distribution`（在 tempDir fixture 副本上执行，**不**对真实仓库跑带 flag 安装）后断言 fixture 内 `plugins/spec-driver/skills-codex/` 8 个目录全部生成、内容与同次生成的 `.codex/skills` 对应文件字节相同（验证 copy-after-generate）；
   - **无 flag 守护用例（CRITICAL 修订核心）**：普通 `install`（cwd=tempDir，不传 flag）执行前后，断言**真实仓库** `plugins/spec-driver/skills-codex/` 内容零变化（快照比对），锚定"测试/用户路径零触发 tracked 目录重写"的回归护栏；
   - 断言 `remove` 后 `skills-codex/` **不**受影响（regression guard，防止未来有人误把清理逻辑扩展到该目录）
5. 扩展 `tests/unit/sync-worktree-local-state.test.ts`：现有用例`.agents 目录应软链到父仓库`（第 83-94 行）改为对 `.agents/skills` 子目录断言（`primaryDir/.agents/skills` 建内容 → 断言 `worktreeDir/.agents/skills` 为 symlink），这是本 feature **必须**同步修复的既有回归点（决策 4 直接影响该测试的前提假设）
6. 扩展 `tests/integration/repo-maintenance-sync-check.test.ts`：断言 `validateRepository()` 返回的聚合 `checks[]` 中含 `codex-plugin-consistency:*` 前缀条目
7. 扩展 `tests/integration/release-contract-sync.test.ts`：断言 `syncReleaseContract`/`validateReleaseContract` 覆盖新增 `codexPluginManifestPath` 字段（version/description 同步 + 漂移检出）

**可选真实 CLI E2E**（本机具备 codex 0.142.0 / 0.145.0-alpha.18，CI 通常无 binary，遵循 FR-010(b) "SHOULD 而非唯一路径"）：

- `tests/e2e/feature-213-codex-plugin-install.e2e.test.ts`：`beforeAll` 探测 `which codex`（`execFileSync('which', ['codex'])` try/catch），无 binary 时全套 `it.skip`（沿用仓库既有 `tests/e2e/*.e2e.test.ts` 命名与跳过惯例，如 `feature-170a-spectra-spec-driver-integration.e2e.test.ts`）；有 binary 时（**CRITICAL 修订：全程不以真实 worktree 路径注册全局状态，marketplace 源用 fixture 副本 + 测试专属随机名 + try/finally 完整逆序清理**）：
  1. `mkdtempSync` 建临时 marketplace 源目录，**copy fixture 副本**进去：`plugins/spectra/`、`plugins/spec-driver/`（含各自 `.codex-plugin/`、`.mcp.json`、`skills/`、`skills-codex/`）与 `.agents/plugins/marketplace.json`——marketplace 源指向该临时副本而非真实 worktree，杜绝"worktree 删除后全局残留悬空注册"
  2. marketplace.json 副本中的 `name` 改写为测试专属随机名（如 `cc-plugin-market-e2e-<随机后缀>`），防与开发者已有注册撞名/互相覆盖
  3. `codex plugin marketplace add <临时副本路径>`
  4. `codex plugin add spectra@<测试market名>` / `codex plugin add spec-driver@<测试market名>`
  5. `codex plugin list --json` 断言两个 plugin `status` 含 `installed`
  6. `codex mcp list --json` 断言 `spectra` server 已注册（Cwd 指向 plugin cache 路径）
  7. 清理（`afterAll` + `try/finally` 双保险，断言失败也执行）**逆序完整**：`codex plugin remove spectra@<测试market名>` → `codex plugin remove spec-driver@<测试market名>` → **`codex plugin marketplace remove <测试market名>`**（此前设计缺此步，会泄漏全局 `~/.codex` 注册）→ `rmSync` 临时目录；每步失败不中断后续清理（逐步 try/catch 记 warning）
- **不**纳入 `npx vitest run` 的默认 CI gate 判据（沿用现有 e2e 目录的 skip 惯例，`package.json` 若有独立 `test:e2e` script 则挂载于此，否则维持随 `vitest run` 一并跑但 skip 的现状，不新增命令，遵循 FR-009"不新增独立命令"精神）

**双运行时回归**（FR-011）：不新增/修改任何断言 `.claude-plugin/**`、canonical `skills/**`、`.mcp.json` 内容、`hooks/hooks.json` 内容的既有测试；implement 完成后运行 `npx vitest run` 全量套件，确认涉及上述路径的既有用例通过结果与改动前逐一比对一致（不新增失败，也不因改动"意外变绿"）。

**FR ↔ 矩阵 check ↔ 测试 三向覆盖对照**（Codex 审查中断前指出"另有门禁覆盖缺口"，此表为收口产物；每条 FR 至少一个 check 或测试锚定）：

| FR | 矩阵 check 锚点 | 测试锚点 | 缺口处置 |
|---|---|---|---|
| FR-001（spectra manifest） | `manifest-exists:spectra` | 结构性 #2 | 覆盖 |
| FR-002（spec-driver manifest） | `manifest-exists:spec-driver` | 结构性 #2 | 覆盖 |
| FR-003（mcpServers 引用） | `mcp-servers-reference:spectra` | 结构性 #1/#2 + e2e 步骤 6 | 覆盖 |
| FR-004（spectra skills 直用 canonical） | `skill-count:spectra` + `spectra-skill-neutrality`(warn) | 结构性 #1/#2 | 覆盖 |
| FR-005（spec-driver skills-codex） | `skill-count:spec-driver-codex-dir` + wrapper 校验新 check `codex-plugin-distribution-markers` | 结构性 #4（含无 flag 守护） | 覆盖 |
| FR-006（无 hooks 字段） | `no-hooks-field:<plugin>` | 结构性 #1/#2 | 覆盖 |
| FR-007（矩阵进 validateRepository） | —（自身即 check 族） | 结构性 #6 | 覆盖 |
| FR-008（release-contract expectEqual） | `codex-plugin-version/description:<product>`（release 链） | 结构性 #7 | 覆盖 |
| FR-009（双 check 链接入） | repo:check 经 aggregateValidation；release:check 经薄壳直调（CRITICAL 修订 #3） | 结构性 #6/#7 + **补**：`tests/integration/release-contract-sync.test.ts` 增一条断言 `validate-release-contracts.mjs` 输出含 `codex-plugin-consistency` 条目 | **原缺口，已补测试条目** |
| FR-010（双层机械确认） | —（策略性 FR） | 结构性 #1-#3（必选层）+ e2e（可选层） | 覆盖 |
| FR-011（Claude 侧零变化） | —（不变量 FR） | 双运行时回归段 + SC-005 比对流程 | 覆盖 |
| FR-012（waiver） | `canonical-vs-codex-gap:spec-driver`（waiver 折算） | 结构性 #1（waiver 覆盖/未覆盖双分支）+ **补**：waiver 移除模拟用例（fixture 删 waivers 段 → 断言差集报 error，锚定"A2 删 waiver 后矩阵能检出真实缺口"，checklist ⚠️#2 对应项） | **原缺口，已补测试条目** |
| FR-013（marketplace + 收窄） | `marketplace-entries` | 结构性 #3/#5 + e2e 步骤 3-5 + SC-006（fresh clone/跨 worktree） | 覆盖 |
| —（e2e market 名一致性，候选缺口） | 不入矩阵：市场名是**安装时用户输入**（`marketplace add` 以源目录 marketplace.json `name` 注册），仓库侧唯一事实源就是 marketplace.json 本身，`marketplace-entries` 已校验其存在与条目；e2e 步骤 2/4 用同一随机名自闭环 | e2e 步骤 2/4 | 论证后不设 check |
| —（manifest `interface` 字段，候选缺口） | 不入矩阵：可选展示字段，无 canonical source 对应物（release-contract 无此概念），入矩阵会造出第二事实源；留 A 轨后续按需引入 | — | 论证后不设 check |

### 3.6 决策 6 — 改动文件全景清单

**新增文件（18）**：

| 文件 | 动因（FR） | 风险 |
|---|---|---|
| `plugins/spectra/.codex-plugin/plugin.json` | FR-001, FR-003, FR-004, FR-006 | 低（纯新增 JSON，Claude 侧零引用） |
| `plugins/spec-driver/.codex-plugin/plugin.json` | FR-002, FR-005, FR-006 | 低 |
| `.agents/plugins/marketplace.json` | FR-013 | **中**（需先解除本 worktree symlink，见决策 4） |
| `contracts/codex-plugin-consistency.yaml` | FR-012 | 低 |
| `scripts/lib/codex-plugin-consistency-core.mjs` | FR-007 | 低（新模块，不改既有调用方签名） |
| `plugins/spec-driver/skills-codex/{8 skill}/SKILL.md`（生成产物，8 个文件） | FR-005 | 低（由既有生成器 copy-after-generate 产出，内容与 `.codex/skills` 字节相同） |
| `tests/unit/codex-plugin-consistency-core.test.ts` | 测试覆盖 §6 | 低 |
| `tests/integration/codex-plugin-manifest.test.ts` | FR-010(a) | 低 |
| `tests/integration/codex-plugin-marketplace.test.ts` | FR-010(a), FR-013 | 低 |
| `tests/e2e/feature-213-codex-plugin-install.e2e.test.ts` | FR-010(b) | 低（gated skip，无 binary 不跑） |
| `specs/213-codex-plugin-distribution/research/spectra-skill-neutrality-scan.md` | clarifications 澄清点 1 证据留存 | 无 |

**修改文件（13）**：

| 文件 | 改动点 | 动因（FR） | 风险 |
|---|---|---|---|
| `.gitignore` | `.agents`/`.agents/` → `.agents/*` + `!.agents/plugins/**` | FR-013 | **中**（收窄不当会误放行不该 track 的内容，或误继续忽略 marketplace.json） |
| `scripts/sync-worktree-local-state.sh` | `SYMLINK_TARGETS` 中 `.agents` → `.agents/skills` | FR-013 | **中**（影响所有 worktree 的本地态同步行为，需回归测试） |
| `plugins/spec-driver/scripts/codex-skills.sh` | `install_all()` 追加 copy-after-generate 到 `skills-codex/`；`remove_all()` 保持不变（不清理该目录） | FR-005 | 中（改动核心分发脚本，需保证 `.codex/skills` 现状行为逐字节不变） |
| `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` | 新增 `codexWrappers.pluginDistributionRoot` 字段 | FR-005 | 低（加法字段） |
| `plugins/spec-driver/scripts/validate-wrapper-sources.mjs` | `validateWrapperMarkers` 泛化 + 对 `pluginDistributionRoot` 追加一次调用 | FR-005 | 中（核心校验逻辑改动，需保持既有 `codex-wrapper-markers` check 行为不变） |
| `scripts/lib/repo-maintenance-core.mjs` | 新增 import + `validateRepository()` 内一行 `aggregateValidation('codex-plugin-consistency', ...)` | FR-007, FR-009 | 低（既有聚合模式，加法） |
| `contracts/release-contract.yaml` | `products.spectra`/`products.spec-driver` 新增 `codexPluginManifestPath` | FR-008 | 低 |
| `scripts/lib/release-contract-core.mjs` | `syncReleaseContract`/`validateReleaseContract` 各新增一段（对称既有 `pluginManifestPath` 处理块） | FR-008 | 低（加法块，不改既有分支） |
| `scripts/validate-release-contracts.mjs` | 薄壳追加直调 `validateCodexPluginConsistency` 并扁平合并输出/exit code（CRITICAL 修订 #3，FR-009 release:check 链真接入） | FR-009 | 低（顺序脚本加一段，不改既有调用） |
| `tests/unit/sync-worktree-local-state.test.ts` | `.agents` 整目录测试 → `.agents/skills` 子目录测试 | 决策 4 回归修复 | 低（既有测试必须同步更新，否则会假失败） |
| `tests/integration/spec-driver-codex-skills.test.ts` | 新增 `skills-codex/` 双写断言 | FR-005 | 低 |
| `tests/integration/repo-maintenance-sync-check.test.ts` | 新增 check 存在性断言 | FR-007 | 低 |
| `tests/integration/release-contract-sync.test.ts` | 新增 codex manifest 字段同步/漂移断言 | FR-008 | 低 |

**明确不碰的文件/范围**：
- `scripts/eval*`、`classify-oracle` 相关脚本（与本 feature 无关）
- A2 范围：不新增 `spec-driver-refactor` 的任何 wrapper 或 SKILL.md
- A3 范围：不新增任何 Codex hooks payload E2E、apply_patch 合同、`PLUGIN_ROOT` 相关逻辑
- A4 范围：不改 `CODEX_HOME` 解析逻辑
- `.claude-plugin/**`（两份 `plugin.json` + 根 `marketplace.json`）——只读引用（release-contract 校验已覆盖，不新增写入）
- `plugins/*/skills/**` canonical 内容——只读引用，零文本改动
- `.mcp.json`、`plugins/*/hooks/hooks.json`——只读引用

### 3.7 决策 7 — Constitution / 护栏对齐

**F186 sha 门禁保持绿的证明路径**：
- `validate-wrapper-sources.mjs` 现有 `codex-wrapper-markers` check（针对 `.codex/skills`）逻辑零改动，只是被泛化函数以相同参数再调用一次；单元/集成测试新增用例专门断言两个 check（`codex-wrapper-markers` + `codex-plugin-distribution-markers`）在同一次 `npm run repo:check` 中都为 pass。
- copy-after-generate（而非二次生成）保证 `skills-codex/` 内容与 `.codex/skills` **逐字节相同**，包括其中内嵌的 `Source SHA256` 行，因此校验逻辑对两处的 sha 复算比对结果必然一致，不存在"target 变了但 sha 计算方式没跟上"的分裂风险。

**Release 受控行只经 contract + release:sync 改**：
- 两份 `.codex-plugin/plugin.json` 的 `version`/`description` 字段自实现起就通过 `contracts/release-contract.yaml` 驱动的 `syncReleaseContract`/`validateReleaseContract` 管理，不允许在 implement 阶段手工编辑这两个字段的初始值——初始值应通过跑一次 `npm run release:sync` 生成，而非手写 JSON 时硬编码后再"恰好对上"。

**通用定位零客户信息**：
- 两份新 manifest 与 marketplace catalog 内容均为纯产品/技术描述，复用现有 `.claude-plugin/plugin.json` 的 `author`/`homepage`/`repository`/`keywords` 字段值（已通用化，无客户/行业绑定），`plan.md`/`research.md` 正文同样保持通用抽象，不引入具体客户案例。

**版本号策略——结论：本 feature 不 bump 版本，两份 codex manifest 直接对齐当前 contract 版本 `4.3.0`**：
- **理由 1（Non-Goals 边界）**：spec 明确"不做版本/metadata 手改"，且本仓版本号历史上是**批量语义化**的（如 v4.3.0 汇总 F175-F196 多个 feature 的变更说明），不是每个 feature 单独触发一次 bump；F204/F205/F210 等近期 feature 落地时均未各自触发版本号变更。
- **理由 2（范围收敛）**：若本 feature 顺带 bump 版本，将牵动 `package.json`/`package-lock.json`/两份 README/`product-mapping.yaml`/根 `marketplace.json` 等一整条 `release:sync` 触达面，超出 A1"新增 Codex 分发能力"这一单一关注点，人为放大 blast radius 与 review 负担。
- **理由 3（架构正确性）**：通过把新字段纳入同一份 `contracts/release-contract.yaml` 驱动链，未来任何一次版本 bump（无论是否因本 feature 而触发）都会自动级联同步到两份 Codex manifest，零额外维护成本——这正是"contract 驱动、不手改"防漂移设计的意义所在，无需在本 feature 内抢跑。
- 若后续（如与 A2 一并）决定发布新版本，届时由该次发布决策统一触发 `release:sync`，两份 Codex manifest 会随之自动更新，无需回头修改本 feature 引入的任何代码。

---

## 4. 架构图

```mermaid
graph TD
  subgraph CANON["Canonical Sources（唯一事实源）"]
    RC["contracts/release-contract.yaml"]
    WST["plugins/spec-driver/contracts/wrapper-source-of-truth.yaml"]
    SST["plugins/spectra/contracts/skill-source-of-truth.yaml"]
    CPC["contracts/codex-plugin-consistency.yaml (waivers)"]
  end

  subgraph CLAUDE["Claude Runtime（不变，只读引用）"]
    CM1[".claude-plugin/plugin.json (spectra)"]
    CM2[".claude-plugin/plugin.json (spec-driver)"]
    CMK[".claude-plugin/marketplace.json"]
    SKS1["plugins/spectra/skills/"]
    SKS2["plugins/spec-driver/skills/ (9 canonical)"]
  end

  subgraph CODEX["Codex Runtime（新增，A1）"]
    CX1["plugins/spectra/.codex-plugin/plugin.json"]
    CX2["plugins/spec-driver/.codex-plugin/plugin.json"]
    CXM[".agents/plugins/marketplace.json"]
    SK2C["plugins/spec-driver/skills-codex/ (8, tracked)"]
    MCPCFG["plugins/spectra/.mcp.json"]
    LEGACY[".codex/skills/ (8, 项目本地，行为不变)"]
  end

  RC -->|version/description sync| CM1
  RC -->|version/description sync| CM2
  RC -.->|新增: version/description sync| CX1
  RC -.->|新增: version/description sync| CX2

  WST -->|生成: codex-skills.sh install| LEGACY
  WST -.->|新增: copy-after-generate| SK2C

  CX1 --> MCPCFG
  CX1 -->|"./skills/" (直接复用, 决策2确认中立)| SKS1
  CX2 -->|"./skills-codex/"| SK2C
  CXM --> CX1
  CXM --> CX2

  subgraph GOV["治理链（repo:check / release:check）"]
    RMC["repo-maintenance-core.mjs::validateRepository()"]
    CPCC["codex-plugin-consistency-core.mjs (新增)"]
    RCC["release-contract-core.mjs"]
    VWS["validate-wrapper-sources.mjs (泛化)"]
  end

  RMC --> CPCC
  RMC --> RCC
  RMC --> VWS
  CPCC -.reads.-> CPC
  CPCC -.reads.-> CX1
  CPCC -.reads.-> CX2
  CPCC -.reads.-> CXM
  CPCC -.reads.-> SKS1
  CPCC -.reads.-> SK2C
  VWS -.reads.-> LEGACY
  VWS -.reads.-> SK2C
  RCC -.reads.-> CX1
  RCC -.reads.-> CX2
```

---

## 5. Complexity Tracking

| 偏离项 | 理由 | 是否必须 |
|---|---|---|
| 新增独立契约 YAML `codex-plugin-consistency.yaml`（而非把 waiver 塞进既有 `wrapper-source-of-truth.yaml`） | GATE_DESIGN OQ-001 已裁定的形态；且该矩阵需要跨 2 个 plugin + marketplace 的信息，放进任一单 plugin 的 contract 会造成语义错位 | 必须（spec FR-012 已固化） |
| `codex-skills.sh` 双目标写入（而非只写一处再由 CI 事后 diff-copy） | 保证生成与 sha 计算路径单一（copy-after-generate 而非二次生成），避免未来单独修改任一路径造成漂移 | 必须（决策 1 论证） |
| `.gitignore` 用 `!pattern/**` 双重否定规则而非单一 `!pattern/` | Git 语义：仅 `!.agents/plugins/` 不足以取消其内部文件的忽略状态（父目录未被否定时子路径仍继承祖先忽略规则的边界情况需要显式覆盖），需要 `!.agents/plugins/` + `!.agents/plugins/**` 组合确保目录与内容均可追踪 | 必须（Git 官方 gitignore 语义要求） |

---

## 6. 风险与缓解（详见各决策小节，此处汇总 Top 3）

1. **`.agents` 从整目录 symlink 过渡为"真实目录 + 收窄 symlink"的操作序列风险**（本 feature 最高风险点）：若在解除 symlink 前就尝试写入 `.agents/plugins/marketplace.json`，会写穿到主仓（`PRIMARY_ROOT/.agents/plugins/marketplace.json`），既污染主仓工作区，又因主仓该路径未被其他 worktree 感知而导致状态不一致。**缓解**：implement 阶段严格执行决策 4 给出的 7 步操作序列，每步前置 `readlink`/`git status` 复核，禁止跳步；tasks.md 中该步骤须标记为独立、有明确验收断言的 task。
2. **`codex-skills.sh` / `validate-wrapper-sources.mjs` 核心分发脚本改动引入回归**：这两个脚本是 F186 已验证生效的防漂移链路核心，泛化重构存在破坏既有 `.codex/skills` 行为的风险。**缓解**：采用纯加法式改动（新增函数/参数，不修改既有函数签名与调用路径的默认行为）；`tests/integration/spec-driver-codex-skills.test.ts` 保留全部既有断言不删除，只追加新用例；implement 完成后需确认该测试文件的既有断言逐条仍然通过（非仅新增用例通过）。
3. **Codex manifest `"skills"` 字段路径解析语义的样本量风险**：当前对"路径相对插件根解析"的判断基于 spec FR-004 既定事实与本机对 2 份第三方 manifest 的实测采样，若实际 Codex 运行时解析规则与假设不同（如相对 `.codex-plugin/` 自身目录解析），本 feature 产出的两份 manifest 在结构性测试（自我一致，不依赖外部真值）中会全部通过，但在真实 `codex plugin add` 时不可用——**结构性测试无法暴露此类"假设本身错误"的风险**。**缓解**：§3.5 设计的可选真实 CLI E2E（FR-010(b)）不能仅停留在"设计存在"，implement/verify 阶段**必须**在本机（已确认具备 codex 0.142.0/0.145.0-alpha.18）至少手动跑通一次 `codex plugin marketplace add` → `codex plugin add` → `codex plugin list --json` 全链路，作为该假设的真实验证，并将结果记录进 `verification-report.md`（而非仅在 CI 里默认 skip 后就视为已验证）。
4. **E2E 触碰开发者全局 `~/.codex` 状态**（Codex 审查实锤后已在 §3.5 设计层缓解）：真实 CLI E2E 必然写入全局 marketplace 注册与 plugin cache。**缓解**：marketplace 源用 mkdtemp fixture 副本（非 worktree 真实路径）+ 测试专属随机 market 名 + try/finally 逆序完整清理（plugin remove ×2 → **marketplace remove** → rm 临时目录）；实施时该清理链是验收断言的一部分，不是可选注释。

---

## 7. 实施顺序建议（供 tasks 分解参考）

1. **前置**：本 worktree `.agents` symlink 解除 + `.gitignore`/`SYMLINK_TARGETS` 收窄（决策 4 步骤 1-7），落地空的 `.agents/plugins/` 目录结构，先跑 `tests/unit/sync-worktree-local-state.test.ts`（更新后）确认回归绿。
2. **`wrapper-source-of-truth.yaml` 扩展字段 + `codex-skills.sh` opt-in 双写实现 + `validate-wrapper-sources.mjs` 泛化**，跑 `npm run repo:sync`（其 runStep 已带 `--sync-plugin-distribution` flag；普通 `install` 按 opt-in 语义**不**产出）产出 `plugins/spec-driver/skills-codex/` 8 个文件；扩展 `tests/integration/spec-driver-codex-skills.test.ts` 验证（含无 flag 守护用例）。
3. **两份 `.codex-plugin/plugin.json` 手工起草初稿** → 立即接入 `contracts/release-contract.yaml` + `release-contract-core.mjs` → 跑 `npm run release:sync` 用 contract 驱动写入正式 version/description（不手工硬编码最终值）。
4. **`.agents/plugins/marketplace.json` 落地**（tracked 内容）。
5. **`contracts/codex-plugin-consistency.yaml` + `scripts/lib/codex-plugin-consistency-core.mjs` 实现** → 接入 `validateRepository()` → 跑 `npm run repo:check` 至全绿。
6. **补齐 §3.5 全部结构性测试**（单元 + 集成），确认 `npx vitest run` 全量零失败。
7. **可选真实 CLI E2E**：本机手动跑通一次全链路（风险 3 缓解措施），记录进 verification-report。
8. **回归确认**：Claude 侧既有测试结果与改动前逐一比对（FR-011），完整跑 `npm run build` + `npm run repo:check` + `npm run release:check`。

---

## 8. 待 GATE_TASKS 复核的关键点

- 决策 1（OQ-004 方案 A：`skills-codex/` 目录名与 copy-after-generate 机制，含 **opt-in `--sync-plugin-distribution` flag**——tracked 目录只由 `npm run repo:sync` 驱动重写，用户/测试普通 `install` 零触发）——spec 已将决策权移交 plan 阶段，本节是需要用户在 GATE_TASKS 时明确确认的核心工程方案。
- 决策 4 第 7 步操作序列（本 worktree symlink 解除的具体时机与验证方式）是否需要拆成独立的、可单独回滚的 task。
- Codex 对抗审查 4 项 CRITICAL 的修订落点（E2E fixture 副本+完整清理 / opt-in flag / release:check 薄壳直调矩阵 / 合同 YAML 块级序列约束）——已全部写入 §3.1/§3.3/§3.5，GATE_TASKS 一并过目。
