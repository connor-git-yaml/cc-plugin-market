/**
 * codex-hooks-schema.mjs
 * Feature 240 / FR-001 / FR-002 — Codex hooks 事件名两层门禁 + 归属判定（纯函数，零 I/O）
 *
 * ## 为什么需要自建门禁
 * `_grounding.md` §8.2 实测：Codex 对**未知事件名不报错、不警告**，hook 只是永远不执行；
 * 且事件名区分大小写，`pre_tool_use` 这类 snake_case 变体**静默失效**。这是一个高危静默
 * 失败面，只能由我方在构建期/安装期自建校验拦截，不能指望运行时报错。
 *
 * ## 两层门禁的作用域（plan §6.4，闭合审查结论 C4）
 * `$CODEX_HOME/hooks.json` 是**全局唯一共享文件**，里面可能有用户自己或其他工具写的条目。
 * 因此两层门禁的作用域必须分开定义，否则「恰四事件」会与 FR-011 的非破坏性合并自相矛盾：
 *
 * | 层 | 作用域 | 判据 | 失败级别 |
 * |---|---|---|---|
 * | schema | 全文件事件名 | 是否属于 Codex 事件全集（`CODEX_EVENT_SCHEMA_SET`） | 我方条目非法 → fail；第三方未知名 → warning |
 * | product（事件级） | **仅我方 owned 条目**覆盖的事件集合 | 恰等于 4 项 | 越界 / 缺项 → fail（code 可区分） |
 * | product（handler 级，F264） | **每一条 owned handler** | 脚本已登记，且挂在 `OWNED_HOOK_EXPECTED_EVENT` 指定的事件上；5 条一条不缺 | 挂错 / 缺条 → fail |
 *
 * 🔴 handler 级是 F264 新增的**必要补强**，不是事件级的重复：`Stop` 下挂着两条脚本，只丢掉
 * `stop-fix-compliance-check.sh`（依从性判定器）时事件集合毫无变化，事件级判据判 pass。
 *
 * 🔴 第三方未知事件名判 warning 而非 fail 的理由：Codex 版本演进会扩充事件全集，且我们对
 * 第三方条目**无否决权**。判 fail 等于用我方门禁逼用户删自己的数据。
 *
 * ## 归属判定为什么放在本模块
 * `isOwnedEntry` 同时被门禁（本模块）与合并写入器（`codex-hooks-installer.mjs`）消费。
 * 两处各写一份必然漂移（F238 教训），故在此定义**唯一实现**，由 installer re-export。
 *
 * 运行相关测试:
 *   npx vitest run tests/unit/codex-hooks-event-gate.test.ts
 *   npx vitest run tests/unit/codex-hooks-installer.test.ts
 */

/**
 * Codex hook 事件全集（11 项，PascalCase）。
 * 来源：`_grounding.md` §2 —— 从 codex 二进制提取 `HookEventName` / `HookEventNameWire` /
 * `HookEventsToml` 三处枚举去重。**全集中不存在 `WorktreeCreate` / `WorktreeRemove`**。
 *
 * ## 🔴 本集合是**版本相关**的，`SessionEnd` 就是分界点（F264）
 * 前 10 项在 codex-cli 0.144.6 上**已实测被接受**：把 14 个候选事件名各写一条进
 * `$CODEX_HOME/hooks.json`，经 app-server RPC `hooks/list` 回读，恰好返回这 10 条。
 * 同一次实测里 `SessionEnd` **未被接受**——与 `WorktreeCreate` / `WorktreeRemove` 同待遇：
 * 静默丢弃，`warnings` / `errors` 均为空。
 * `SessionEnd` 依 0.149.0 口径补入（M10 §4 P0-B 卡面事实），本机无 0.149.0 无法复测。
 *
 * 因此本集合的语义必须理解为：「**某个受支持的 Codex 版本**认识这个事件名」，而不是
 * 「当前这台机器上的 Codex 一定会执行它」。
 *
 * 🔴 **补入它不能以抹掉真信号为代价**（异构对抗第二轮 I1）：0.144.6 上第三方写的 `SessionEnd`
 * hook **确实永不执行**，原来那条 `unknown-event-name` warning 对该用户是**准确**的。若只是把它
 * 挪进全集，用户会从"收到一条准确告警"变成"什么都收不到"。故版本相关的事件名单独成集
 * （`CODEX_EVENT_VERSION_DEPENDENT`），产出**语义更准**的 `version-dependent-event-name` warning。
 * 🔴 **MUST NOT** 因为某个事件名在本集合里，就把它加进 `CODEX_EVENT_PRODUCT_SET`——
 * 我方条目挂到一个当前版本不认的事件上，等于写一条永不执行的 hook（静默失效面）。
 */
