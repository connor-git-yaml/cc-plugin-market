# F281 验证报告 — F213 e2e 真实家目录隔离 + cwd 独立

> 独立 verify 子代理产出（2026-09-12）。原则：**每条声称亲跑核验，不采信转述；默认先找假绿 / over-claim**。
> 环境：工作树 `.claude/worktrees/f281-f213-e2e-isolation`（branch `281-f213-e2e-real-home-isolation`，HEAD `00684522`，改动未 commit）；codex-cli 0.153.4；vitest 3.2.4；node v24.14.0；macOS（`os.tmpdir()` = `$TMPDIR` = `/var/folders/38/…/T`）。
> 约束遵守：未在主 checkout 跑 vitest（仅只读 `cat` / `git grep`）；**未改动用户真实 `~/.codex/`**（所有 codex 探针一律 `HOME=<临时目录>`，唯一用真 HOME 的调用是任务指定的只读 `codex mcp list --json`）；无 git 写操作；除本报告外未改工作树任何文件（变异体临时放入 `tests/e2e/` 新文件名、跑完即删，终态 `git status` 仅 `.gitignore` / 测试文件 / `specs/281-*/` 三项）。
> 留存日志：scratchpad `verify-f281/`（`run-baseline.log`、`run-mutant-*.log`、`codex-home-snapshot-{before-all,before-test,after-test,final}.txt`）。

## 0. 结论速览

| 层 | 结论 |
|---|---|
| Layer 1 声称对账 | fix-report §1–§4、tasks T001–T005 **全部成立**；两处数字/转录精度问题（§1"4 个 server"实得 8；"F280 8186 passed"HEAD 文档无此数），不影响结论 |
| Layer 2 守护力 | 三条指定变异体（a / b / c）**全部被抓住**——其中变异体 (a) 与主线程"预期仍绿"**不同，实得红**（被既有 W4 落点断言抓住）；附加变异体 b3 证实 §2.3"旧取证点空转"论证；f1/f2 在合成判别环境复现 F282 签名 `expected 'node' to be 'spectra'` 并证明修复在同环境绿 |
| 泄漏 / 副作用 | 真 `~/.codex` 零 e2e 残留、`config.toml` sha 不变；`$TMPDIR` 零残留；**发现一个残余：codex 缺席（skip 态）时每次跑仍会创建 5 个空临时目录且无人清理**（3 个既有 + F281 新增 2 个，见 §4） |
| 总判定 | **PASS**（残余风险 R1 为非阻塞、可作 follow-up） |

## 1. 验证方法

1. **声称对账（Layer 1）**：对 fix-report §1 三条探针逐条复现（全部 `HOME=<tmp>`）；对 §2 四条修复点逐行对 diff；`git check-ignore` / `git ls-files` 核 `.gitignore`；工作树实跑新版并做 `~/.codex` 跑前/跑后快照 diff + `find -newer <标记>`。
2. **守护力（Layer 2）**：用脚本对新版测试做**精确字符串替换生成变异体**，每处替换断言"恰好命中 1 次"（防静默 no-op 变异）；因 vitest 的 e2e project `include` 仅 `tests/e2e/**/*.e2e.test.ts`（scratchpad 路径实测 `No test files found`），变异体以 `tests/e2e/f281-verify-mutant-<name>.e2e.test.ts` 临时放入工作树、跑完立即 `rm`。**涉及去掉 HOME 注入的变异体一律把 vitest 父进程的 `HOME` 指到 scratchpad 假家目录**，保证真家目录不被触碰（该模拟对"codex 装到了继承的 HOME 而非 isolatedHome"这一判定维度是忠实的）。
3. **合成判别环境**（替代在主 checkout 做 A/B）：`<scratch>/synth-proj/.codex/config.toml` 写 `[mcp_servers.spectra] command="node"`；`<scratch>/fake-home-f2/.codex/config.toml` 写 `[projects."<synth-proj>"] trust_level="trusted"`——与主 checkout 的实况（项目级 config + 真家目录 trusted 登记）同构，但不碰真家目录。
4. **before 半不重跑**（会在真家目录装卸插件），只核对主仓 `.codex/config.toml` 内容与 HEAD 已提交的 F282 记录一致性。

