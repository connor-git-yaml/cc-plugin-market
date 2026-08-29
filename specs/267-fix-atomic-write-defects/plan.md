# 修复计划 — F267 Claude 侧 atomic-write 缺陷群

> 卡面 SSoT：`docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-D
> 诊断依据：`specs/267-fix-atomic-write-defects/fix-report.md`（7 条缺陷 D1-D7，5-Why 根因，5 消费方评估表）
> parity 参照：`plugins/spec-driver/scripts/lib/codex-hooks-installer.mjs`（F262 / W3，L109-203 `resolveWriteTarget`/`readTargetMode`/`writeJsonAtomic`）

## 范围与不碰清单

**改动文件（3 个源码 + 3 个测试）**：
- `src/utils/atomic-write.ts`（合同扩展但签名不变）
- `src/hooks/hook-installer.ts`（三处：脚本 chmod、`.bak` EXCL、remove 备份）
- `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`（两处 `.find`，L416/L516）
- `tests/unit/atomic-write.test.ts`（新增 inode 维度用例组 + 裁决一条旧用例）
- `tests/unit/hook-installer.test.ts`（新增 chmod 保全 / `.bak` EEXIST / remove 备份用例）
- `tests/unit/codex-runtime-doctor.test.ts`（新增畸形段屏蔽 fixture，若该文件未覆盖 probe 函数则改为新增 `codex-runtime-doctor-io.test.ts`——implement 阶段先 `Grep -n 'probeCodexPluginManifest\|probeCodexCliInventory'` 确认现状后再定文件）

**不碰（卡面硬约束 + fix-report 复核后维持）**：
- `src/hooks/git-hook-installer.ts`（P0-C 独占）
- `src/knowledge-graph/module-derivation.ts`（P0-C 独占）
- `plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs`（G0 独占）
- `src/knowledge-graph/persistence.ts:156`、`src/batch/checkpoint.ts:60`、`src/scaffold-kb/kb-writer.ts:35-53`、`plugins/…/graph-bootstrap-status.mjs`（4 处我方产物 tmp+rename，理由复核见下）

### 对「4 处不改」理由的复核结论

fix-report 给出的共同判据是「写的都是我方产物，不存在用户设过的 mode / 用户软链托管这两个本卡要保全的对象」。逐条复核：

| 站点 | 复核 | 结论 |
|------|------|------|
| `persistence.ts:156` | `.spectra/` 下图产物，路径由本工具生成，非用户配置文件常见托管对象 | 理由成立。tmp 固定名并发面客观存在但登记 dogfooding ledger 已是正确分流——改它要碰 `await fsp.rename` 的 async 错误语义，扩面超出"缺陷群"范围 |
| `checkpoint.ts:60` | batch 单进程独占写，无并发调用方 | 理由成立，无需动 |
| `kb-writer.ts:35-53` | 已有独立 `.bak` + 回滚（比 atomic-write 现状更完整），改一份"更完整"的实现换一份新引入的通用实现是净风险 | 理由成立，且优先级方向正确（不能因为"统一"而降级一个已经更好的实现） |
| `graph-bootstrap-status.mjs` | plugin 侧 `.mjs`，零构建分发；TS 侧改动不触达 | 理由成立（包边界），且与 F262 头注释「包边界强制产生重复」同一裁决模式 |

四处维持不改，plan 层面无异议。

---

## 1. 变更清单

### 1.1 `src/utils/atomic-write.ts` — 合同扩展

保持导出签名 `writeAtomicJson(filePath: string, data: unknown): void` 不变（同步、无 diagnostics 参数、无 options）。内部按 parity 四步骤实现，但**不引入 diagnostics 数组**（见 §2 的裁决）：

```ts
const DEFAULT_TARGET_MODE = 0o600; // 首次创建默认；与 codex 侧一致（卡面硬约束 3）

function resolveWriteTarget(targetPath: string): string {
  try {
    if (fs.lstatSync(targetPath).isSymbolicLink()) return fs.realpathSync(targetPath);
  } catch {
    // 不存在 / 不可读：按字面路径处理，写入自身会给出准确 errno（悬空软链的已知边界见 fix-report）
  }
  return targetPath;
}