export const CODEX_EVENT_SCHEMA_SET = Object.freeze([
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
]);

/**
 * 全集中**版本相关**的事件名（F264）：名字合法，但在部分受支持版本上不被接受、静默丢弃。
 * 第三方条目落在这些事件上时产出 `version-dependent-event-name` warning ——
 * 既不冒充"未知事件名"（它在新版本里是合法的），也不静默（在旧版本里它确实永不执行）。
 */
export const CODEX_EVENT_VERSION_DEPENDENT = Object.freeze(['SessionEnd']);

/** 本 feature 允许我方条目使用的事件子集（FR-001，4 项，顺序即生成顺序） */
export const CODEX_EVENT_PRODUCT_SET = Object.freeze([
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'Stop',
]);

/**
 * 我方 hook 脚本的**完整相对后缀**（归属锚点，FR-011.4）。
 *
 * 🔴 用 `command` 里的脚本路径做锚点，而**不是**往 JSON 里塞自定义字段 —— `_grounding.md` §8.1
 * 实测未知字段当前被静默忽略，但「未来 Codex 是否严格拒绝未知字段」属未确证风险。
 *
 * 🔴 为什么是 `[父目录, 文件名]` 二元组而不是单纯的 basename：
 * 归属判定的**误认方向会删除第三方数据**，是本模块唯一不可逆的失败方向。只按 basename +
 * 「路径里某处有 `spec-driver` 分量」判定过宽，已实测可被
 * `bash /opt/othertool/spec-driver/postinstall.sh`、
 * `bash /x/spec-driver/hooks/../../evil/postinstall.sh` 等第三方命令命中。
 * 收紧为「后缀必须精确等于 `<scripts|hooks>/<脚本名>`，且 `spec-driver` 根分量必须出现在该
 * 后缀之前，且整个 token 不含 `..`」后，上述形态全部落回第三方侧。
 */
export const OWNED_HOOK_SCRIPT_SUFFIXES = Object.freeze([
  Object.freeze(['scripts', 'postinstall.sh']),
  Object.freeze(['hooks', 'pre-tool-use-guard.sh']),
  Object.freeze(['hooks', 'post-tool-use-format.sh']),
  // F270 P5：会话证据账本采集器（PostToolUse，matcher 空=全工具触发）
  Object.freeze(['hooks', 'post-tool-use-ledger.sh']),
  Object.freeze(['hooks', 'stop-task-check.sh']),
  Object.freeze(['hooks', 'stop-fix-compliance-check.sh']),
]);

/**
 * 我方每条 owned hook 脚本**期望挂载的事件**（F264）。
 *
 * ## 为什么事件级判据不够
 * 原产品层只判「owned 条目覆盖的事件集合恰等于 `CODEX_EVENT_PRODUCT_SET` 四项」。`Stop` 下有
 * **两条**脚本（`stop-task-check.sh` 与 `stop-fix-compliance-check.sh`），只要还剩一条，`Stop`
 * 就仍在 owned 事件集合里 —— 于是「依从性判定器整条掉了」这种**最该被拦下的缺口**照样判 pass。
 * 事件集合是 handler 集合的**有损投影**，用投影做完整性判据必然漏判。
 *
 * key 为 `<父目录>/<脚本名>`（与 `OWNED_HOOK_SCRIPT_SUFFIXES` 同一口径），value 为期望事件。
 * 🔴 新增 owned hook 时**必须**同时登记到这里，否则它会被判成 `product-handler-misplaced`。
 */
