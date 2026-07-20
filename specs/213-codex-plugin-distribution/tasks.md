---

description: "Feature 213 — Codex Plugin 一体分发（A1）任务分解（v2，已按 Codex 对抗审查 8 CRITICAL + 4 WARNING 修订）"

---

# Tasks: Codex Plugin 一体分发（A1）

**输入**: `plan.md`（技术计划，含 Codex 对抗审查 4 项 CRITICAL 修订）、`spec.md`（13 FR / 6 SC / 3 User Story）
**分支**: `claude/codex-plugin-distribution-2940d3`
**修订记录**: v2 — 针对 Codex（gpt-5.6-sol）完整版对抗审查的 8 CRITICAL + 4 WARNING 全部落点修订，详见文末"审查落点确认表"

**测试策略**: spec §3.5 明确要求结构性断言测试（vitest，CI 必跑）+ 可选真实 CLI E2E（本机 codex binary 存在时跑，无 binary 时 skip）。本任务清单严格遵循 TDD：涉及既有测试文件修改/新增的 task 均标注"先写测试确认失败（红），再实现转绿（绿）"两步序；characterization 性质的守护用例（实施前后均应恒为绿）会显式标注，不强行凑"全红"。

**改动文件红线说明**：本清单中除 `specs/213-codex-plugin-distribution/**` 下的流程制品（`research/`、`verification/`、本 `tasks.md` 自身）外，其余全部改动文件必须出现在 `plan.md` §3.6 新增/修改文件全景清单中，不得引入清单外文件。`specs/213-codex-plugin-distribution/**` 下的 spec-driver 流程产物（如 `verification/verification-report.md`）**豁免**该清单约束——这是 spec-driver 工作流的标准产物目录（参照仓库既有惯例，如 `specs/129-.../verification/verification-report.md`、`specs/077-.../verification/verification-report.md`），不是 plan §3.6 意图约束的"源码红线"范围。

**组织方式**: Phase 0（基线捕获）→ Phase 1（Setup）→ Phase 2（Foundational）→ Phase 3-4（US1/US2）→ Phase 5（跨故事集成）→ Phase 6（US3）→ Phase 7（可选 E2E）→ Phase 8（收尾）。

## 格式说明

`- [ ] TXXX [P?] [USN?] 标题`，随附子字段：**FR/plan 章节**、**改动文件**、**验收断言**、**依赖**、**风险标注**（仅 plan §6 风险 1-4 关联的 task 标注）。

---

## Phase 0: 基线捕获（先于任何改动执行）

- [ ] **T000** 捕获改动前测试基线（供 T022 收尾比对）
  - **FR/plan 章节**: FR-011, SC-005；plan §3.5 双运行时回归段（WARNING #9 落点）
  - **改动文件**: 无源码改动；产出基线记录文件 `specs/213-codex-plugin-distribution/verification/baseline-pre-implement.txt`（流程制品，豁免红线约束）
  - **验收断言**: 在当前 `origin/master@2466905` 基线（本 feature 尚无任何改动的干净状态）下执行 `npx vitest run > specs/213-codex-plugin-distribution/verification/baseline-pre-implement.txt 2>&1; echo "exit=$?" >> specs/213-codex-plugin-distribution/verification/baseline-pre-implement.txt`，记录完整用例通过/失败清单与总退出码；额外记录本次 `git rev-parse HEAD` 作为隔离基线 commit 锚点，供 T022 引用比对（不依赖"记忆中的结果"，而是可复跑的固定 commit 快照）
  - **依赖**: 无（必须先于 T001 及之后一切改动执行）
  - **风险标注**: 无（本身是 WARNING #9 的直接落点）

---

## Phase 1: Setup — `.agents` worktree 基础设施收窄（阻塞 marketplace 落地，FR-013）

**目标**：为 tracked `.agents/plugins/marketplace.json` 落地扫清 `.gitignore`/symlink 障碍，且本 worktree 操作序列本身可独立回滚。**T002 承载完整原子七步**（含 marketplace.json 内容真实落地，CRITICAL #2）。

- [ ] **T001** [P] Setup 更新 `sync-worktree-local-state` 单元测试（test-first，先见红）
  - **FR/plan 章节**: FR-013；plan §3.4 决策4、§3.5 结构性测试#5
  - **改动文件**: `tests/unit/sync-worktree-local-state.test.ts`
  - **验收断言**: 将现有"`.agents` 目录应软链到父仓库"用例（第 83-94 行附近）改为对 `.agents/skills` 子目录的断言（`primaryDir/.agents/skills` 建内容 → 断言 `worktreeDir/.agents/skills` 为 symlink，而非整个 `.agents`）；跑 `npx vitest run tests/unit/sync-worktree-local-state.test.ts`，此刻应**失败**（脚本尚未改动，仍处理整目录 `.agents`）
  - **依赖**: T000
  - **风险标注**: 无