## 2. Layer 1 — 声称对账表

### 2.1 fix-report §1 根因与探针

| # | 声称 | 命令（摘要） | 关键输出 | 判定 |
|---|---|---|---|---|
| 1a | `HOME=<tmp>` + cwd=主仓根 → 项目级 config **不生效** | `cd <主仓> && HOME=<tmp> codex mcp list` / `--json` | `No MCP servers configured yet…` / `[]`，exit 0 | ✅ 复现 |
| 1b | 真 HOME + cwd=`/tmp` → 列出真家目录 server（只读） | `cd /tmp && codex mcp list --json` | **8** 个 server（6 enabled + 2 disabled：codex_app、computer-use 为 disabled）；`spectra` 的 `command=spectra`（来自用户级 config 行 54–56） | ⚠️ 定性成立；**"4 个"数字不可复现（实得 8）** |
| 1c | `HOME=<tmp>` 下 codex 自建 `<tmp>/.codex/` | `ls -laR <tmp>` | 出现 `<tmp>/.codex/tmp/arg0/` | ✅ 复现 |
| 1d（附加） | "Codex 只对 trusted 项目加载项目级配置" | `<tmp2>/.codex/config.toml` 写 `[projects."<主仓>"] trust_level="trusted"`，`cd <主仓> && HOME=<tmp2> codex mcp list --json` | 列出 `spectra` → `"command": "node", "args": ["<主仓>/dist/cli/index.js","mcp-server"]`；同 HOME 但 `cd /tmp` → `[]` | ✅ 机制确证：trusted ∧ cwd=仓根 才加载，且项目级覆盖 command 为 `node` |
| 1e（附加） | 根因步骤 2"用户真 `~/.codex/config.toml` 把该仓登记为 trusted" | `grep -n -A1 'cc-plugin-market' ~/.codex/config.toml`（只读） | 行 64–65：`[projects."/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market"]` `trust_level = "trusted"` | ✅ |
| 1f（附加） | before 半一致性：主仓 `.codex/config.toml` 内容 ↔ F282 记录"实得 `'node'`" | `cat <主仓>/.codex/config.toml`；`git grep` HEAD 文档 | 文件（mtime Sep 5 17:49，未跟踪 `??`）：`[mcp_servers.spectra] command = "node" args = ["<主仓>/dist/cli/index.js","mcp-server"]`；HEAD `docs/design/milestone-M10-….md:142`：「vitest 8178 passed · 1 failed——唯一失败 = feature-213『CODEX_HOME unset → 默认 ~/.codex』：断言 `command==='spectra'` 得 `node`」；`:205`「干净 clone 不含未跟踪的 `.codex/config.toml`，F213 e2e 在那里通过」 | ✅ 一致。**注**：`:142` 的早期归因（"真实配置里另有 perplexity 等 `command=node` 的 server"）与本报告 1b/1d 矛盾——用户级 `spectra` 段是 `command="spectra"`，测试按 `name==='spectra'` 取值，perplexity 不可能被选中；`'node'` **只能**来自项目级 config，`:205` 与 fix-report 5-Why 的归因才是对的。主线程引述的"39309ms"数字未在 HEAD 文档出现（沿用转述） |

### 2.2 fix-report §2 四条修复点 ↔ diff