export const OWNED_HOOK_EXPECTED_EVENT = Object.freeze({
  'scripts/postinstall.sh': 'SessionStart',
  'hooks/pre-tool-use-guard.sh': 'PreToolUse',
  'hooks/post-tool-use-format.sh': 'PostToolUse',
  // F270 P5：账本采集器也挂 PostToolUse（PostToolUse 下现有两条 handler，与 Stop 下两条同构）
  'hooks/post-tool-use-ledger.sh': 'PostToolUse',
  'hooks/stop-task-check.sh': 'Stop',
  'hooks/stop-fix-compliance-check.sh': 'Stop',
});

/**
 * 我方的 **Claude adapter 独有** hook 脚本（Codex 全集中无对应事件）。
 * 单独成集是为了让 canonical source 上的 `WorktreeCreate` / `WorktreeRemove` 被诊断为
 * `claude-only-event` 而不是含义误导的 `unknown-event-name`（那是给第三方条目用的）。
 */
export const CLAUDE_ONLY_HOOK_SCRIPT_SUFFIXES = Object.freeze([
  Object.freeze(['hooks', 'worktree-lifecycle.sh']),
]);

/**
 * basename 视图，仅供**诊断文案与文档**使用。
 * 🔴 MUST NOT 单独用作归属判据 —— 单靠 basename 判定正是上面收紧掉的那条误删路径。
 */
export const OWNED_HOOK_SCRIPT_NAMES = Object.freeze(
  OWNED_HOOK_SCRIPT_SUFFIXES.map(([, name]) => name),
);
export const CLAUDE_ONLY_HOOK_SCRIPT_NAMES = Object.freeze(
  CLAUDE_ONLY_HOOK_SCRIPT_SUFFIXES.map(([, name]) => name),
);

/** 归属判定要求的目录分量（见 `isOwnedEntry` 的注释） */
export const OWNED_PATH_COMPONENT = 'spec-driver';

/**
 * canonical source 里插件根的占位记号。
 * 只有在**显式**开启 `canonicalSource` 时才被承认为归属根 —— 见 `findScriptPath` 的说明。
 */
const PLACEHOLDER_ROOT_COMPONENT = '${CLAUDE_PLUGIN_ROOT}';

/**
 * 把 command 字符串切成「路径候选 token」。
 *
 * 🔴 **这不是 shell 解析器，也不用于任何安全判定**。F231 已实测证伪「解析 shell 命令串提取
 * 文件路径」这条路线，故此处的边界是：本函数只服务于**归属识别**。
 *
 * 🔴 归属识别的两个失败方向**不对称**，务必分清：
 * - 认不出我方条目 ⇒ 卸载时残留（可见、可重试），无数据丢失；
 * - 误认第三方条目为我方 ⇒ **删除用户数据**，不可逆。
 *
 * 因此本函数只负责把 token 切出来，真正收窄误认面的是 `findScriptPath` 的三条硬条件
 * （完整相对后缀 + `spec-driver` 根分量在后缀之前 + 无 `..`）。
 * ⚠️ 即便如此，"命令里提到某路径" 与 "命令真的执行了该路径" 仍是两回事（F231 的教训）：
 * `echo /x/spec-driver/scripts/postinstall.sh` 这类**提及而不执行**的第三方命令依旧会被认领。
 * 本模块**不**试图靠解析 shell 来区分二者，改由 `codex-hooks-installer.mjs` 把每一条被摘除的
 * command 逐条写进 diagnostics（`owned-entry-removed`）并由 CLI 打印，使误删可见、可回滚。
 *
 * 支持引号包裹与反斜杠转义的 token，因为我方生成器在路径含空格 / 单引号等字符时会用 POSIX
 * 单引号包裹（见 `codex-hooks-generator.mjs` 的 `shellQuote`，含 `'\''` 续接序列），
 * 不识别这两者会把自己的条目切碎 —— 后果是 `owned-command-target-missing` 假红。
 */