- [ ] **T002** Setup `.agents` symlink 7 步过渡序列执行（含 marketplace.json 内容真实落地）+ `.gitignore` 收窄 + `SYMLINK_TARGETS` 收窄
  - **FR/plan 章节**: FR-013；plan §3.4 决策4 全部步骤、§6 风险 1、§5 Complexity Tracking（`.gitignore` 双重否定必要性）
  - **改动文件**: `.gitignore`（`.agents`/`.agents/` 忽略规则 → `.agents/*` + `!.agents/plugins/` + `!.agents/plugins/**`）、`scripts/sync-worktree-local-state.sh`（`SYMLINK_TARGETS` 中 `.agents` → `.agents/skills`）、`.agents/plugins/marketplace.json`（**本 task 内容真实落地**，CRITICAL #2 修订：不再延后到 T018，对齐 plan §3.4 决策4 步骤3"本地新建真实目录并落地 tracked 文件"的原始语义）
  - **验收断言**（逐步复核，禁止跳步）:
    1. `readlink .agents` 记录当前指向主仓的绝对路径 `<PRIMARY_AGENTS_PATH>`（执行前证据，写入 `specs/213-codex-plugin-distribution/verification/agents-symlink-transition-log.md`）
    2. `rm .agents`（仅删符号链接本身，不触碰其指向的主仓真实内容）
    3. `mkdir -p .agents/plugins`；**立即写入** `.agents/plugins/marketplace.json`，内容遵循实测 schema：
       ```json
       {
         "name": "cc-plugin-market",
         "interface": { "displayName": "Spectra / Spec Driver" },
         "plugins": [
           {
             "name": "spectra",
             "source": { "source": "local", "path": "./plugins/spectra" },
             "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
             "category": "development"
           },
           {
             "name": "spec-driver",
             "source": { "source": "local", "path": "./plugins/spec-driver" },
             "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
             "category": "development"
           }
         ]
       }
       ```
       （字段值不依赖 T009/T010 是否已存在，`source.path` 是静态路径声明，可独立于 manifest 内容先行落地；`marketplace-entries` 一致性 check 对"路径下是否真实存在 `.codex-plugin/plugin.json`"的校验留待 T009/T010/T015/T016 完成后验证）
    4. 落地 `.gitignore` 与 `scripts/sync-worktree-local-state.sh` 改动（本 task 的代码改动）
    5. `bash scripts/sync-worktree-local-state.sh --dry-run` 先确认计划动作，再正式执行 `bash scripts/sync-worktree-local-state.sh`
    6. `ls -la .agents/` 显示 `plugins/` 为真实目录（含刚写入的 `marketplace.json`）、`skills/` 为 symlink；`git status .agents/` 显示 `.agents/plugins/marketplace.json` 待添加；`readlink .agents/skills` 指向主仓 `.agents/skills`
    7. 在主仓路径（非本 worktree）执行 `git status`，确认无 `.agents/plugins/marketplace.json` 相关改动（该文件此刻仅存在于**本 worktree 的未合并分支**，主仓将在本 feature 合并回 `master` 后经正常 `git pull` 获得，不经过 symlink 机制）
    8. 重跑 `npx vitest run tests/unit/sync-worktree-local-state.test.ts`（T001 用例）转绿
  - **依赖**: T000, T001（先见红）
  - **风险标注**: **风险1（高，plan §6 #1）**——若在解除 symlink 前写入 `.agents/plugins/marketplace.json` 会写穿污染主仓；本 task 是该风险的独立、可单独回滚的缓解单元
  - **回滚命令序列**（CRITICAL #2：给可执行命令，不写"手动重建"）：
    ```bash
    git checkout -- .gitignore scripts/sync-worktree-local-state.sh
    rm -rf .agents
    ln -s <步骤1记录的 PRIMARY_AGENTS_PATH> .agents
    readlink .agents   # 应输出与步骤1记录值完全一致的路径，标志复原完成
    ```

---

## Phase 2: Foundational — Spec Driver Codex 双写基础设施（阻塞 US2，FR-005）

**目标**：完成 `codex-skills.sh` opt-in 双写机制与 wrapper 校验泛化，产出 tracked `plugins/spec-driver/skills-codex/`，并显式接线 `repo:sync` 的 `--sync-plugin-distribution` flag。US2（Phase 4）依赖该目录存在。

- [ ] **T003** [P] Foundational 扩展 `spec-driver-codex-skills` 集成测试（**一红两绿**，CRITICAL #12 修订）
  - **FR/plan 章节**: FR-005；plan §3.1 CRITICAL 修订（opt-in flag）、§3.5 结构性测试#4
  - **改动文件**: `tests/integration/spec-driver-codex-skills.test.ts`
  - **验收断言**（明确红绿归类，防止实施者为凑"全红"写错测试）:
    - **红（新功能用例，实现前必失败）**：`install --sync-plugin-distribution`（cwd=tempDir fixture 副本）后断言 `skills-codex/` 生成 8 个目录、内容与同次 `.codex/skills` 对应文件字节相同——此刻脚本无该 flag，用例应失败
    - **绿（characterization 守护用例，实现前后均应恒为绿，属回归防线而非新功能）**：
      (a) **无 flag 守护**：普通 `install`（cwd=tempDir，不传 flag）执行前后，对**真实仓库** `plugins/spec-driver/skills-codex/` 做快照比对，断言零变化——因当前脚本本就不处理该目录，此断言在实现前后均天然成立，写完立即应为绿，不要求其"先红"
      (b) **remove 守护**：`remove` 后 `skills-codex/` 不受影响——同理，当前 `remove_all()` 本就不涉及该目录，天然为绿
    - 跑 `npx vitest run tests/integration/spec-driver-codex-skills.test.ts`：新增红用例失败、新增绿用例（a）（b）通过、既有用例保持通过（不得回归）
  - **依赖**: T000
  - **风险标注**: 无（自身即风险2的测试防线）

- [ ] **T004** [P] Foundational `wrapper-source-of-truth.yaml` 新增 `pluginDistributionRoot` 字段
  - **FR/plan 章节**: FR-005；plan §3.1
  - **改动文件**: `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`
  - **验收断言**: 新增 `codexWrappers.pluginDistributionRoot: "plugins/spec-driver/skills-codex"`（`sourceRoot`/`targetRoot`/`generator`/`entries` 不变）；用 `node -e "import('./plugins/spec-driver/scripts/lib/simple-yaml.mjs').then(async m=>{const fs=await import('node:fs');const doc=m.parseYamlDocument(fs.readFileSync('plugins/spec-driver/contracts/wrapper-source-of-truth.yaml','utf8'));console.log(doc.codexWrappers.pluginDistributionRoot)})"` 输出正确路径字符串
  - **依赖**: T000
  - **风险标注**: 无

- [ ] **T005** Foundational `codex-skills.sh` opt-in 双写实现
  - **FR/plan 章节**: FR-005；plan §3.1 CRITICAL 修订核心、§6 风险2
  - **改动文件**: `plugins/spec-driver/scripts/codex-skills.sh`（新增 `SYNC_PLUGIN_DIST="false"` 变量、`--sync-plugin-distribution` 参数解析分支、`sync_plugin_distribution_copy()` 函数、`install_all()` 末尾条件调用、`usage()` 帮助文本补充；`remove_all()` **不**改动）
  - **验收断言**:
    - `bash plugins/spec-driver/scripts/codex-skills.sh install --help` 输出含 `--sync-plugin-distribution` 说明
    - **无 flag 守护断言**：在临时 cwd 下跑 `bash plugins/spec-driver/scripts/codex-skills.sh install`（无 flag），执行前后对**真实仓库** `git status plugins/spec-driver/skills-codex/` 比对，应为零变化
    - 在 tempDir fixture 副本上跑 `install --sync-plugin-distribution` 产出 `skills-codex/` 8 个目录，内容与同次生成的 `.codex/skills` 字节相同
    - 既有 `.codex/skills` 生成行为（不带 flag 时）逐字节不变
  - **依赖**: T004
  - **风险标注**: **风险2（中，plan §6 #2）**——纯加法式改动缓解

