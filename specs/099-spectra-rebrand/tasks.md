---
feature: "099-spectra-rebrand"
title: "品牌重命名 reverse-spec → Spectra — 任务清单"
created: "2026-04-12"
status: "Ready"
---

# 任务清单：品牌重命名 reverse-spec → Spectra

> 所有任务按依赖顺序排列。标注 `[可并行]` 的任务块内各任务可同时执行。

---

## Phase 1：审计脚本

- [x] Task 1：创建 `scripts/audit-rename.sh` 审计脚本
  - **描述**：编写 bash 脚本，使用 `grep -r` 或 `rg`（如可用）扫描全仓库 `reverse-spec` 引用，排除豁免目录（`dist/`、`.git/`、`node_modules/`、`CHANGELOG*`、`specs/`），输出残留引用文件列表和行数统计。脚本需 `set -euo pipefail`，可执行权限 755。
  - **影响文件**：`scripts/audit-rename.sh`（新建）
  - **验证**：`bash scripts/audit-rename.sh` 运行无报错，输出当前全量引用列表（作为 Phase 1 基准快照保存或对比）

---

## Phase 2：release-contract.yaml 更新

- [x] Task 2：更新 `contracts/release-contract.yaml` — 版本号与品牌字段
  - **描述**：修改 release-contract.yaml 中 `products.reverse-spec` 区块：`displayName` 改为 `"Spectra"`；`version` 改为 `"3.0.0"`；`pluginManifestPath` 改为 `plugins/spectra/.claude-plugin/plugin.json`；`pluginReadmePath` 改为 `plugins/spectra/README.md`；`productMappingKey` 改为 `"spectra"`；三个 description 字段中的品牌说明全部更新为 Spectra。注意：暂不改键名 `products.reverse-spec`，等确认 `sync-release-contracts.mjs` 的键名依赖后再决定。
  - **影响文件**：`contracts/release-contract.yaml`
  - **验证**：`cat contracts/release-contract.yaml` 确认 version 为 3.0.0，displayName 为 Spectra

- [x] Task 3：运行 `npm run release:sync` 同步受控下游文件
  - **描述**：执行 release:sync，让 `package.json` 的 `name`（→ `spectra-cli`）、`version`（→ `3.0.0`）、`description` 以及 `package-lock.json` 等受控字段自动更新。执行后检查 `package.json` 确认 `name` 和 `version` 已更新。
  - **前置**：Task 2 完成
  - **影响文件**：`package.json`、`package-lock.json`（由脚本生成）
  - **验证**：`cat package.json | grep '"name"'` → `"spectra-cli"`；`cat package.json | grep '"version"'` → `"3.0.0"`

---

## Phase 3：目录重命名与 Plugin 迁移（串行内部可分批）

- [x] Task 4：新建 `plugins/spectra/` 目录结构并迁移 plugin 配置
  - **描述**：执行 `cp -r plugins/reverse-spec plugins/spectra`，然后更新新目录内的配置文件：`plugins/spectra/.claude-plugin/plugin.json` 中 `name` → `"spectra"`、`keywords` 替换（移除 `"reverse-engineering"` 相关，加入 `"spectra"`）；`plugins/spectra/.mcp.json` 中 `mcpServers` 键从 `"reverse-spec"` 改为 `"spectra"`，`command` 改为 `"spectra"`。
  - **影响文件**：`plugins/spectra/.claude-plugin/plugin.json`（新建/更新）、`plugins/spectra/.mcp.json`（新建/更新）
  - **验证**：`cat plugins/spectra/.claude-plugin/plugin.json | grep '"name"'` → `"spectra"`

- [x] Task 5：创建新 spectra skill 文件（3 个）
  - **描述**：在 `plugins/spectra/skills/` 下创建三个新 skill 目录和 SKILL.md：`spectra/SKILL.md`（内容基于 `reverse-spec/SKILL.md`，将所有 `reverse-spec` 命令引用改为 `spectra`，`/reverse-spec` 改为 `/spectra`，CLI 命令示例全量更新）；`spectra-batch/SKILL.md`（同理）；`spectra-diff/SKILL.md`（同理）。
  - **前置**：Task 4 完成
  - **影响文件**：`plugins/spectra/skills/spectra/SKILL.md`、`spectra-batch/SKILL.md`、`spectra-diff/SKILL.md`（均新建）
  - **验证**：三个文件存在，`grep "reverse-spec" plugins/spectra/skills/spectra/SKILL.md` 无输出（或仅出现在豁免历史说明中）