| # | 修复点 | diff 证据（新版行号） | 判定 |
|---|---|---|---|
| 2.1 | 每场景 `mkdtemp` 临时 HOME 并注入子进程 | L80 `const isolatedHome = mkdtempSync(join(tmpdir(), 'codex-e2e-home-'))`；L95 `{ ...process.env, HOME: isolatedHome }`；L85 `effectiveCodexHome = injectedCodexHome ?? join(isolatedHome, '.codex')`；`homedir` import 已移除（L44） | ✅ |
| 2.2 | `spawnSync` 固定 `cwd: fixtureRoot` | L106 | ✅ |
| 2.3 | 清理链 +`rm 临时 HOME`（5→6 / 6→7）；守卫取证点在删家目录**之前** | L143 `['rm 临时 HOME', isolatedHome]` 为 rmSteps 末项；L136 cache rm 为首项；L152–154 `if (target === marketCachePath) cacheResidueAfterRm = existsSync(marketCachePath)` 紧跟该步；L163 `? 6 : 7`；L173 新增 `not.toBeNull()` 守卫 | ✅（顺序：cache → fixtureRoot → [临时 CODEX_HOME] → 临时 HOME，取证点严格早于两种 home 的删除） |
| 2.4 | `.gitignore` +`.codex/config.toml` | `git check-ignore -v .codex/config.toml` → `.gitignore:142:.codex/config.toml`；`git check-ignore -v .codex/skills/` → exit 1（不忽略）；`git ls-files .codex` = 9 个 `skills/**/SKILL.md`；`git ls-files .codex \| git check-ignore --stdin --no-index` → exit 1（**零**已跟踪文件被新规则命中） | ✅ |
| — | "加不改：原断言逐字保留" | diff 中改动的 `expect(` 仅 W4 两处：`existsSync(join(effectiveCodexHome,'plugins','cache',market))` → `existsSync(marketCachePath)`（同值）与 afterAll 守卫改读 `cacheResidueAfterRm`；F213 原五组断言（status 0 / names / installed / spectra 注册 / `command==='spectra'`）零改动；`hasCodexBinary` / `describe.skipIf` 在 diff 中 0 行 | ✅（准确说法：F213 原断言逐字保留，W4 守卫按 §2.3 改了取证时点） |
| — | 改动统计 | `git diff HEAD --stat`：2 files，+45 −12 | 记录 |

### 2.3 fix-report §3 红先行 / A/B

| 半 | 来源 | 本代理处理 | 判定 |
|---|---|---|---|
| before（主 checkout 红） | F282 门禁记录（HEAD doc:142） | 未重跑（会动真家目录）；按 2.1-1f 核对一致 | ✅ 沿用 + 一致性核实 |
| after（主 checkout 绿 2 passed 404ms） | 主线程转述 | 未重跑（禁在主 checkout 跑 vitest） | 沿用 |
| after（工作树绿） | 本代理亲跑 | `npx vitest run tests/e2e/feature-213-codex-plugin-install.e2e.test.ts --reporter=verbose` → **2 passed**（200ms / 195ms，Duration 599ms）；global-setup 报 dist 指纹匹配未重建（`dist/.spectra-build-meta.json` commit == HEAD） | ✅ |
| 判别性 A/B（替代） | 本代理合成环境（§1 方法 3） | f1（修复完整 + cwd 指向含项目级 config 的 synth-proj）**绿 2/2**；f2（去 HOME 注入 + 同 cwd + 父进程 HOME=trusted 假家目录）default 场景**红：`AssertionError: expected 'node' to be 'spectra'`**（与 F282 签名逐字相同），custom 场景绿 | ✅ 同环境改前红改后绿，且不碰真家目录 |
| "200ms 就跑完真实安装链"可信度校准 | 手工复演 | 临时 HOME 下逐步计时：marketplace add 32ms / plugin add 33+65ms / list 31ms / mcp list 36ms / remove ×3 33–43ms（含 `node -e Date.now()` 各 ~2×15ms 测量开销）；`<HOME>/.codex/config.toml` 出现 `[marketplaces.<market>] source_type="local"` + 两个 `[plugins."…@<market>"] enabled=true`；`plugin add` 输出 `Installed plugin root: <HOME>/.codex/plugins/cache/<market>/spectra/4.5.0`；卸载后 cache 目录**确实残留**（与测试注释一致，故显式 rm 必要） | ✅ 真实安装链，非 skip 假绿 |

### 2.4 类型 / lint