- [ ] **T006** [P] Foundational `validate-wrapper-sources.mjs` 泛化
  - **FR/plan 章节**: FR-005；plan §3.1、§3.7 决策7（F186 sha 门禁保持绿证明路径）
  - **改动文件**: `plugins/spec-driver/scripts/validate-wrapper-sources.mjs`（`validateWrapperMarkers(projectRoot, entries, errors)` 泛化为接受 `root`/`label` 参数，对 `targetRoot`（既有 check id `codex-wrapper-markers`）与 `pluginDistributionRoot`（新 check id `codex-plugin-distribution-markers`）各跑一次）
  - **验收断言**（WARNING #9：明确测试落点文件，避免与 T016 隐藏冲突）: 新增用例落在 `tests/integration/spec-driver-wrapper-source-truth.test.ts`（该文件已存在，是 `validate-wrapper-sources.mjs` 现有的专属测试文件，**不是** T016 的 `tests/integration/repo-maintenance-sync-check.test.ts`，两者互不冲突、无需标注串行）；断言两个 check（`codex-wrapper-markers` + `codex-plugin-distribution-markers`）在同一次校验中均为 pass；既有 `codex-wrapper-markers` check 的既有断言逐条仍通过
  - **依赖**: T004
  - **风险标注**: **风险2（中，plan §6 #2）**——同 T005

- [ ] **T007** Foundational `npm run repo:sync` 接线 opt-in flag + 驱动生成 `skills-codex/` + T003 测试转绿 checkpoint
  - **FR/plan 章节**: FR-005；plan §7 步骤2
  - **改动文件**: `scripts/lib/repo-maintenance-core.mjs`（**显式代码改动**：`runSpecDriverCodexInstall` 函数，约第 41-49 行，`execFileSync('bash', [scriptPath, 'install'], {...})` → `execFileSync('bash', [scriptPath, 'install', '--sync-plugin-distribution'], {...})`，现状确认无该 flag，本 task 是唯一新增来源）；执行产物 `plugins/spec-driver/skills-codex/{8 skill}/SKILL.md`
  - **验收断言**: `npm run repo:sync` 后 `ls plugins/spec-driver/skills-codex | wc -l` 输出 `8`；`npx vitest run tests/integration/spec-driver-codex-skills.test.ts` 全绿（T003 红用例转绿 + 两条 characterization 绿用例保持通过）
  - **依赖**: T003, T005, T006
  - **风险标注**: **风险2 缓解验证点**
  - **文件冲突提示（CRITICAL #1）**: 本 task 与 **T016** 均修改 `scripts/lib/repo-maintenance-core.mjs`（T007 改 `runSpecDriverCodexInstall` 调用参数；T016 改 `validateRepository()` 内新增 `aggregateValidation` 注册），**必须串行**（T007 → T016，不可并行编辑同一文件），T016 的依赖列表已显式包含 T007

---

## Phase 3: User Story 1 — Codex 用户一次安装获得 Spectra 全部能力 (P1)

**目标**：`plugins/spectra/.codex-plugin/plugin.json` 落地，manifest 引用 `.mcp.json` 与 canonical `skills/`，Codex 用户一次安装获得 MCP + 3 个 skill。**初稿不含 `version`/`description` 键**（CRITICAL #7）。

**独立测试**：干净 fixture 目录先注册 marketplace 再 `codex plugin add spectra@<market>`，结构性断言 `mcpServers` 字段正确引用、`skills/` 目录 3 个 skill 均可发现（对应 Phase 6 T019 的结构性测试与 Phase 7 可选 E2E）。

- [ ] **T008** [P] [US1] 复跑验证既有 Spectra skill 中立性扫描证据并修正命令记录（CRITICAL #4：该 task 不是"新建证据文档"，`research/spectra-skill-neutrality-scan.md` 在 plan 阶段已留存，本 task 是复跑校正）
  - **FR/plan 章节**: FR-004；plan §3.2 决策2、clarifications 澄清点1
  - **改动文件**: `specs/213-codex-plugin-distribution/research/spectra-skill-neutrality-scan.md`（**修改**，非新建；流程制品，豁免红线约束）
  - **验收断言**: 文档现有扫描命令记录为 `grep -rn "Task tool|mcp__plugin_|AskUserQuestion|Task\(" plugins/spectra/skills/`，需订正为与本 task 实际复跑一致的命令：
    ```bash
    rg -n 'Task tool|mcp__plugin_|AskUserQuestion|Task\(' plugins/spectra/skills
    ```
    期望 `exit=1`（ripgrep 无匹配时返回 1）、stdout 为空、stderr 为空；实际执行并将该命令、退出码、空输出证据更新进文档，替换原 `grep -rn` 记录段落；结论段落（"FR-004 假设成立"）保持不变
  - **依赖**: T000
  - **风险标注**: 无

- [ ] **T009** [US1] `plugins/spectra/.codex-plugin/plugin.json` 初稿创建（**不含受控字段**，CRITICAL #7）
  - **FR/plan 章节**: FR-001, FR-003, FR-004, FR-006；plan §3.1 架构图 CX1 节点
  - **改动文件**: `plugins/spectra/.codex-plugin/plugin.json`
  - **验收断言**（WARNING #9：node:assert 机械化）:
    ```bash
    node -e "
    const assert = require('node:assert/strict');
    const m = JSON.parse(require('node:fs').readFileSync('plugins/spectra/.codex-plugin/plugin.json','utf8'));
    assert.strictEqual(m.mcpServers, './.mcp.json');
    assert.strictEqual(m.skills, './skills/');
    assert.ok(!('hooks' in m), 'manifest 不应含 hooks 字段');
    assert.ok(!('version' in m), '初稿不应含 version 字段（T011 由 release:sync 写入）');
    assert.ok(!('description' in m), '初稿不应含 description 字段（T011 由 release:sync 写入）');
    console.log('OK');
    "
    ```
  - **依赖**: T008（决策2依据）
  - **风险标注**: 无

**Checkpoint**: US1 manifest 骨架就绪（无受控字段）；版本字段正式化留待 Phase 5（T011）。

---

## Phase 4: User Story 2 — Codex 用户一次安装获得 Spec Driver 全部 Codex 适配 skills 与 hooks (P1)

**目标**：`plugins/spec-driver/.codex-plugin/plugin.json` 落地，manifest 的 `"skills"` 指向 Codex 适配目录 `skills-codex/`。**初稿同样不含受控字段**。

**独立测试**：干净 fixture 目录安装后机械枚举 Codex 侧可发现 skill 数量与 `wrapper-source-of-truth.yaml` entries（8）比对一致，refactor 缺口经 waiver 呈现（对应 Phase 6 T014/T015）。