function splitCommandTokens(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;

  const flush = () => {
    if (started) tokens.push(current);
    current = '';
    started = false;
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
        started = true;
      }
      continue;
    }
    // 引号外的反斜杠转义：`shellQuote` 产出的 `'\''` 续接序列在此还原为字面单引号
    if (ch === '\\' && i + 1 < command.length) {
      current += command[i + 1];
      started = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (/[\s;|&()<>=]/.test(ch)) {
      flush();
      continue;
    }
    current += ch;
    started = true;
  }
  flush();
  return tokens;
}

/**
 * 从 command 中提取第一个满足**全部三条硬条件**的脚本路径 token。
 *
 * | 硬条件 | 挡住的误认形态 |
 * |---|---|
 * | 后缀精确等于 `<父目录>/<脚本名>` | `bash /opt/othertool/spec-driver/postinstall.sh`（缺 `scripts/`） |
 * | `spec-driver` 根分量出现在该后缀**之前** | `/x/scripts/spec-driver/postinstall.sh` 之类的顺序错位 |
 * | token 内不含 `..` | `bash /x/spec-driver/hooks/../../evil/postinstall.sh`（穿越出插件根） |
 *
 * @param {unknown} command
 * @param {ReadonlyArray<readonly [string, string]>} suffixes `[父目录, 文件名]` 二元组集合
 * @param {boolean} allowPlaceholderRoot
 *   是否把 `${CLAUDE_PLUGIN_ROOT}` 也当作合法归属根。
 *   🔴 **只允许在校验 canonical source 时开启**：canonical 里的路径尚未展开，形如
 *   `${CLAUDE_PLUGIN_ROOT}/hooks/x.sh`，没有 `spec-driver` 分量。而对**全局共享的
 *   `$CODEX_HOME/hooks.json`** 必须保持关闭 —— 那份文件里的条目可能来自任何来源，放宽
 *   归属判定就等于放宽「可以删谁的数据」，属数据丢失面。
 * @returns {string|null} 命中的完整路径 token
 */
function findScriptPath(command, suffixes, allowPlaceholderRoot = false) {
  if (typeof command !== 'string' || command.length === 0) return null;
  const rootNames = allowPlaceholderRoot
    ? [OWNED_PATH_COMPONENT, PLACEHOLDER_ROOT_COMPONENT]
    : [OWNED_PATH_COMPONENT];

  for (const token of splitCommandTokens(command)) {
    const segments = token.split('/');
    // 至少 `<根>/<父目录>/<脚本名>` 三段，否则不可能同时满足后缀与根分量在前
    if (segments.length < 3) continue;
    if (segments.includes('..')) continue;
    const parent = segments[segments.length - 2];
    const basename = segments[segments.length - 1];
    if (!suffixes.some(([dir, name]) => dir === parent && name === basename)) continue;
    // 根分量必须严格出现在 `<父目录>/<脚本名>` 之前
    if (!segments.slice(0, segments.length - 2).some((seg) => rootNames.includes(seg))) continue;
    return token;
  }
  return null;
}

/**
 * 归属判定：该 handler 的 command 是否为我方条目（FR-011.4）。
 * @param {unknown} command
 * @param {{allowPlaceholderRoot?: boolean}} [options] 仅 canonical source 校验时置真
 * @returns {boolean}
 */
export function isOwnedEntry(command, options = {}) {
  return (
    findScriptPath(command, OWNED_HOOK_SCRIPT_SUFFIXES, options.allowPlaceholderRoot === true) !==
    null
  );
}

/** 该 command 是否为我方的 Claude-only hook（仅用于诊断分级，不参与产品层判定） */
export function isClaudeOnlyEntry(command, options = {}) {
  return (
    findScriptPath(
      command,
      CLAUDE_ONLY_HOOK_SCRIPT_SUFFIXES,
      options.allowPlaceholderRoot === true,
    ) !== null
  );
}

/** 提取我方条目的脚本绝对路径（供形状校验使用） */
export function extractOwnedScriptPath(command) {
  return findScriptPath(command, OWNED_HOOK_SCRIPT_SUFFIXES, false);
}