| 检查 | 命令 | 结果 |
|---|---|---|
| tsc 单文件 | `npx tsc --noEmit --skipLibCheck --module nodenext --moduleResolution nodenext --target es2022 --types node --esModuleInterop tests/e2e/feature-213-codex-plugin-install.e2e.test.ts` | exit 0（0.42s） |
| eslint | `npx eslint tests/e2e/…` | **N/A**：仓库无 `eslint.config.*`（`npm run lint` = `tsc --noEmit`，其 tsconfig 不含 tests/，故上面的 ad-hoc tsc 才是该文件唯一类型门） |

## 3. Layer 2 — 守护力表

变异体全部由 `gen-mutants.mjs` 生成（每处替换恰好命中 1 次）；运行 `run-mutant.sh <name> [父进程 HOME]`；"红/绿"以 vitest exit code 与 `Test Files` 行为准。

| 变异体 | 改动 | 父进程 HOME | 结果 | 抓住？ | 解读 |
|---|---|---|---|---|---|
| **(a)** `a-no-home-injection` | `{ ...process.env, HOME: isolatedHome }` → `{ ...process.env }` | `<scratch>/fake-home-a`（空） | exit 1；default 场景 **×** `未在 <isolatedHome>/.codex 下找到 marketplace cache，子进程实际用的可能是别的 CODEX_HOME: expected false to be true`；custom 场景 ✓；跑后 `fake-home-a/.codex/plugins/cache/cc-plugin-market-e2e-…` **泄漏 1 个**、`config.toml` 被卸载链清空 | ✅ 红 | **与主线程"预期仍绿"不同**：HOME 注入被既有 W4 落点断言（L221）守住——codex 装进了继承的 HOME，测试却按 isolatedHome 找，立刻红。判别与项目级 config 无关，在任何环境都成立。用真 HOME 跑会得到同样的红并在真家目录留下 cache 泄漏，故本代理用假家目录模拟 |
| **(b1)** `b1-rm-target-changed` | rmSteps 首项目标 `marketCachePath` → `join(fixtureRoot,'wrong-target')` | 真（子进程仍隔离） | exit 1；两场景 afterAll **FAIL** `cache rm 步骤未执行，无法取证: expected null not to be null` | ✅ 红 | 新增 `not.toBeNull()` 守卫抓到"取证点从未命中" |
| **(b2)** `b2-rm-wrong-path` | 保留目标标签，`rmSync` 实际删 `wrong-target` | 真（子进程仍隔离） | exit 1；两场景 afterAll **FAIL** `cache 残留在 <effectiveCodexHome>…: expected true to be false` | ✅ 红 | 取证点在删家目录之前，残留被如实看到；家目录随后仍被 `rm 临时 HOME` 回收（`$TMPDIR` 零残留） |
| **(b3)** `b3-old-guard-plus-wrong-rm` | b2 + 把 afterAll 守卫换回旧式 `existsSync(marketCachePath)` | 真（子进程仍隔离） | exit 0；**2/2 绿** | —（故意）| **证实 fix-report §2.3 论证**：一旦家目录整体删除，旧取证点恒 `false`、守卫空转——错删也全绿。新取证点是承重的 |
| **(c)** `c-expected-steps-wrong` | `? 6 : 7` → `? 5 : 6` | 真 | exit 1；两场景 afterAll **FAIL** `清理步数异常: [{…6 项…}]` | ✅ 红 | 步数断言有效 |
| (e) `e-no-cwd` | 去掉 `cwd: fixtureRoot` | 真（子进程仍隔离） | exit 0；2/2 绿 | —（如实）| **工作树环境不判别 cwd 维度**（仓根无项目级 config，且子进程 HOME 隔离后 trust 为空） |
| (f1) `f1-cwd-synth-proj-home-isolated` | `cwd` 改指含 `[mcp_servers.spectra] command="node"` 的 synth-proj（HOME 注入保留） | 真 | exit 0；2/2 绿 | —（正向）| HOME 隔离**单独**即可让项目级 config 不生效 → `cwd: fixtureRoot` 是纵深防御而非唯一防线 |
| (f2) `f2-cwd-synth-proj-no-home-injection` | (a) + (f1) | `<scratch>/fake-home-f2`（登记 synth-proj trusted） | exit 1；default **×** `expected 'node' to be 'spectra'`；custom ✓；`fake-home-f2/.codex/plugins/cache/` 泄漏 1 个 | ✅ 红 | 在合成判别环境**逐字复现 F282 签名**；与 f1 构成同环境 A/B |