- [ ] **T010** [US2] `plugins/spec-driver/.codex-plugin/plugin.json` 初稿创建（与 T009 对称，CRITICAL #7 + WARNING #9）
  - **FR/plan 章节**: FR-002, FR-005, FR-006；plan §3.1 架构图 CX2 节点
  - **改动文件**: `plugins/spec-driver/.codex-plugin/plugin.json`
  - **验收断言**（与 T009 对称的具体命令）:
    ```bash
    node -e "
    const assert = require('node:assert/strict');
    const m = JSON.parse(require('node:fs').readFileSync('plugins/spec-driver/.codex-plugin/plugin.json','utf8'));
    assert.strictEqual(m.skills, './skills-codex/');
    assert.ok(!('hooks' in m), 'manifest 不应含 hooks 字段');
    assert.ok(!('version' in m), '初稿不应含 version 字段（T011 由 release:sync 写入）');
    assert.ok(!('description' in m), '初稿不应含 description 字段（T011 由 release:sync 写入）');
    console.log('OK');
    "
    ```
  - **依赖**: T007（`skills-codex/` 目录必须已由 `repo:sync` 生成，manifest 才能引用真实存在的目录）
  - **风险标注**: 无

**Checkpoint**: US2 manifest 骨架就绪，与 US1 一起进入 Phase 5 版本正式化。

---

## Phase 5: 跨故事集成 — Release Contract 接线（US1 + US2 共用文件，FR-008）

**目标**：两份 Codex manifest 的 `version`/`description` 纳入 `release-contract.yaml` 驱动链。**T012（测试先行）在 T011（实现）之前**（CRITICAL #3：TDD 红绿序修正）。

- [ ] **T012** [P] 扩展 `release-contract-sync` 集成测试——manifest 字段同步/漂移部分（**test-first，先见红**，CRITICAL #3）
  - **FR/plan 章节**: FR-008；plan §3.5 结构性测试#7
  - **改动文件**: `tests/integration/release-contract-sync.test.ts`
  - **验收断言**: 新增用例断言 `syncReleaseContract`/`validateReleaseContract` 覆盖 `codexPluginManifestPath` 字段——同步场景（fixture 手工改错版本 → 跑 sync → 断言纠正为 contract 值）+ 漂移检出场景（fixture 手工改错版本 → 跑 validate → 断言报 `codex-plugin-version:<product>` error）；跑 `npx vitest run tests/integration/release-contract-sync.test.ts -t codexPluginManifestPath`，此刻应**失败**（红——`contracts/release-contract.yaml` 尚无该字段，两份 manifest 也无 `version` 键）
  - **依赖**: T009, T010（manifest 文件需存在，即便无 version 键，测试才能引用其路径）
  - **风险标注**: 无

- [ ] **T011** Release Contract `codexPluginManifestPath` 字段接线 + `npm run release:sync` 正式化两份 manifest（转绿）
  - **FR/plan 章节**: FR-008；plan §3.3、§3.7 决策7（版本号策略：不 bump，直接对齐当前 contract 版本 4.3.0）
  - **改动文件**: `contracts/release-contract.yaml`（`products.spectra`/`products.spec-driver` 新增 `codexPluginManifestPath`）、`scripts/lib/release-contract-core.mjs`（`syncReleaseContract`/`validateReleaseContract` 各新增一段，对称既有 `pluginManifestPath` 处理块）
  - **验收断言**（CRITICAL #7：Node 断言精确相等，非 git diff 目测）:
    ```bash
    node --experimental-vm-modules -e "
    (async () => {
      const assert = await import('node:assert/strict');
      const fs = await import('node:fs');
      const { parseYamlDocument } = await import('./plugins/spec-driver/scripts/lib/simple-yaml.mjs');
      const contract = parseYamlDocument(fs.readFileSync('contracts/release-contract.yaml', 'utf8'));
      for (const id of ['spectra', 'spec-driver']) {
        const product = contract.products[id];
        const manifest = JSON.parse(fs.readFileSync(product.codexPluginManifestPath, 'utf8'));
        assert.default.strictEqual(manifest.version, product.version, id + ' version 不一致');
        assert.default.strictEqual(manifest.description, product.pluginDescription, id + ' description 不一致');
      }
      console.log('OK');
    })();
    "
    ```
    执行前先跑 `npm run release:sync`；随后 `npx vitest run tests/integration/release-contract-sync.test.ts -t codexPluginManifestPath` 转绿（T012 用例）
  - **依赖**: T012（先红后实现）
  - **风险标注**: 无

**Checkpoint**: 两份 manifest 版本字段进入 contract 驱动闭环，US1/US2 内容层完成。

---

## Phase 6: User Story 3 — 维护者通过 repo:check / release:check 拦截 Codex 分发漂移 (P2)

**目标**：一致性矩阵模块落地并接入 `repo:check`/`release:check` 双链，含 waiver 机制、`skills-reference` check、marketplace 校验。

**独立测试**：人为制造漂移（改 skill 数量不同步 manifest / 缺失 marketplace 条目），跑 `npm run repo:check` 确认报错并指出差异；恢复后确认零失败。

- [ ] **T013** [P] [US3] `codex-plugin-consistency-core` 单元测试编写（test-first，先见红；CRITICAL #5/#6 补充负例）
  - **FR/plan 章节**: FR-007, FR-012；plan §3.3、§3.5 结构性测试#1
  - **改动文件**: `tests/unit/codex-plugin-consistency-core.test.ts`
  - **验收断言**: 覆盖用例——
    - happy path 全 pass
    - manifest 缺失/JSON 非法→error；manifest 含 `hooks` key→error
    - `.mcp.json` 缺 `spectra` server→error
    - spec-driver skill 数量不一致（无 waiver 覆盖）→error，被 waiver 精确覆盖→pass 且 evidence 含 `waived: [...]`
    - marketplace 条目缺失/`source.path` 不匹配→error
    - spectra SKILL.md 人为注入 `mcp__plugin_` 字符串→`spectra-skill-neutrality` 报 **warn**（非 error）
    - **CRITICAL #5 新增负例**：`skills-reference:spectra` — manifest `skills` 字段值错误（不等于 `./skills/`）→error；`skills-reference:spec-driver` — manifest `skills` 字段值错误（不等于 `./skills-codex/`）→error；引用目录不存在→error；引用目录存在但 skill id 集合与预期不同（数量相同但身份不同，如把 `spec-driver-doc` 换成伪造 id）→error
    - **CRITICAL #6(a) waiver 精确删除模拟**：从 happy fixture 精确删除 `waivers[]` 中 `id: spec-driver-refactor-codex-wrapper-gap` 条目（或整个 `waivers:` 段）→ 断言 `canonical-vs-codex-gap:spec-driver` 报 error 且 **error 消息中明确指名 `spec-driver-refactor`**（用字符串包含断言 `error.includes('spec-driver-refactor')`，不接受用其他 skill id 冒充通过断言）
    跑 `npx vitest run tests/unit/codex-plugin-consistency-core.test.ts`，此刻应失败（`validateCodexPluginConsistency` 尚不存在）
  - **依赖**: T000（fixture 自包含，不依赖真实 manifest 文件）
  - **风险标注**: 无