/**
 * 提取 owned command 的 `<父目录>/<脚本名>` 后缀 key（F264，handler 级判据的取键口径）。
 *
 * 与 `isOwnedEntry` **共用同一个 `findScriptPath`**：两处各写一份取键逻辑必然漂移，而漂移的
 * 后果是「归属判定认得出、handler 判据认不出」→ 每条 owned handler 都被判 `misplaced` 的全盘假红。
 *
 * @returns {string|null} 形如 `hooks/stop-task-check.sh`；非 owned 条目返回 null
 */
export function ownedScriptSuffixKey(command, options = {}) {
  const token = findScriptPath(
    command,
    OWNED_HOOK_SCRIPT_SUFFIXES,
    options.allowPlaceholderRoot === true,
  );
  if (token === null) return null;
  const segments = token.split('/');
  return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
}

/**
 * 收集文档中全部 handler 的 `command` 字面量（**不做任何归属判定**）。
 *
 * 🔴 存在的唯一理由：第三方数据保全判据不能依赖 `isOwnedEntry`。
 * 投影式判据（`projectForeignOnly` 两侧比较）与写入器共用同一个归属谓词，因此**在数学上
 * 无法检出该谓词自身的过度认领** —— 被误认的第三方条目在 before/after 两个投影里都被摘掉，
 * 差异被抹平。本函数提供一个与归属谓词正交的口径：命令字面量的存活集合。
 *
 * @returns {string[]} 出现顺序保留，重复项保留（多重集）
 */
export function collectCommandLiterals(doc) {
  const out = [];
  for (const { handler } of collectHandlers(doc)) {
    if (isPlainObject(handler) && typeof handler.command === 'string') out.push(handler.command);
  }
  return out;
}

/** 类型防御：非数组一律视为空集，绝不抛未捕获异常（FR-011.7） */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 遍历文档中的全部 handler。
 * @returns {Array<{event: string, groupIndex: number, handlerIndex: number, handler: unknown}>}
 */
export function collectHandlers(doc) {
  const out = [];
  if (!isPlainObject(doc)) return out;
  const hooks = isPlainObject(doc.hooks) ? doc.hooks : {};
  for (const event of Object.keys(hooks)) {
    asArray(hooks[event]).forEach((group, groupIndex) => {
      const handlers = isPlainObject(group) ? asArray(group.hooks) : [];
      handlers.forEach((handler, handlerIndex) => {
        out.push({ event, groupIndex, handlerIndex, handler });
      });
    });
  }
  return out;
}

/** 我方 owned 条目所覆盖的事件集合（产品层的唯一作用域） */
export function collectOwnedEvents(doc, options = {}) {
  const events = new Set();
  for (const { event, handler } of collectHandlers(doc)) {
    if (isPlainObject(handler) && isOwnedEntry(handler.command, options)) events.add(event);
  }
  return [...events];
}

/**
 * 两层门禁校验。
 *
 * @param {unknown} doc  已解析的 hooks 文档（canonical source / 生成结果 / 安装后的最终文件）
 * @param {{checkCommandShape?: boolean, canonicalSource?: boolean,
 *           pathExists?: (p: string) => boolean}} [options]
 *   - `checkCommandShape`：是否校验我方 command 的形状（绝对路径 / 无 `${` 插值 / type）。
 *     canonical source 尚未展开插值，校验它时须传 `false`。
 *   - `canonicalSource`：被校验对象是 canonical `hooks.json`（路径含 `${CLAUDE_PLUGIN_ROOT}`
 *     占位而非 `spec-driver` 分量）。🔴 校验全局共享的 `$CODEX_HOME/hooks.json` 时**必须**保持
 *     关闭，否则归属判定被放宽 = 可删数据的范围被放宽。
 *   - `pathExists`：可选的存在性探测（唯一的 I/O 注入点，由 CLI 提供），不传则跳过。
 * @returns {{ok: boolean, status: 'pass'|'warning'|'fail', ownedEvents: string[],
 *            foreignEvents: string[], findings: Array<object>}}
 */