补充观察（变异体 c 的失败 JSON 暴露的 stderr）：codex 0.153.4 在 HOME 位于 `$TMPDIR` 下时，`plugin remove` / `marketplace remove` 打 `WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "/var/folders/…/T/"`，**exit 仍为 0**（清理链 `every(status===0)` 通过）。在 scratchpad（`/private/tmp/claude-501/…`，非系统 temp dir）复演时无此警告，说明判据是 `std::env::temp_dir()` 前缀。

## 4. 泄漏 / 副作用检查

| 项 | 命令 | 结果 |
|---|---|---|
| 真 `~/.codex` — 新版测试运行窗口 | before-test / after-test 快照（`find ~/.codex -exec stat '%N\|%m\|%z'`，排除 sessions/log/logs）diff；`find ~/.codex -newer marker-before-test` | 唯一差异 `logs_2.sqlite-wal` 的 mtime——`lsof` 归属 PID 77459 `/Applications/ChatGPT.app/Contents/Resources/codex … app-server`（启动于 20:08:32，早于本次验证 3h），且其 mtime 在无测试运行的间隙也持续变化 → **环境噪声，非测试所致**。`~/.codex/tmp/arg0` 在该窗口**未被触碰**（codex 的 per-process scratch 落在了 isolatedHome，旁证 HOME 隔离生效） |
| 真 `~/.codex` — 全程（含 8 个变异体 + skip 态跑） | before-all vs final diff（排除 `logs_2.sqlite*`） | 仅 `sqlite/codex-dev.db-wal`（`lsof` → ChatGPT.app PID 77432）与 `tmp/arg0`（任务指定的真 HOME 只读探针 1b 自身的 arg0 子目录创建/退出即删）；**`plugins/cache/` 零 `cc-plugin-market-e2e-*`**；`config.toml` sha `9d578656…` / mtime 23:11:45 **全程不变**；`grep -c cc-plugin-market-e2e ~/.codex/config.toml` = 0 |
| `$TMPDIR` / `/tmp` 残留（跑前基线 → 基线跑后 → 全部变异体跑后） | `ls -ldT $TMPDIR/codex-e2e-* $TMPDIR/codex-home-e2e-* /tmp/codex-e2e-* /tmp/codex-home-e2e-*` | 三个时点均 **零残留**（含变异体 a/f2 default 场景失败路径——`finally → cleanup()` 仍回收 fixtureRoot / isolatedHome；泄漏只发生在假家目录的 `plugins/cache`，即修复所针对的那类泄漏） |
| **skip 态（无 codex）临时目录** | 用只含 node/npm/npx/git 的 PATH 跑（`which codex` → not found，`Tests 2 skipped`） | **创建并泄漏 5 个空目录**：`codex-e2e-*` ×2（fixtureRoot）、`codex-e2e-home-*` ×2（F281 新增 isolatedHome）、`codex-home-e2e-*` ×1（custom CODEX_HOME）——`describe.skipIf` 的工厂在收集期照常执行 `mkdtempSync`，而 afterAll 对 skipped suite 不运行。已由本代理清理 |
| 工作树文件面 | `git status --short` | 终态仅 ` M .gitignore`、` M tests/e2e/feature-213-…`、`?? specs/281-…/`；`tests/e2e/f281-verify-*` 无残留 |

## 5. tasks.md 对账

