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
 * | schema | 全文件事件名 | 是否属于 Codex 10 事件全集 | 我方条目非法 → fail；第三方未知名 → warning |
 * | product | **仅我方 owned 条目**覆盖的事件集合 | 恰等于 4 项 | 越界 / 缺项 → fail（code 可区分） |
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
 * Codex hook 事件全集（10 项，PascalCase）。
 * 来源：`_grounding.md` §2 —— 从 codex 二进制提取 `HookEventName` / `HookEventNameWire` /
 * `HookEventsToml` 三处枚举去重。**全集中不存在 `WorktreeCreate` / `WorktreeRemove`**。
 */
export const CODEX_EVENT_SCHEMA_SET = Object.freeze([
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
]);

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
  Object.freeze(['hooks', 'stop-task-check.sh']),
  Object.freeze(['hooks', 'stop-fix-compliance-check.sh']),
]);

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

  // ---- 我方条目的形状校验（FR-005 / SC-001）----
  if (checkCommandShape) {
    for (const { event, handler } of handlers) {
      if (!isPlainObject(handler) || !isOwnedEntry(handler.command, ownership)) continue;
      const command = handler.command;
      if (handler.type !== 'command') {
        fail('product', 'owned-handler-type-invalid', { event, command });
      }
      if (command.includes('${')) {
        // Codex 不注入任何 plugin root 变量（§8.6），运行期插值必然展开为空串
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