export function validateCodexHooksDocument(doc, options = {}) {
  const checkCommandShape = options.checkCommandShape !== false;
  const ownership = { allowPlaceholderRoot: options.canonicalSource === true };
  const pathExists = typeof options.pathExists === 'function' ? options.pathExists : null;
  const findings = [];
  const fail = (layer, code, extra = {}) => findings.push({ level: 'fail', layer, code, ...extra });
  const warn = (layer, code, extra = {}) =>
    findings.push({ level: 'warning', layer, code, ...extra });

  if (!isPlainObject(doc)) {
    fail('schema', 'document-invalid');
    return { ok: false, status: 'fail', ownedEvents: [], foreignEvents: [], findings };
  }
  if (doc.hooks !== undefined && !isPlainObject(doc.hooks)) {
    fail('schema', 'hooks-field-invalid');
    return { ok: false, status: 'fail', ownedEvents: [], foreignEvents: [], findings };
  }

  const handlers = collectHandlers(doc);
  const ownedEvents = new Set();
  const foreignEvents = new Set();
  const claudeOnlyEvents = new Set();

  for (const { event, handler } of handlers) {
    const command = isPlainObject(handler) ? handler.command : undefined;
    if (isOwnedEntry(command, ownership)) ownedEvents.add(event);
    else if (isClaudeOnlyEntry(command, ownership)) claudeOnlyEvents.add(event);
    else foreignEvents.add(event);
  }
  // 无 handler 的空事件键也参与 schema 层判定（它对 Codex 合法但不触发任何东西）
  for (const event of Object.keys(isPlainObject(doc.hooks) ? doc.hooks : {})) {
    if (!ownedEvents.has(event) && !claudeOnlyEvents.has(event)) foreignEvents.add(event);
  }

  // ---- schema 层：全文件事件名合法性，失败级别按归属分流 ----
  for (const event of ownedEvents) {
    if (!CODEX_EVENT_SCHEMA_SET.includes(event)) {
      fail('schema', 'owned-event-illegal', { event });
    }
  }
  for (const event of claudeOnlyEvents) {
    if (!CODEX_EVENT_SCHEMA_SET.includes(event)) {
      // 我方的 Claude adapter 独有事件：在 Codex 侧属预期外事件名，但它本就不该被安装到
      // Codex（生成器会过滤掉）。诊断上与第三方未知名区分开，便于定位来源。
      warn('schema', 'claude-only-event', { event });
    }
  }
  for (const event of foreignEvents) {
    if (ownedEvents.has(event) || claudeOnlyEvents.has(event)) continue;
    if (!CODEX_EVENT_SCHEMA_SET.includes(event)) {
      // 🔴 第三方数据只 warning：我们对它无否决权（C4）
      warn('schema', 'unknown-event-name', { event });
    } else if (CODEX_EVENT_VERSION_DEPENDENT.includes(event)) {
      // 名字合法但版本相关：旧版本上静默丢弃，用户有权知道（F264 / 第二轮 I1）
      warn('schema', 'version-dependent-event-name', { event });
    }
  }

  // ---- 产品层：作用域仅限 owned 条目 ----
  for (const event of ownedEvents) {
    if (!CODEX_EVENT_SCHEMA_SET.includes(event)) continue; // 已在 schema 层报过
    if (!CODEX_EVENT_PRODUCT_SET.includes(event)) {
      fail('product', 'product-event-out-of-scope', { event });
    }
  }
  for (const event of CODEX_EVENT_PRODUCT_SET) {
    if (!ownedEvents.has(event)) {
      fail('product', 'product-event-missing', { event });
    }
  }

  // ---- 产品层（handler 级，F264）：每条 owned 脚本各就各位，一条不缺 ----
  //
  // 🔴 与上面的事件级判据是 AND 关系，不是替代：事件级管「有没有越界到第五个事件」，
  // handler 级管「四个事件里那 5 条脚本是不是都在、有没有挂错」。少了 handler 级，
  // `Stop` 掉一条脚本时事件集合不变，整份文件照样判 pass（见模块头的作用域表）。
  const seenScriptEvents = new Map(); // suffixKey -> Set<event>
  for (const { event, handler } of handlers) {
    if (!isPlainObject(handler)) continue;
    const suffixKey = ownedScriptSuffixKey(handler.command, ownership);
    if (suffixKey === null) continue;
    const expectedEvent = OWNED_HOOK_EXPECTED_EVENT[suffixKey];
    if (expectedEvent === undefined) {
      // 归属判定认得出（在 OWNED_HOOK_SCRIPT_SUFFIXES 里），却没登记期望事件 —— 两张表脱节。
      // 这是我方自己的登记缺口，fail-loud 好过静默放过一条无人校验的 hook。
      // ⚠️ 诚实标注（F264 / 第二轮 W4.3）：两张表当前 5/5 完全对齐，本分支**结构性不可达**，
      // 是给"将来只改了一张表"准备的前瞻分支 —— **不要**把它算进"已验证的守护力"。
      fail('product', 'product-handler-unregistered', { event, script: suffixKey });
      continue;
    }
    if (event !== expectedEvent) {
      // 🔴 不与事件级判据重复计数（F264 / 第二轮 W4）：事件本身就越界（不在产品集）时，
      // 上面的 `product-event-out-of-scope` 已经报过同一根因；这里只负责"事件在产品集内、
      // 但脚本挂错了那一个"的情形。缺位一侧仍由下方的 `product-handler-missing` 覆盖，
      // 因此不存在漏报。
      if (CODEX_EVENT_PRODUCT_SET.includes(event)) {
        fail('product', 'product-handler-misplaced', { event, script: suffixKey, expectedEvent });
      }
      continue;
    }
    if (!seenScriptEvents.has(suffixKey)) seenScriptEvents.set(suffixKey, new Set());
    seenScriptEvents.get(suffixKey).add(event);
  }
  for (const [script, expectedEvent] of Object.entries(OWNED_HOOK_EXPECTED_EVENT)) {
    if (!seenScriptEvents.has(script)) {
      fail('product', 'product-handler-missing', { event: expectedEvent, script });
    }
  }

  // ---- 我方条目的形状校验（FR-005 / SC-001）----
  if (checkCommandShape) {
    for (const { event, handler } of handlers) {
      if (!isPlainObject(handler) || !isOwnedEntry(handler.command, ownership)) continue;
      const command = handler.command;
      if (handler.type !== 'command') {
        fail('product', 'owned-handler-type-invalid', { event, command });
      }
      if (command.includes('${')) {
        // 🔴 作用域限定（F264 更正）：本判据只对**我方合并写入 `$CODEX_HOME/hooks.json`** 的条目成立。
        // 那份文件里 Codex 不注入任何 plugin root 变量（§8.6），插值必然展开为空串。
        // 但「Codex 从不展开 `${CLAUDE_PLUGIN_ROOT}`」这个更宽的说法**已被实测推翻**：
        // 插件包内 `hooks/hooks.json`（`source=plugin`）里的该占位符会被 Codex 正常展开为
        // 插件 cache 绝对路径（F264 复现步骤 1）。故校验 canonical source 时必须
        // `checkCommandShape: false`，本分支不参与——判据本身不变，只是作用域被钉死。
        fail('product', 'owned-command-interpolated', { event, command });
      }
      const scriptPath = extractOwnedScriptPath(command);
      if (scriptPath === null || !scriptPath.startsWith('/')) {
        fail('product', 'owned-command-not-absolute', { event, command });
      } else if (pathExists && !pathExists(scriptPath)) {
        fail('product', 'owned-command-target-missing', { event, command });
      }
    }
  }

  const hasFail = findings.some((f) => f.level === 'fail');
  const hasWarning = findings.some((f) => f.level === 'warning');
  return {
    ok: !hasFail,
    status: hasFail ? 'fail' : hasWarning ? 'warning' : 'pass',
    ownedEvents: [...ownedEvents],
    foreignEvents: [...foreignEvents],
    findings,
  };
}