function readTargetMode(filePath: string): number {
  try {
    return fs.statSync(filePath).mode & 0o7777; // 含 setuid/setgid/sticky
  } catch {
    return DEFAULT_TARGET_MODE; // 不存在 / stat 失败 → 首次创建默认
  }
}

export function writeAtomicJson(filePath: string, data: unknown): void {
  const resolvedPath = path.resolve(filePath);
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true }); // 目录 mode 维持现状，不比照 parity 加 0o700（见 §2.4 裁决）

  const writeTarget = resolveWriteTarget(resolvedPath); // 软链跟随（收 D1）
  const targetMode = readTargetMode(writeTarget);        // mode 快照（收 D2）
  const tmpPath = `${writeTarget}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`; // 随机名（收 D3）
  const content = JSON.stringify(data, null, 2); // 不加尾换行（序列化面不动，见 §2.3）

  try {
    fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' }); // O_EXCL
    try {
      fs.chmodSync(tmpPath, targetMode);
    } catch {
      // chmod 失败不阻断写入（无权限位文件系统的风险面本就不存在）；降级信号处置见 §2.2
    }
    fs.renameSync(tmpPath, writeTarget);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true }); // 失败清理（收 D4）
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw error;
  }
}
```

要点：
- `resolveWriteTarget` 在 `writeAtomicJson` 顶层调用一次，后续 `readTargetMode`/`tmpPath`/`renameSync` 全部用 `writeTarget`（真实路径），不是原始 `resolvedPath`——这是 D1 的关键：tmp 与目标必须同目录，若目标是软链而 tmp 建在软链所在目录、rename 到软链路径，则依旧会拆链；必须 rename 到 `realpathSync` 解出的真实路径。
- `mkdirSync` 仍在软链解析之前执行——目录必须先存在软链解析才可能成功；若目标本身尚不存在（无软链），`resolveWriteTarget` 直接回落字面路径，行为与现状一致。

### 1.2 `src/hooks/hook-installer.ts` — 三处改动

**改动 A：脚本 chmod 保全（收 D5，L146-148）**

```ts
const scriptPath = join(hooksDir, 'spectra-context.sh');
const scriptExisted = existsSync(scriptPath); // 写入前先判存在性——写入本身不改变 mode，判断时机不敏感
writeFileSync(scriptPath, generateContextScript(), 'utf-8');
if (scriptExisted) {
  // 保全用户自设 mode（0700 / 0777 均如实保留），不做"顺手加固"或"顺手收紧"
  const preservedMode = fs.statSync(scriptPath).mode & 0o7777;
  chmodSync(scriptPath, preservedMode);
} else {
  chmodSync(scriptPath, 0o755); // 仅首次创建给默认值，与 codex 侧 hook 脚本默认一致
}
```

裁决："已存在"用 `existsSync` 在 `writeFileSync` **之前**判定，而不是比较前后 mode——因为 `writeFileSync` 对已存在文件不改变其 mode（只有 truncate+write 内容，不动权限位），所以时机不敏感；选择在写入前判定是为了让"是否新建"的判断依据独立于写入动作本身，避免未来写入实现变化（如换成 atomic-write）引入副作用后此逻辑失真。

**改动 B：`.bak` 加 `COPYFILE_EXCL`（收 D6，L126-128）**

```ts
if (existsSync(settingsPath)) {
  try {
    copyFileSync(settingsPath, `${settingsPath}.bak`, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      console.log('[spectra] .bak 已存在，保留最早备份，本次不覆盖。');
    } else {
      throw error;
    }
  }
}
```
与 codex 侧一致：EEXIST 视为正常路径（保留最早那份），非 EEXIST 错误照常抛出中断安装（不能吞掉磁盘满/权限错误等真实故障）。

**改动 C：`removeClaudeHook` 对称加备份（收 D6 补充，L192-193 前）**

```ts
// 与 installClaudeHook 对称：卸载前也备份，误删可回滚
try {
  copyFileSync(settingsPath, `${settingsPath}.bak`, fs.constants.COPYFILE_EXCL);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
    console.log('[spectra] .bak 已存在，保留最早备份，本次不覆盖。');
  } else {
    throw error;
  }
}
writeAtomicJson(settingsPath, updated);
```
提取重复的"备份 try/catch"为模块内私有函数 `backupSettingsIfAbsent(settingsPath: string): void`，install/remove 两处调用，避免两份即将漂移的重复代码（"消除重复"原则）。

### 1.3 `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs` — 两处 `.find`

**L416（`probeCodexPluginManifest`）**：把可用性判据（`marketplace` 非空）折进 `.find` 谓词本身，而不是 find 之后再判：

```js
const entry = parsePluginRegistry(read.text).find(
  (item) => item.name === product && item.enabled && item.marketplace,
);
if (!entry) return { outcome: 'absent', errorClass: null };
```
（原 `if (!entry || !entry.marketplace)` 收窄为 `if (!entry)`，因为不可用的候选已经在 `.find` 内被跳过，不会被赋给 `entry`。）

**L516（`probeCodexCliInventory`）**：可用性判据是"能解析出 semver"，计算成本非零（需调用 `normalizeVersion`），若直接塞进 `.find` 谓词会对每个候选重复计算。改用 `filter().map().find()` 链，一次计算、跳过不可用候选、避免重复求值：

```js
const candidates = installed
  .filter((item) => item?.name === product && item?.enabled === true)
  .map((item) => ({
    item,
    normalized: normalizeVersion(typeof item.version === 'string' ? item.version : null),
  }));