- [x] Task 6：将旧 reverse-spec skill 文件改为 deprecation redirect stub
  - **描述**：修改 `plugins/reverse-spec/skills/reverse-spec/SKILL.md`、`reverse-spec-batch/SKILL.md`、`reverse-spec-diff/SKILL.md` 的内容，改为简短的 deprecation notice，引导用户使用新命令（例如：`[DEPRECATED] This skill has been renamed. Use /spectra instead.`）。旧目录本身保留（不删除），作为存量用户的过渡期容器。
  - **影响文件**：`plugins/reverse-spec/skills/reverse-spec/SKILL.md`、`reverse-spec-batch/SKILL.md`、`reverse-spec-diff/SKILL.md`
  - **验证**：三个文件内容包含 deprecation 提示，且指向新 skill 名

- [x] Task 7：新建 `plugins/spectra/contracts/skill-source-of-truth.yaml`
  - **描述**：在 `plugins/spectra/contracts/` 下创建新的 skill-source-of-truth.yaml，内容基于旧文件，将所有路径中的 `reverse-spec` 替换为 `spectra`（plugin id、sourceRoot、canonicalRoot、所有 skill entry 的 id 和 source/mirror 路径）。
  - **前置**：Task 5 完成
  - **影响文件**：`plugins/spectra/contracts/skill-source-of-truth.yaml`（新建）
  - **验证**：`grep "reverse-spec" plugins/spectra/contracts/skill-source-of-truth.yaml` → 无输出

- [x] Task 8：更新 `package.json` — bin 字段与 npm scripts
  - **描述**：（注意：`package.json` 部分字段由 release:sync 覆盖，此 task 处理 sync 不覆盖的字段。）`bin` 字段新增 `"spectra": "dist/cli/index.js"`（保留 `"reverse-spec": "dist/cli/index.js"` alias）；`scripts` 中将 `reverse-spec:sync:skills` 重命名为 `spectra:sync:skills`（同时更新对应的脚本路径为 `plugins/spectra/scripts/sync-skill-mirrors.mjs`）；`reverse-spec:check:skills` → `spectra:check:skills`。
  - **前置**：Task 3 完成（package.json 已被 release:sync 处理过）
  - **影响文件**：`package.json`
  - **验证**：`cat package.json | grep '"spectra"'` 出现 bin 条目；`cat package.json | grep '"reverse-spec"'` 仍出现 alias

- [x] Task 9：创建 skill mirror 文件（src/skills-global/ 和 skills/ 下各 3 个）
  - **描述**：在 `src/skills-global/` 下新建 `spectra/SKILL.md`、`spectra-batch/SKILL.md`、`spectra-diff/SKILL.md`（内容同 `plugins/spectra/skills/` 对应文件）；在 `skills/` 下新建同名三个目录和文件。**旧 mirror 文件** `src/skills-global/reverse-spec*/SKILL.md` 和 `skills/reverse-spec*/SKILL.md` 改为 deprecation redirect stub（内容与 Task 6 类似）。
  - **前置**：Task 5 完成
  - **影响文件**：6 个新建 mirror 文件 + 6 个旧 mirror 文件 stub 化
  - **验证**：`ls src/skills-global/` 包含 spectra 三个目录；`grep "reverse-spec" src/skills-global/spectra/SKILL.md` 无输出

---

## Phase 4：源码更新（src/）[可并行]

> Task 10–18 互不依赖，可同时执行。

- [x] Task 10：更新 `src/cli/index.ts` — HELP_TEXT + deprecation wrapper
  - **描述**：将 HELP_TEXT 中所有 `reverse-spec` 命令名替换为 `spectra`（如 `spectra generate`、`spectra batch` 等）；将 `console.log(\`reverse-spec v${version}\`)` 改为 `spectra v${version}`；在 `main()` 函数顶部增加 deprecation 检测逻辑：检测 `path.basename(process.argv[1]).replace(/\.js$/, '')` 是否为 `reverse-spec`，若是则向 stderr 打印 deprecation warning。
  - **影响文件**：`src/cli/index.ts`
  - **验证**：文件中无独立出现的 `reverse-spec`（仅可出现于 deprecation 检测逻辑字符串中）