| 任务 | 判定 | 依据 |
|---|---|---|
| T001 探针 | **PASS**（数字瑕疵） | §2.1 1a/1b/1c 复现；附加 1d/1e 证实 trusted 机制；"4 个 server"实得 8 |
| T002 临时 HOME + `cwd: fixtureRoot` | **PASS** | §2.2 2.1/2.2；变异体 a 红、f1/f2 A/B |
| T003 清理链 + 取证点前移 | **PASS** | §2.2 2.3；变异体 b1/b2/c 红、b3 证空转 |
| T004 `.gitignore` | **PASS** | §2.2 2.4（命中行 142；9 个 tracked skills 零误伤） |
| T005 工作树 2/2 绿 + 真家目录零残留 | **PASS** | §2.3 亲跑 2 passed；§4 零残留、config.toml sha 不变 |
| T006 独立子代理对抗复审 | 未到 | 非本代理职责 |
| T007 verify 报告 | 本报告 | 判别性 A/B 以合成环境（f1/f2）替代主 checkout 实跑；主 checkout after 半沿用主线程转述 |
| T008 全量门禁 | 未到 | — |
| T009 rebase / ff push | 未到 | — |

## 6. 总结论

**PASS**。修复的四个点在 diff 中逐一成立且各有变异体证明承重（a / b1 / b2 / c 全红；b3 证明旧取证点会空转）；根因归属（项目级 `.codex/config.toml` 经 trusted 登记覆盖 `command`）由探针 1d/1d' 与合成 A/B（f1 绿 / f2 红且签名与 F282 逐字相同）双证；真家目录与临时目录在真实运行路径上零残留。

### 残余风险 / 备注（按严重度）

- **R1（WARNING，非阻塞，建议 follow-up）**：codex 缺席时（CI runner、无 codex 的开发机）每次跑本文件仍创建 **5 个空临时目录且永不清理**——`mkdtempSync` 在 describe 收集期执行，skipped suite 不跑 afterAll。fixtureRoot ×2 + custom CODEX_HOME ×1 为 F240 起既有，F281 新增 isolatedHome ×2。CI runner 一次性，无累积；本地无 codex 机器会累积。修法方向：`mkdtempSync` 移入 `beforeAll`，或 `!hasCodex` 时在工厂内短路。**不在本卡范围**，如实登记。
- **R2（INFO）**：codex 0.153.4 对 `$TMPDIR` 下的 HOME 打"Refusing to create helper binaries under temporary dir"WARNING（exit 0）。若未来版本升为非零退出，`add.status`/清理链 `every(status===0)` 会变红——方向是 fail-loud，不是假绿；届时需把 HOME 放到非 temp_dir 前缀或放宽 stderr 判据。
- **R3（INFO）**：`cwd: fixtureRoot` 在任何环境都不可被测试判别（f1 证明 HOME 隔离单独足够；e 证明去掉 cwd 仍绿）。它是纵深防御（防 codex 未来不经 trusted 也读项目级 config），若被误删无测试报警。
- **R4（INFO）**：afterAll 守卫（b1/b2/c）失败时 vitest 输出为 `Test Files 1 failed` + **`Tests 2 passed`**、exit 1——门禁按 exit code 判无问题，但人眼只看 `Tests` 行会误读为通过。
- **R5（INFO，转录精度）**：fix-report §1"真家目录的 4 个 server"实得 8；"F280 门禁 8186 passed"未在 HEAD 文档出现（M10 doc:142 记 F282 基线为 8178 passed · 1 failed）；§3"437 ms"本代理实得 599ms（tests 396ms）。均不影响结论，建议 fix-report 改为可复现口径或标注取数时点。
- **R6（INFO，文档归因）**：HEAD `docs/design/milestone-M10-….md:142` 早期归因"真实配置里另有 perplexity 等 `command=node`"与实证不符（用户级 spectra 段 `command="spectra"`；测试按 name 精确取 spectra）；`:205` 与 fix-report 5-Why 的项目级 config 归因才正确。建议主线程在 M10 §12 收口时把 `:142` 的归因句标注"已被 :205 取代"。
- **R7（自述边界）**：Windows `USERPROFILE` 未处理；父进程 `homedir()` 不受影响（测试内已不再使用）。