- [ ] **T014** [P] [US3] `contracts/codex-plugin-consistency.yaml` 编写
  - **FR/plan 章节**: FR-012；plan §3.3、§5 Complexity Tracking、CRITICAL 修订#4（simple-yaml 块级序列约束）
  - **改动文件**: `contracts/codex-plugin-consistency.yaml`
  - **验收断言**: 内容含 `schemaVersion`、`manifests.spectra`/`manifests.spec-driver`、`marketplace.expectedPlugins`、`waivers[0]`（`id: spec-driver-refactor-codex-wrapper-gap`，`missingSkillIds` 用**块级序列**写法，非内联数组）；**机械验证**：`node -e "import('./plugins/spec-driver/scripts/lib/simple-yaml.mjs').then(async m=>{const fs=await import('node:fs');const doc=m.parseYamlDocument(fs.readFileSync('contracts/codex-plugin-consistency.yaml','utf8'));const arr=doc.waivers[0].missingSkillIds;console.log(Array.isArray(arr), arr.length, arr[0])})"` 输出 `true 1 spec-driver-refactor`
  - **依赖**: T000
  - **风险标注**: 无

- [ ] **T015** [US3] `scripts/lib/codex-plugin-consistency-core.mjs` 实现（含 `skills-reference` check，CRITICAL #5）
  - **FR/plan 章节**: FR-007, FR-012；plan §3.3 全部 check id 列表
  - **改动文件**: `scripts/lib/codex-plugin-consistency-core.mjs`（导出 `validateCodexPluginConsistency({projectRoot})`，实现 `manifest-exists`/`no-hooks-field`/`mcp-servers-reference`/`skill-count:spectra`/`spectra-skill-neutrality`/`skill-count:spec-driver-codex-dir`/`canonical-vs-codex-gap:spec-driver`/`marketplace-entries`，**新增** `skills-reference:spectra`（`manifest.skills === './skills/'`）与 `skills-reference:spec-driver`（`manifest.skills === './skills-codex/'`），并校验引用目录存在且其内 skill id 集合与预期一致）
  - **验收断言**: `npx vitest run tests/unit/codex-plugin-consistency-core.test.ts` 全绿（T013 全部用例含新增负例通过）
  - **依赖**: T013, T014
  - **风险标注**: 无

- [ ] **T016** [US3] 接入 `validateRepository()`（`repo:check`）——**test-red → implementation-green 两步**（CRITICAL #3/#1）
  - **FR/plan 章节**: FR-007, FR-009；plan §3.3（接入 `validateRepository()`）、§3.3 关联测试 fixture 缺口段
  - **改动文件**: `scripts/lib/repo-maintenance-core.mjs`（新增 import + `validateRepository()` 内一行 `aggregateValidation('codex-plugin-consistency', ...)`，**是继 T007 之后对该文件的第二次编辑，必须串行**）、`tests/integration/repo-maintenance-sync-check.test.ts`（`beforeEach` 的 `mkdtempSync` fixture 补齐 `.codex-plugin/plugin.json`、`.agents/plugins/marketplace.json` 等必要文件）
  - **验收断言**:
    - **(a) 测试先行（红）**：在 `repo-maintenance-sync-check.test.ts` 追加断言"聚合 `checks[]` 中含 `codex-plugin-consistency:*` 前缀条目"，跑 `npx vitest run tests/integration/repo-maintenance-sync-check.test.ts`，此刻应失败（矩阵尚未接入 `validateRepository()`）
    - **(b) 实现转绿**：完成 `repo-maintenance-core.mjs` 改动 + fixture 补齐后重跑，全绿；本仓真实执行 `npm run repo:check` 输出含 `codex-plugin-consistency` 相关 check 行
  - **依赖**: T007, T011, T015, T018（CRITICAL #1：真实 `repo:check` 需 `skills-codex/`、两份 manifest 正式版本、matrix 实现、marketplace 内容全部就位才能真正跑通全绿；测试断言本身（步骤 a）可在 T015 完成后即写，但"转绿"验证必须等全部依赖就位）
  - **风险标注**: 无

- [ ] **T017** [US3] `release:check` 薄壳直调矩阵（扁平合并）——**test-red → implementation-green 两步**（CRITICAL #3/#1）
  - **FR/plan 章节**: FR-009；plan §3.3 CRITICAL 修订#3（release:check 薄壳直调）
  - **改动文件**: `scripts/validate-release-contracts.mjs`（追加 `import { validateCodexPluginConsistency } from './lib/codex-plugin-consistency-core.mjs'`，扁平合并 `payload.checks`/`payload.errors`/`payload.status`，check id 前缀 `codex-plugin-consistency:${c.id}`）、`tests/integration/release-contract-sync.test.ts`（在 T012 已有编辑基础上追加新断言）
  - **验收断言**:
    - **(a) 测试先行（红）**：在 `release-contract-sync.test.ts` 追加断言"`validate-release-contracts.mjs --json` 输出的 `checks[]` 含 `codex-plugin-consistency:` 前缀条目"，跑 `npx vitest run tests/integration/release-contract-sync.test.ts`，此刻应失败（薄壳尚未合并矩阵输出）
    - **(b) 实现转绿**：完成 `validate-release-contracts.mjs` 改动后重跑全绿；本仓真实执行 `npm run release:check` 输出出现 `codex-plugin-consistency` 相关 check 条目（如 `codex-plugin-consistency:manifest-exists:spectra`）
  - **依赖**: T012, T015, T018（CRITICAL #1：新增 `+T018`，因薄壳合并的矩阵结果需 marketplace 内容已存在才能产出真实 pass/fail 全貌）
  - **风险标注**: 无