- [x] Task 11：更新 `src/mcp/server.ts` — server name
  - **描述**：将 `name: 'reverse-spec'` 改为 `name: 'spectra'`（第 38 行）。
  - **影响文件**：`src/mcp/server.ts`
  - **验证**：`grep "name:" src/mcp/server.ts` → `name: 'spectra'`

- [x] Task 12：更新 `src/installer/skill-installer.ts` — 用户提示字符串
  - **描述**：将 9 处用户可见字符串中的 `reverse-spec skills` 改为 `spectra skills`；`/reverse-spec` → `/spectra`；`$reverse-spec` → `$spectra`。
  - **影响文件**：`src/installer/skill-installer.ts`
  - **验证**：`grep "reverse-spec" src/installer/skill-installer.ts` → 无输出

- [x] Task 13：更新 `src/installer/skill-templates.ts` — 常量与路径
  - **描述**：`REVERSE_SPEC_SKILL_NAMES` 数组内容改为 `['spectra', 'spectra-batch', 'spectra-diff']`，建议同时将常量名重命名为 `SPECTRA_SKILL_NAMES`；路径拼接中 `'reverse-spec'` → `'spectra'`；注释中的品牌引用更新。
  - **影响文件**：`src/installer/skill-templates.ts`
  - **验证**：`grep "reverse-spec" src/installer/skill-templates.ts` → 无输出

- [x] Task 14：更新 `src/generator/frontmatter.ts` — generatedBy 字段
  - **描述**：将 `generatedBy: 'reverse-spec v2.0'` 改为 `generatedBy: 'spectra v3.0'`。
  - **影响文件**：`src/generator/frontmatter.ts`
  - **验证**：`grep "reverse-spec" src/generator/frontmatter.ts` → 无输出

- [x] Task 15：更新 `src/batch/batch-readme-generator.ts` — 版本注释
  - **描述**：将 `/** reverse-spec 版本号 */` 注释改为 `/** spectra 版本号 */`；将 `由 reverse-spec v${version}` 改为 `由 spectra v${version}`。
  - **影响文件**：`src/batch/batch-readme-generator.ts`
  - **验证**：`grep "reverse-spec" src/batch/batch-readme-generator.ts` → 无输出

- [x] Task 16：更新 `src/scripts/postinstall.ts` 和 `preuninstall.ts` — 提示字符串
  - **描述**：`postinstall.ts` 中 2 处品牌引用更新；`preuninstall.ts` 中 1 处更新。
  - **影响文件**：`src/scripts/postinstall.ts`、`src/scripts/preuninstall.ts`
  - **验证**：两文件 `grep "reverse-spec"` 无输出

- [x] Task 17：更新 `src/core/single-spec-orchestrator.ts` — 注释
  - **描述**：第 3 行注释 `* /reverse-spec 命令入口` 改为 `* /spectra 命令入口`。
  - **影响文件**：`src/core/single-spec-orchestrator.ts`
  - **验证**：`grep "reverse-spec" src/core/single-spec-orchestrator.ts` → 无输出

- [x] Task 18：更新 `src/batch/batch-orchestrator.ts`、`src/batch/checkpoint.ts`、其他 src/ 残留文件
  - **描述**：对 Phase 4 中尚未处理的 src/ 文件执行扫描 + 替换。运行 `grep -r "reverse-spec" src/ --include="*.ts"` 获取当前残留列表，逐一处理（若为注释或字符串中的品牌名，替换为 spectra；若为路径字符串涉及 `.reverse-spec.yaml` 配置文件名则**跳过**，见 plan.md 豁免说明）。
  - **影响文件**：`src/batch/batch-orchestrator.ts`、`src/batch/checkpoint.ts` 及其他残留
  - **验证**：`grep -r "reverse-spec" src/ --include="*.ts"` 仅剩 `.reverse-spec.yaml` 配置文件名相关行（豁免项）和 deprecation 检测逻辑中的字符串