const resolved = candidates.find((c) => c.normalized.semver !== null);
if (!resolved) return { outcome: 'absent', errorClass: null };
return { outcome: 'found', errorClass: null, semver: resolved.normalized.semver, rawShape: resolved.normalized.rawShape };
```

**两处是否对称处理**：语义对称（都是"把可用性判据折进搜索，不让第一个形式匹配但语义不可用的候选提前终止搜索"），但**实现形态不对称**——L416 判据零成本（属性存在性）用单层 `.find`；L516 判据有计算成本（版本解析）用 `filter+map+find` 避免重复求值。plan 明确记录这个不对称是刻意的（避免为了"看起来对称"而在 L516 引入重复计算或副作用闭包），不是遗漏。

---

## 2. `writeAtomicJson` 合同变化裁决

### 2.1 签名不变
`writeAtomicJson(filePath: string, data: unknown): void`。理由：5 个消费方全部无调用方改签（fix-report 已确认），加参数会让所有调用点被迫改动，扩大本卡改动面且无实际收益（Claude 侧无第二个需要 diagnostics 的调用方，不像 codex 侧 `commit()` 有上层收集器）。

### 2.2 降级信号往哪放（chmod 失败等新增失败模式）
Parity 参照用 `diagnostics` 数组由调用方传入并汇总打印。Claude 侧 `writeAtomicJson` 是**多消费方共享的底层工具函数**（5 个调用点，4 个不需要关心权限细节），若给它加 `diagnostics` 参数：
- 要么设默认值 `[]`（每次调用产生一个新数组，warning 落地即被丢弃——parity 注释明确指出这是反模式，"忘传即 TypeError" 的设计初衷就是防这个）；
- 要么设为必填，逼所有 5 个调用方都传（其中 3 个我方产物场景根本没有"权限被放宽"这个关心点，纯属噪声）。

**裁决**：`writeAtomicJson` 不加 `diagnostics` 参数。chmod 失败（无权限位文件系统等极端场景）**降级为 `console.warn`**，直接在 `atomic-write.ts` 内部打印，不做结构化返回：

```ts
try {
  fs.chmodSync(tmpPath, targetMode);
} catch (error) {
  console.warn(
    `[spectra] 目标文件权限保全失败（${writeTarget}），已用默认权限写入: ${(error as NodeJS.ErrnoException).code ?? error}`,
  );
}
```
理由：(a) 这是一个真实存在但极端罕见的失败模式（exFAT/SMB/容器 overlay），把它做成结构化返回值会为 5 个调用方全部引入一个"可能返回诊断信息"的心智负担，与"不添加未要求的优化"原则冲突；(b) `console.warn` 与本文件既有的错误处理风格一致（`hook-installer.ts` 已大量使用 `console.log` 做用户可见提示，不是结构化返回）；(c) chmod 失败**不影响写入正确性**（最终权限不宽于 tmp 创建时的 0o600，只是没能精确匹配原文件更严格的形态），不是需要调用方介入处理的错误，`console.warn` 的可见性已经足够。

若未来出现第二个真正需要结构化诊断的调用方（如需要在 CLI 汇总报告里逐条列出降级事件），再引入 `diagnostics` 参数——不预先为假设的未来需求设计接口。

### 2.3 tmp `wx` 冲突（EEXIST）
`flag: 'wx'` 下 tmp 路径已存在（极小概率：pid+random 碰撞，或 tmp 路径被恶意预置）时 `writeFileSync` 直接抛 `EEXIST`，走 catch 分支：`rmSync(tmp, {force:true})` 后重抛原始错误。**不重试**（换个新随机后缀重试会让函数从"确定性抛错"变成"概率性成功"，掩盖真实的路径冲突信号；且并发场景下重试引入的时间窗口本身就是新的竞态面）。调用方（5 个消费方）目前均无 try/catch 包裹 `writeAtomicJson`，抛出会直接向上传播——这与当前行为一致（当前实现对 `writeFileSync`/`renameSync` 失败同样是直接抛出）,不是新增的失败面，只是新增了"抛出前先清理 tmp"这一步。

### 2.4 realpath 失败
`resolveWriteTarget` 内部 `try { lstatSync... } catch {}` 已经处理——`lstatSync` 失败（目标不存在）或 `realpathSync` 失败（悬空软链）都回落字面路径，不抛出、不阻断。这是 fix-report 登记的已知边界（"悬空 symlink 仍会拆链"），plan 维持该裁决：处理悬空软链需要"检测到悬空后创建新的真实文件而非跟随"的额外分支，属于卡面未点名的边缘形态，不在本卡展开。

### 2.5 `mkdirSync` mode 是否比照 parity 加 `0o700`
Parity 参照对 `hooks.json` 所在目录用 `mode: 0o700`，理由是"hooks.json 内容会被 Codex 当命令执行，目录权限也是注入面的一半"。Claude 侧 5 个消费方写的分别是：`_cache-manifest.json`（缓存元数据）、`graph.json`（图数据）、extraction cache（提取缓存）、`.claude/settings.json`（会被 Claude Code 读取但不是"目录下随便扔一个文件就会被当命令执行"的模型——`settings.json` 需要匹配特定 schema 才生效）。**裁决：不加 `mode: 0o700`**，`mkdirSync` 维持 `{ recursive: true }` 不变。理由：(a) 这不属于 D1-D7 任何一条缺陷；(b) Claude 侧的"目录里随便塞文件即命令注入"攻击面不成立（与 codex 侧 hooks.json 的执行模型不同）；(c) 「不要自行添加未要求的优化」——加固目录权限是比照 parity 的额外收紧，卡面硬约束 3 明确"保全≠加固"，这条同样适用于目录层。

---

## 3. 红先行测试清单（D1-D7 逐条对应）

| 缺陷 | 测试文件 | 用例（新增） | 断言 | 先红？ |
|------|---------|-------------|------|--------|
| D1 软链被拆 | `tests/unit/atomic-write.test.ts` | `软链目标：写入后软链仍是软链，且真实文件收到更新` | 预置 `real.json` + `link.json → real.json` 软链；`writeAtomicJson(linkPath, data)`；断言 `fs.lstatSync(linkPath).isSymbolicLink() === true` 且 `fs.realpathSync(linkPath) === realPath` 且真实文件内容 `=== data` | 是 |
| D2 mode 未保全 | 同上 | `已存在文件 mode 0600：写入后仍是 0600` | 预置文件 `chmodSync(path, 0o600)`；写入后 `fs.statSync(path).mode & 0o777 === 0o600` | 是（卡面硬约束 5 点名此用例） |
| D2 补充 | 同上 | `新建文件默认 mode 0600` | 目标不存在时写入，断言新建文件 `mode & 0o777 === 0o600`（登记的行为变化，从旧的隐式 0o644 变化） | 是 |
| D3 并发互截 | 同上 | `并发写同一目标：两次写入均成功落盘，无 ENOENT` | 用 `Promise.all` 并发触发多次同步 `writeAtomicJson`（同步函数需用 `setImmediate`/子进程模拟并发，或至少断言 tmp 文件名彼此不同——见下方"并发测试 flaky 风险"节的实现取舍） | 是 |
| D4 失败不清理 | 同上 | `tmp 创建失败时不留残留文件` | 用 mock/monkeypatch 让 `renameSync` 抛错（或制造真实失败：目标是不可写目录），断言异常抛出后 `glob(dir + '/*.tmp.*')` 为空 | 是 |
| D5 chmod 放宽脚本 | `tests/unit/hook-installer.test.ts` | `重复安装：已存在脚本的自定义 mode 0700 被保全，不被放宽为 0755` | 先 `installClaudeHook`，`chmodSync(scriptPath, 0o700)`，卸载后重装（或直接第二次调用触发脚本重写路径），断言 mode 仍 `0700` | 是 |
| D6 `.bak` 被顶掉 | 同上 | `.bak 已存在时不覆盖，保留最早内容` | 预置 `.bak` 内容 A，写入新 settings 触发 `installClaudeHook`，断言 `.bak` 内容仍是 A（不是被本次覆盖的 B） | 是 |
| D6 补充 | 同上 | `removeClaudeHook 卸载路径也创建 .bak` | 安装后卸载，断言 `.bak` 存在 | 是 |
| D7-a plugin-manifest | `tests/unit/codex-runtime-doctor.test.ts`（或新建 `codex-runtime-doctor-io.test.ts`，视 implement 阶段确认现状） | `畸形段（无 marketplace）在合法段之前时，探针仍返回 found` | 构造 `config.toml`：先放一个无 `@market` 的同名段（enabled=true），后放合法 `[plugins."spec-driver@cc-plugin-market"]`（enabled=true），断言 `probeCodexPluginManifest` 返回 `outcome: 'found'` 且 `activeInstallPath` 非空 | 是（fix-report D7 已实测，此为回归护栏） |
| D7-b cli-inventory | 同上 | `版本不可解析的条目在合法条目之前时，探针仍返回 found` | 构造 `codex plugin list --json` 输出：先放同名条目但 `version` 不可解析，后放同名条目 `version` 合法，断言 `probeCodexCliInventory` 返回 `found` 且 `semver` 正确 | 是（对称覆盖，卡面硬约束 5 要求「两处是否对称处理」有测试证据） |

**必须先红的用例**：全部 10 条（D1/D2×2/D3/D4/D5/D6×2/D7×2）均需在改动前跑一次确认失败（证明测试真的在测缺陷而非空转），改动后重跑确认转绿。implement 阶段按此清单逐条记录 red→green 证据（复用 fix-report 已有的 D1-D7 实测方法论，测试即复现脚本的固化版本）。

---

## 4. 回归风险评估

### 4.1 新建产物 mode 0644 → 0600 的影响面
受影响：`graph.json`（`graph-builder.ts`）、`_cache-manifest.json`（`manifest-manager.ts`）、extraction cache（`extraction-cache.ts`）三个消费方的**首次创建**路径。

- **同 UID 读写**（本地开发机、单用户 CI runner）：无影响，进程自己创建自己读，0600 与 0644 效果相同。
- **多 UID 共享环境**（共享构建机、CI 服务账户与人工账户混用）：`graph.json` 若被非创建进程的其他用户/服务读取（如另一个 CI job 以不同用户运行、只读挂载分享给协作者），会从"可读"变"不可读"。这是 fix-report 已登记的已知边界，卡面硬约束 3 明确要求首创默认与 codex 侧一致，此处维持该裁决，**不额外做特判**（如"graph.json 例外用 0644"）——特判会破坏"所有消费方走同一份保全逻辑"的一致性，且 CLAUDE.md 项目上下文中未见多 UID 共享构建机场景的现有支持声明。
- implement 阶段验证方式：跑 3 个消费方各自的现有测试套件（`tests/panoramic/cache/manifest-manager.test.ts`、`tests/panoramic/cache/integration.test.ts`、`tests/panoramic/cache/cache-manager.test.ts`、`tests/extraction/extraction-cache.test.ts`、`tests/extraction/extraction-pipeline.test.ts`、`tests/unit/graph-builder.test.ts`），确认零回归——这些测试只断言"文件内容正确"，不断言 mode，理论上不受影响，但需实跑确认无隐藏的 mode 相关断言。

### 4.2 `flag: 'wx'` 对现有「.tmp 残留被覆盖」用例的冲击

`tests/unit/atomic-write.test.ts` 现有用例（L69-86）：

```ts
it('.tmp 残留场景：已存在的 .tmp 文件被覆盖', () => {
  ...
  const tmpPath = `${filePath}.tmp`; // 固定名
  fs.writeFileSync(tmpPath, '{"old": true}', 'utf-8');
  writeAtomicJson(filePath, data);
  // 断言 tmp 被覆盖、最终文件正确、tmp 不再存在
});
```

新实现下 tmp 路径变成 `${filePath}.tmp.${pid}.${random}`，预置的固定名 `${filePath}.tmp` **根本不是**新实现会碰的路径——该用例的"覆盖残留 tmp"场景在语义上不再可能发生（新 tmp 名每次唯一，不会与预置的旧残留碰撞）。

**裁决：删除该用例，替换为两条新用例，而非保留原用例空跑**：
1. `随机 tmp 命名：同一目标连续两次写入产生不同 tmp 路径（通过 mock random/pid 或断言不残留验证）`——证明 D3 修复点的存在性。
2. `旧格式残留 .tmp（无 pid/random 后缀）不影响新写入`——预置 `${filePath}.tmp`（旧格式，模拟升级前遗留的残留文件），写入后断言：目标文件内容正确 **且** 旧残留 `${filePath}.tmp` 依然存在（新实现不会主动清理不是自己创建的残留，只清理自己这次创建的 tmp）。这条用例把"旧残留不会被静默吞掉/也不会被误当自己的 tmp 处理"的边界显式化，比直接删除更安全——即便升级后有旧版本遗留的 `.tmp` 文件，也不会被新逻辑意外覆盖或删除（因为路径不同，新逻辑对它毫无感知）。

不选择"保留原用例但改断言"的原因：原用例的**意图**（验证残留 tmp 被覆盖）在新实现里语义已经不存在（tmp 不再固定命名，不会有"残留被覆盖"这件事），保留只改断言会让读者误以为这仍是当前实现的行为特征；显式删除+替换为语义准确的新用例更诚实。implement 阶段需在 PR/commit 描述中说明此裁决（"删除失效用例，替换为 2 条语义准确的新用例"），不允许默默删除不留痕迹。

### 4.3 并发测试 flaky 风险

`writeAtomicJson` 是**同步**函数（`writeFileSync`/`renameSync` 全同步调用），单个 Node 进程内两次调用天然是串行的——用 `Promise.all` 包两个同步调用不能制造真实并发，只是顺序执行两次。要真实验证 D3（并发互截修复），有两个选项：

- **选项 A（推荐）**：不测"真实并发"，改测"确定性"——断言连续多次调用产生的 tmp 文件名互不相同（通过 spy/mock `Math.random()` 返回不同值，或用真实随机后直接断言正则匹配 `\.tmp\.\d+\.[a-z0-9]{8}$`），加上"两次连续调用均成功产出正确最终内容"。这是单元测试层面能做到的最强断言，不依赖真实多进程/多线程时序。
- **选项 B**：用 `child_process.fork` 起两个真实子进程各写同一目标 N 轮，复现 fix-report 开工实证用的方法论（D3 证据表就是这么测出来的）。这更接近真实场景但属于集成测试量级（进程开销、时间开销），且**结果本身有内在随机性**（两个子进程谁先 rename 谁的 payload 会赢，这是**预期的正确行为**——原子写入保证"赢家 payload 完整"而非"保证特定顺序"，所以断言目标是"最终文件是两次 payload 之一的完整内容，不是二者的混合/截断"，不能断言具体是哪一个）。

**裁决**：单元测试用选项 A（快、确定性、无 flaky 风险），集成层面额外加 1 条选项 B 用例（放 `tests/integration/`，不放 `tests/unit/`，避免被 unit 测试套件的严格 flaky 容忍度卡住）标注允许的断言弱化（"某一方 payload 完整"而非"特定顺序"）。若 implement 阶段发现选项 B 引入不可控 flaky（如 CI 环境子进程调度差异导致断言随机失败），可退回只做选项 A + 保留 fix-report 的手工复现脚本作为文档化证据，不强行把有内在随机性的场景塞进 CI 必过的测试套件。

### 4.4 `hook-installer.ts` 提取 `backupSettingsIfAbsent` 私有函数

`installClaudeHook`/`removeClaudeHook` 原本各自内联"备份"逻辑，提取共享函数后需确认两处调用点的 `console.log` 提示文案是否需要区分语境（install 语境 vs remove 语境）——若共享函数内的提示文案对两种场景都适用（如都写"[spectra] .bak 已存在，保留最早备份"），则不需要参数化；若需要区分，函数签名加一个 `context: 'install' | 'remove'` 参数打印不同文案。倾向不区分（文案本身与"是安装还是卸载触发的"无关，都是在描述 `.bak` 文件的状态）。

---

## 5. 验证方案

### 5.1 implement 阶段（改动过程中）
1. 复现脚本先跑：implement 开始前，用 fix-report `verification/repro/` 下的 D1-D7 复现脚本在**当前（未修复）代码**上跑一遍，确认全部复现（若脚本仍在，直接复用；不在则按 fix-report 证据表描述的手法现场重建，确保"红"是真红）。
2. 按 §3 清单逐条写新测试，改动前跑（除新建的 `atomic-write.ts` 逻辑相关用例外，D5/D6/D7 用例应在**现有代码**上跑到红——因为这些缺陷本就在当前代码里）。
3. 落实 §1 的三处源码改动。
4. 重跑 §3 全部用例转绿。
5. 重跑 §4.2 提到的 5 个受影响消费方现有测试套件（`manifest-manager.test.ts`、`integration.test.ts`、`cache-manager.test.ts`、`extraction-cache.test.ts`、`extraction-pipeline.test.ts`、`graph-builder.test.ts`）+ `hook-installer.test.ts`（含现有的「chmod +x」「幂等安装」等既有用例）+ `hook-installer-semantics-parity.test.ts`（回归护栏，卡面硬约束 4 点名）+ `codex-runtime-doctor*.test.ts` 全套，确认零失败零新增 flaky。

### 5.2 提交前（全量）
```bash
npx vitest run                    # 零失败（含全部新增用例）
npm run build                     # TS 类型检查零错误
npm run repo:check                # 插件同步链路复核（.mjs 改动需过）
```

### 5.3 回归护栏专项复核（卡面硬约束 4）
- **F207 init gitignore 自举**：`grep -rn 'init.*gitignore\|gitignore.*self' tests/` 定位相关测试，确认本次改动未触及（本卡不动 `.gitignore` 相关逻辑，预期零影响，仍需实跑确认）。
- **F245 hook payload**：`tests/unit/*hook*payload*` 或 `hook-installer*.test.ts` 中 payload 相关断言全跑一遍。
- **Claude 侧 SessionStart/PreToolUse 安装流**：`hook-installer.test.ts` 全套 + 若存在端到端安装流程测试（`Grep -rn 'installClaudeHook' tests/`）一并跑。

### 5.4 判据
- 全部红先行用例改动前红、改动后绿，有 implement 阶段记录（transcript 或 commit message 附 red→green 对照）。
- `npx vitest run` 零失败（不接受"新增 flaky 但整体通过"，§4.3 已给出规避方案）。
- `npm run build` 零错误。
- `npm run repo:check` 零错误（`.mjs` 改动触发插件同步校验）。
- D1-D7 复现脚本在修复后代码上重跑，全部从"复现成功（缺陷存在）"翻转为"复现失败（缺陷已修复，行为符合预期）"。

---

## 6. 待 implement 阶段确认的开放项

1. `codex-runtime-doctor.test.ts` 是否已覆盖 `probeCodexPluginManifest`/`probeCodexCliInventory`（当前只 Glob 到 3 个 doctor 测试文件，未逐一读取确认覆盖范围）；若未覆盖，需要新建测试文件还是并入现有文件，implement 开工时先 Grep 确认再定。
2. `hook-installer.ts` 提取的 `backupSettingsIfAbsent` 私有函数是否需要按 install/remove 语境区分提示文案（§4.4），倾向不区分，implement 阶段若发现语境差异需要文案区分再调整。
3. §4.3 选项 B（子进程并发集成测试）是否纳入本卡还是留给后续——倾向纳入但标注"若引入不可控 flaky 可退回选项 A"，最终取舍视 implement 阶段实测结果。