- [ ] **T018** [US3] `codex-plugin-marketplace` 验证测试——schema 断言 + fresh-clone 验证（**内容已由 T002 落地，本 task 转为纯验证**，CRITICAL #2）
  - **FR/plan 章节**: FR-013；plan §3.3 check `marketplace-entries`、§3.5 结构性测试#3
  - **改动文件**: `tests/integration/codex-plugin-marketplace.test.ts`（新增；`.agents/plugins/marketplace.json` **不在本 task 创建**，已在 T002 落地）
  - **验收断言**:
    - **完整 schema 断言**（CRITICAL #6(c)）：`name`（字符串）、`interface.displayName`（字符串）、`plugins[]` 恰 2 条目、每条目 `source.path`/`source.source === 'local'`/`policy.installation === 'AVAILABLE'`/`policy.authentication === 'ON_INSTALL'`/`category` 均存在且类型正确
    - **路径存在性**：`source.path` 解析后目录存在且含 `.codex-plugin/plugin.json`（依赖 T009/T010 已存在）
    - **fresh-clone/新 worktree 验证**（CRITICAL #6(c)，假定 T002/T009/T010 已提交至本 feature 分支）：
      ```bash
      tmpdir=$(mktemp -d)
      git clone --branch claude/codex-plugin-distribution-2940d3 --single-branch . "$tmpdir"
      test -f "$tmpdir/.agents/plugins/marketplace.json"   # 应存在（tracked 文件随 clone 物化）
      test ! -e "$tmpdir/.agents/skills"                    # 应不存在（未被 track，worktree symlink 机制不适用于全新 clone）
      rm -rf "$tmpdir"
      ```
      对应 SC-006；测试用例内以 `execFileSync('git', ['clone', ...])` + `existsSync` 断言实现，而非仅注释声明
  - **依赖**: T002, T009, T010
  - **风险标注**: 关联风险1缓解链（T002 已解除 symlink 风险，本 task 是该缓解的下游落地验证）
  - **执行前提说明**: fresh-clone 验证要求 T002/T009/T010 的改动已 commit 到本 feature 分支（遵循项目"每个 task 完成后建议独立 commit"约定），若尚未 commit，该子断言暂时以 `it.skip`（记录原因）方式跳过，待相关 commit 落地后补跑，不得静默通过

- [ ] **T019** [US3] `codex-plugin-manifest` 结构性集成测试（对真实两份 manifest，FR-010(a) 必选层）——**先红后绿 + FR-006 hooks 断言**（CRITICAL #3/#6(b)）
  - **FR/plan 章节**: FR-010(a), FR-006；plan §3.5 结构性测试#2
  - **改动文件**: `tests/integration/codex-plugin-manifest.test.ts`
  - **验收断言**:
    - **(a) 写测试于草稿阶段（红）**：在 T009/T010 完成（草稿无 `version`/`description` 键）后即编写本测试文件，断言项包含 `manifest.version === contract.product.version`、`manifest.description === contract.product.pluginDescription`——此刻因草稿无该键，断言应**失败**（红）
    - 同时写入其余断言（JSON 合法、必需字段齐全、`mcpServers`/`skills` 字段值与文件系统实际路径吻合 `fs.existsSync` 复核、无 `hooks` 字段）——这些断言在草稿阶段即可为真（非受控字段无关）
    - **CRITICAL #6(b) 新增 FR-006 hooks ship 断言**：`plugins/spectra/hooks/hooks.json`、`plugins/spec-driver/hooks/hooks.json` 均存在且合法 JSON；其中定义的每个 hook 引用脚本路径（`fs.existsSync` 复核）均随包实际存在于文件系统
    - **(b) T011 完成后转绿**：重跑 `npx vitest run tests/integration/codex-plugin-manifest.test.ts`，version/description 断言转绿，其余断言保持绿
  - **依赖**: T009, T010（写红）+ T011（转绿）
  - **风险标注**: 无

**Checkpoint**: US1/US2/US3 均可独立通过其结构性测试验证；`npm run repo:check` 与 `npm run release:check` 应在 T016/T017 完成后全绿（人为制造漂移场景可在此手动验证 SC-003）。

---

## Phase 7: 可选层 — 真实 CLI E2E（FR-010(b)，跨 US1/US2/US3）

**目标**：结构性测试无法暴露"manifest 路径解析假设本身错误"这类风险（plan §6 风险3），需本机真实 CLI 复核。**条件语义明确**（WARNING #11）：本机已确认具备 codex 0.142.0 / 0.145.0-alpha.18，因此 T020/T021 在本次实施中为**必跑**（非"可选跳过"），仅当在缺乏 binary 的其他环境（如 CI）复跑时才降级为 skip。

- [ ] **T020** [P] `tests/e2e/feature-213-codex-plugin-install.e2e.test.ts` 编写
  - **FR/plan 章节**: FR-010(b)；plan §3.5 可选真实 CLI E2E 全部 7 步、§6 风险3/风险4
  - **改动文件**: `tests/e2e/feature-213-codex-plugin-install.e2e.test.ts`
  - **验收断言**:
    - **skip 机制（WARNING #10）**：模块加载期用 `execFileSync('which', ['codex'])` try/catch 探测，用 `describe.skipIf(!hasCodex)('feature-213 codex plugin install e2e', () => { ... })` 声明整个 describe block（而非逐 it 判断），无 binary 时 `npx vitest run` 该文件全部 skip，exit code 0
    - **有 binary 时**（硬要求5，本机适用）：`mkdtempSync` 建临时 marketplace 源目录，copy fixture 副本（`plugins/spectra/`、`plugins/spec-driver/`、`.agents/plugins/marketplace.json`，均已是**正式版本**——CRITICAL #1 新增依赖 T011，防止复制未同步版本号的占位 manifest）；marketplace.json 副本 `name` 改写为随机后缀；依次执行 `codex plugin marketplace add` → `codex plugin add spectra@<market>` / `codex plugin add spec-driver@<market>` → `codex plugin list --json` 断言两 plugin `status` 含 `installed` → `codex mcp list --json` 断言 `spectra` server 已注册
    - **清理链（WARNING #10）**：`afterAll` + `try/finally` 双保险，用 `spawnSync`（而非 `execFileSync`）逐项执行清理命令并记录每步 `status`/`stdout`/`stderr` 到数组，逆序：`codex plugin remove spectra@<market>` → `codex plugin remove spec-driver@<market>` → `codex plugin marketplace remove <market>` → `rmSync` 临时目录；测试末尾对该记录数组做**最终汇总断言**（如 `cleanupResults.every(r => r.status === 0)`），而非仅注释声明；单步失败不阻断后续清理执行（逐步 try/catch）
  - **依赖**: T009, T010, T011（CRITICAL #1：防止复制未经 T011 同步版本的占位 manifest 作为 fixture 源）, T018
  - **风险标注**: **风险3 + 风险4（plan §6 #3/#4）**