---

## Phase 5：spec-driver 联动 [可并行]

> 以下 3 个 task 可并行。

- [x] Task 19：更新 spec-driver 核心脚本引用（2 个文件）
  - **描述**：`plugins/spec-driver/scripts/generate-product-entity-catalog.mjs`：将 `WORKFLOW_REFS_BY_PRODUCT['reverse-spec']` 键名改为 `'spectra'`，所有 workflow ref 字符串（如 `'reverse-spec.init'` → `'spectra.init'`）；第 307 行 `productId === 'reverse-spec'` 判断改为 `productId === 'spectra'`。`plugins/spec-driver/scripts/lib/sync-product-mapping.mjs`：注释中的品牌示例更新（保留历史格式说明文字）。
  - **影响文件**：`plugins/spec-driver/scripts/generate-product-entity-catalog.mjs`、`plugins/spec-driver/scripts/lib/sync-product-mapping.mjs`
  - **验证**：`grep "reverse-spec" plugins/spec-driver/scripts/generate-product-entity-catalog.mjs` → 无输出（或仅剩历史注释豁免项）

- [x] Task 20：更新 spec-driver skill 和 agents（2 个文件）
  - **描述**：`plugins/spec-driver/skills/spec-driver-doc/SKILL.md`：第 88 行 `npx reverse-spec prepare` → `npx spectra prepare`。`plugins/spec-driver/agents/constitution.md`：第 29 行 `reverse-spec` → `spectra`（非路径示例，为品牌名引用）。
  - **影响文件**：`plugins/spec-driver/skills/spec-driver-doc/SKILL.md`、`plugins/spec-driver/agents/constitution.md`
  - **验证**：两文件 `grep "reverse-spec"` 无输出（或仅剩路径示例豁免行）

- [x] Task 21：更新 spec-driver README（1 个文件）
  - **描述**：`plugins/spec-driver/README.md` 中 2 处品牌引用更新。
  - **影响文件**：`plugins/spec-driver/README.md`
  - **验证**：`grep "reverse-spec" plugins/spec-driver/README.md` → 无输出

---

## Phase 6：文档更新 [可并行]

- [x] Task 22：更新 `AGENTS.md` 和 `CLAUDE.md`
  - **描述**：`AGENTS.md`：标题 `reverse-spec / spec-driver` → `Spectra / spec-driver`；第 7 行 CLI 说明中 `reverse-spec` CLI 命令名改为 `spectra`；第 94 行 `reverse-spec` → `spectra`。`CLAUDE.md`：标题行；第 80 行说明文字。
  - **影响文件**：`AGENTS.md`、`CLAUDE.md`
  - **验证**：`grep "reverse-spec" AGENTS.md CLAUDE.md` → 仅剩已知豁免（如历史上下文说明）

- [x] Task 23：更新 `plugins/spectra/scripts/postinstall.sh`
  - **描述**：全量更新 postinstall.sh：将所有 `reverse-spec` CLI 检测逻辑改为检测 `spectra`；新增旧版 plugin 检测逻辑（检测是否存在已安装的 `reverse-spec` plugin，若有则输出提示用户手动卸载）；保持 `set -euo pipefail`。
  - **影响文件**：`plugins/spectra/scripts/postinstall.sh`
  - **验证**：脚本可正常执行（`bash -n plugins/spectra/scripts/postinstall.sh`）；内容无 `reverse-spec` CLI 引用

- [x] Task 24：确认 `plugins/spectra/README.md` 内容完整
  - **描述**：检查 Task 4 复制过来的 `plugins/spectra/README.md` 是否已更新所有品牌引用（替换 `reverse-spec` → `Spectra`/`spectra`，更新安装命令为 `npm install -g spectra-cli`）。
  - **影响文件**：`plugins/spectra/README.md`
  - **验证**：`grep "reverse-spec" plugins/spectra/README.md` → 无输出

---

## Phase 7：构建、测试与完整性验证（串行）