- [ ] **T021** 本机手动跑通真实 CLI 全链路一次 + 记录进 verification-report.md
  - **FR/plan 章节**: FR-010(b)；plan §6 风险3
  - **改动文件**: `specs/213-codex-plugin-distribution/verification/verification-report.md`（**归位说明，CRITICAL #8**：本文件是 spec-driver 标准流程制品，路径对齐仓库既有惯例 `specs/<NNN>-*/verification/verification-report.md`，豁免 plan §3.6 源码红线清单约束，不视为"新增源码文件"）
  - **验收断言**: 文档记录在本机实际执行 `codex plugin marketplace add` → `codex plugin add spectra@<market>` / `codex plugin add spec-driver@<market>` → `codex plugin list --json`（贴出真实输出，含 `installed` 状态）→ `codex mcp list --json`（贴出真实输出，含 `spectra` server）→ 完整清理链（`codex plugin remove` ×2 → `codex plugin marketplace remove` → 临时目录清理）的**真实命令与真实输出**
  - **依赖**: T020
  - **风险标注**: **风险3（plan §6 #3）**——本 task 是该风险的最终人工验证闭环；**条件语义（WARNING #11）**：本机已确认具备 codex binary，本 task 对本次实施为**必跑项**，不得以"CI 无 binary"为由跳过；若未来在真正缺乏 binary 的环境复跑本清单，则本 task 标注 N/A 并注明"本机 codex binary 缺失，已在 T020 记录 skip 证据"

**Checkpoint**: 全部三个 User Story 的独立测试路径（结构性 + E2E）均已覆盖，且 E2E 在本机已真实验证一次（非仅设计存在）。

---

## Phase 8: Polish — 收尾双运行时回归验证

- [ ] **T022** 全量回归验证 + Claude 侧既有测试结果比对（FR-011, SC-004, SC-005）
  - **FR/plan 章节**: FR-011；plan §3.5 双运行时回归段、§7 步骤8
  - **改动文件**: 无代码改动；产出 `specs/213-codex-plugin-distribution/verification/verification-report.md`（追加收尾章节，与 T021 共用同一文件）
  - **验收断言**:
    1. `npx vitest run` 全量套件零失败（贴出总用例数与通过数）
    2. `npm run build` 零类型错误
    3. `npm run repo:check` 零失败（含 `codex-plugin-consistency:*` 全部 check pass）
    4. `npm run release:check` 零失败（含 `codex-plugin-consistency:*` 前缀条目全部 pass）
    5. **基线比对（WARNING #9）**：将本次 `npx vitest run` 输出与 **T000 捕获的基线文件** `specs/213-codex-plugin-distribution/verification/baseline-pre-implement.txt` 逐条比对，重点核对涉及 `.claude-plugin/**`、canonical `skills/**`、`.mcp.json`、`hooks/hooks.json` 的既有测试用例名单，确认其通过/失败结果与基线完全一致（不新增失败，也不因改动"意外变绿"掩盖问题）
  - **依赖**: T000（基线）, T016, T017, T019, T021（含 T020 前置）——即 Phase 0-7 全部完成
  - **风险标注**: 无（收尾验证，覆盖 FR-011/SC-004/SC-005 不变量）

---

## FR 覆盖映射表（100% 覆盖核对）

| FR | 覆盖 Task |
|---|---|
| FR-001（spectra manifest） | T009 |
| FR-002（spec-driver manifest） | T010 |
| FR-003（mcpServers 引用） | T009, T019 |
| FR-004（spectra skills 直用 canonical） | T008, T009 |
| FR-005（spec-driver skills-codex） | T003, T004, T005, T006, T007, T010 |
| FR-006（无 hooks 字段 + hooks ship） | T009, T010, T013, T015, T019 |
| FR-007（矩阵进 validateRepository） | T013, T014, T015, T016 |
| FR-008（release-contract expectEqual） | T011, T012 |
| FR-009（双 check 链接入） | T016, T017 |
| FR-010（双层机械确认） | T019（必选层）, T020, T021（可选层，本机必跑） |
| FR-011（Claude 侧零变化） | T000, T022 |
| FR-012（waiver + 精确删除模拟） | T013, T014, T015 |
| FR-013（marketplace + 收窄 + fresh-clone） | T001, T002, T018 |

---

## Dependencies & Execution Order（v2 重算）

### 完整依赖边

```
T000 → T001, T003, T004, T008, T013, T014
T001 → T002
T004 → T005, T006
T003, T005, T006 → T007
T008 → T009
T007 → T010
T009, T010 → T012
T012 → T011
T013, T014 → T015
T002, T009, T010 → T018
T007, T011, T015, T018 → T016
T012, T015, T018 → T017
T009, T010, T011 → T019
T009, T010, T011, T018 → T020
T020 → T021
T000, T016, T017, T019, T021 → T022
```

### 关键路径（重算，CRITICAL #1：不再是"两条等长为8的链"）

由于 T020 新增对 **T011** 的依赖（防止 E2E 复制未同步版本的占位 manifest），E2E 分支的深度被拉长，**唯一关键路径**（长度9，10个节点）现为：

```
T000 → T004 → T005 → T007 → T010 → T012 → T011 → T020 → T021 → T022
```

（`T005` 亦可替换为同深度的 `T006`，二者并列，不影响链长）

release:check 接入路径（`T017`）与 repo:check 接入路径（`T016`）深度均为 7，均短于上述 E2E 主链（深度9），不再构成关键路径瓶颈——这是相对 v1 草稿"两条等长为8的链"的实质性修正：v1 未给 `T020` 加 `T011` 依赖时，release:check 链与 E2E 链恰好等长；加上该依赖后，E2E 链严格更长，成为唯一瓶颈。

### 各 Task 依赖深度（用于并行分组）

| 深度 | Task |
|---|---|
| 0 | T000 |
| 1 | T001, T003, T004, T008, T013, T014 |
| 2 | T002, T005, T006, T009, T015 |
| 3 | T007 |
| 4 | T010 |
| 5 | T012, T018 |
| 6 | T011, T017 |
| 7 | T016, T019, T020 |
| 8 | T021 |
| 9 | T022 |

### 可并行任务组

- **组 0**：`T000`（唯一根节点，必须独立最先完成）
- **组 A（深度1，6 个，互不依赖，可并行）**：`T001, T003, T004, T008, T013, T014`
- **组 B（深度2，5 个，可并行）**：`T002`（依 T001）、`T005`（依 T004）、`T006`（依 T004）、`T009`（依 T008）、`T015`（依 T013+T014）
- **组 C（深度3，单点瓶颈）**：`T007`（依 T003+T005+T006，同时是与 T016 的文件冲突串行起点）
- **组 D（深度4，单点瓶颈）**：`T010`（依 T007）
- **组 E（深度5，2 个并行）**：`T012`（依 T009+T010）、`T018`（依 T002+T009+T010）
- **组 F（深度6，2 个并行）**：`T011`（依 T012）、`T017`（依 T012+T015+T018）——两者分别修改 `release-contract-core.mjs`+manifest 与 `validate-release-contracts.mjs`，文件不重叠，可并行
- **组 G（深度7，3 个并行）**：`T016`（依 T007+T011+T015+T018）、`T019`（依 T009+T010+T011）、`T020`（依 T009+T010+T011+T018）——三者分别改 `repo-maintenance-core.mjs`+其测试、`codex-plugin-manifest.test.ts`、`feature-213-*.e2e.test.ts`，文件不重叠
- **组 H（深度8，单点，人工执行）**：`T021`（依 T020）
- **组 I（深度9，单点，收尾）**：`T022`

### Story 内部顺序

- US1（Phase 3）：T008 → T009（研究证据先于 manifest 编写）
- US2（Phase 4）：T010 单一 task，硬依赖 Foundational 全部完成（T007）
- US3（Phase 6）：测试先行（T013）→ 契约（T014）→ 实现（T015）→ 接入 repo:check（T016，红绿两步）/ release:check（T017，红绿两步）→ marketplace 验证（T018）→ manifest 结构性测试（T019，红绿两步），全程遵循"Tests FIRST"

---

## Implementation Strategy

### MVP First（P1 优先）

1. 完成 Phase 0（基线捕获）
2. 完成 Phase 1（Setup，`.agents` 收窄 + marketplace.json 内容落地，risk1 独立缓解）
3. 完成 Phase 2（Foundational，`skills-codex/` 双写基础设施）
4. 完成 Phase 3 + Phase 4（US1 + US2 两份 manifest 骨架，无受控字段）
5. 完成 Phase 5（版本字段正式化，T012 红 → T011 绿）
6. **STOP and VALIDATE**：跑 T009/T010 的 node:assert 断言与 T019(a) 断言，确认两份 manifest 基础形态与受控字段闭环均正确

### Incremental Delivery

1. Phase 0 + Setup + Foundational → 基础设施就绪（risk1/risk2 缓解落地，marketplace 内容已真实落盘）
2. US1（Phase 3）→ Spectra manifest 骨架可独立验证
3. US2（Phase 4）→ Spec Driver manifest 骨架可独立验证（依赖 Foundational 产出）
4. 跨故事集成（Phase 5）→ 版本字段闭环（TDD 红绿完整走完）
5. US3（Phase 6）→ 门禁生效，SC-003 可验证，`skills-reference`/waiver 精确删除负例均覆盖
6. E2E（Phase 7）→ risk3/risk4 真实验证（本机必跑，非可选）
7. Polish（Phase 8）→ 与 T000 基线比对，FR-011/SC-004/SC-005 收口

### 风险优先处置提示

- Phase 1（T002）完成即锁定 risk1，且 marketplace.json 内容已一并落地（不再拆两阶段），是本 feature 唯一"写穿主仓"风险窗口，执行时须严格按 8 步复核
- Phase 2 的 T005/T006 是 risk2 高发点，务必在其后紧跟 T007 做逐字节回归验证再进入 Phase 4；T007 与 T016 同改 `repo-maintenance-core.mjs`，必须串行不可并行
- Phase 7 的 T020/T021 在本机（已确认具备 codex 0.142.0/0.145.0-alpha.18）为**必跑项**，且 T020 依赖 T011（防止用占位版本 manifest 做 E2E fixture），不可提前于 T011 执行

---

## 审查落点确认表（Codex 对抗审查 8 CRITICAL + 4 WARNING）

| 编号 | 落点 Task | 修订摘要 |
|---|---|---|
| CRITICAL #1 | T007, T016, T017, T020, 依赖图与关键路径重算 | T016 依赖改 T007+T011+T015+T018；T017 依赖加 T012+T015+T018；T020 依赖加 T011；T007 显式声明改 `repo-maintenance-core.mjs:41` 且与 T016 同文件串行；关键路径重算为唯一长度9链 |
| CRITICAL #2 | T002, T018 | marketplace.json 内容真实写入并入 T002（原子7步内）；T018 改为纯验证（schema + fresh-clone）；T002 给出可执行回滚命令序列 |
| CRITICAL #3 | T012→T011 顺序、T016/T017/T019 | T012 移到 T011 之前（先红后绿）；T016/T017/T019 各拆 (a)test-red/(b)implementation-green 两步 |
| CRITICAL #4 | T008 | 扫描命令改 `rg -n ... plugins/spectra/skills`，期望 exit=1 空输出；task 性质改为"复跑校正既有文档" |
| CRITICAL #5 | T013, T015 | 矩阵补 `skills-reference:spectra`/`skills-reference:spec-driver` check；T013 加错误路径/缺失目录/身份不符负例 |
| CRITICAL #6 | T013(a waiver删除), T019(b hooks), T018(c fresh-clone+schema) | (a) waiver 精确删除模拟，error 指名 `spec-driver-refactor`；(b) FR-006 hooks ship 断言；(c) fresh-clone + 完整 marketplace schema 断言 |
| CRITICAL #7 | T009, T010, T011 | 初稿 manifest 不含 version/description key；T011 验收改 Node 精确相等断言 |
| CRITICAL #8 | T021, T022, 文档头部红线说明 | verification-report.md 归位至 `specs/213-.../verification/`，文档头部新增流程制品豁免说明 |
| WARNING #9 | T009, T010, T022, T006, T000 | node:assert 机械化断言；T022 增设 T000 基线比对；T006 明确落点 `spec-driver-wrapper-source-truth.test.ts`（与 T016 不冲突） |
| WARNING #10 | T020 | skip 机制改 `describe.skipIf(!hasCodex)`；清理链用 `spawnSync` 逐项记录 + 最终汇总断言 |
| WARNING #11 | Phase 7 标题、T021 | 明确本机具备 codex binary，T020/T021 本次实施为必跑项，非其他环境的 N/A 语义 |
| WARNING #12 | T003 | "一红两绿"：flag 新用例红，无 flag 守护与 remove 守护为 characterization 先天绿 |

---

## Notes

- `[P]` = 不同文件、无相互依赖，可并行执行
- `[USN]` = 归属的 User Story（US1/US2/US3）；Phase 0/1/2/5/7/8 不标注
- 每个 task 完成后建议独立 commit 或按逻辑组合并 commit（遵循项目"提交前 Codex 对抗审查"约定，implement 阶段每个 phase 完成后单独跑一次审查）
- T002（`.agents` symlink 过渡 + marketplace.json 落地）与 T020/T021（E2E 全局状态触碰）是本 feature 仅有的两处"操作不可逆/触碰外部状态"风险点，执行时须严格按验收断言逐步复核，不得跳步
- 避免：同一文件被多个 `[P]` 标记 task 同时改动（已核对：`T005`/`T006` 分别改 `codex-skills.sh`/`validate-wrapper-sources.mjs`；`T011`/`T017` 分别改 `release-contract-core.mjs`+manifest 与 `validate-release-contracts.mjs`；`T016`/`T019`/`T020` 分别改不同文件，均无重叠）；`T007`→`T016` 是本清单唯一显式标注的"同文件强制串行"对