- [x] Task 25：执行 `npm run build` 重新编译
  - **描述**：运行 TypeScript 编译，覆盖 `dist/` 下所有旧构建产物（约 65 处旧引用自动消除）。编译成功则继续，失败需先修复类型错误。
  - **前置**：Task 8（package.json bin 字段更新）、Task 10–18（src/ 更新）全部完成
  - **影响文件**：`dist/`（全量覆盖）
  - **验证**：`npm run build` 无 TypeScript 报错退出

- [x] Task 26：执行 `npm run test` 全量测试
  - **描述**：运行 Vitest（unit + integration），确保重命名不破坏任何已有测试。若测试文件中有 `reverse-spec` 字符串比对，需先修复（Phase 4 Task 18 应已覆盖，若遗漏在此处处理）。
  - **前置**：Task 25 完成
  - **影响文件**：无（只读验证）
  - **验证**：`npm run test` 全部通过，零失败

- [x] Task 27：运行 `scripts/audit-rename.sh` 扫描残余引用
  - **描述**：对照 Task 1 的基准快照，运行审计脚本，确认所有非豁免引用均已清除。豁免项：`.reverse-spec.yaml` 配置文件名（`src/config/project-config.ts`）、deprecation 检测逻辑中的 `'reverse-spec'` 字符串（`src/cli/index.ts`）、旧 skill stub 文件（内容为 redirect notice 的文件）。
  - **前置**：Task 25 完成
  - **影响文件**：无（只读验证）
  - **验证**：脚本输出中无非豁免 `reverse-spec` 引用；每个输出行均可解释为豁免项

- [x] Task 28：运行 `npm run repo:check` 和 `npm run release:check`
  - **描述**：运行仓库完整性验证和发布合同验证。若报错，根据错误信息定位到对应文件修复，然后重跑。
  - **前置**：Task 25、27 完成
  - **影响文件**：无（只读验证）
  - **验证**：两个命令均零错误退出

- [x] Task 29：手动端到端冒烟测试
  - **描述**：执行以下验证命令：① `node dist/cli/index.js --help`（或安装后 `spectra --help`）确认帮助文本显示 `spectra`；② `node dist/cli/index.js batch --help` 确认批处理帮助正常；③ 模拟 `process.argv[1]` 为 `reverse-spec` 路径，确认 deprecation warning 输出到 stderr；④ 检查 `plugins/spectra/.claude-plugin/plugin.json` name 字段为 `spectra`。
  - **前置**：Task 25 完成
  - **影响文件**：无（只读验证）
  - **验证**：① `spectra batch --help` 输出不含 `reverse-spec` 字样；② deprecation warning 在旧命令调用时打印；③ 退出码为 0

---

## 任务依赖总览

```
Task 1（审计）
  └─→ Task 2（release-contract）
        └─→ Task 3（release:sync）
              └─→ Task 4（plugins/spectra 目录）
                    ├─→ Task 5（新 skill 文件）
                    │     ├─→ Task 7（skill-source-of-truth）
                    │     └─→ Task 9（mirror 文件）
                    ├─→ Task 6（旧 skill stub）[可与 Task 5 并行]
                    └─→ Task 8（package.json bin/scripts）[可与 Task 5,6 并行]

Task 3 完成后可并行启动:
  ├─→ Task 10–18（src/ 更新）[内部可并行]
  ├─→ Task 19–21（spec-driver 联动）[内部可并行]
  └─→ Task 22–24（文档更新）[内部可并行]

Task 8 + Task 10–18 全部完成:
  └─→ Task 25（npm run build）
        ├─→ Task 26（npm run test）
        ├─→ Task 27（audit-rename.sh）
        └─→ Task 28（repo:check + release:check）[前置 Task 25 + 27]
              └─→ Task 29（冒烟测试）
```

---

## 验收门禁清单

完成所有任务后，确认以下门禁全部通过：

- [x] `spectra batch --help` 正常执行，输出不含 `reverse-spec`（SC-001）
- [x] `reverse-spec batch` 执行时打印 deprecation warning，退出码为 0（SC-002）
- [x] `npm run repo:check` 零错误通过（SC-003）
- [x] `npm run release:check` 零错误通过（SC-003）
- [x] `scripts/audit-rename.sh` 无非豁免残留引用（SC-004）
- [x] `npm run test` 全部通过（SC-005）
- [x] `specs/` 目录内容无任何变化（SC-006）
