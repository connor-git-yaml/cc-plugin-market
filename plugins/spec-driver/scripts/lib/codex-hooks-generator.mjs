/**
 * codex-hooks-generator.mjs
 * Feature 240 / FR-001 / FR-005 — 从 canonical `hooks.json` 派生 Codex 侧 hooks 声明
 *
 * ## 单一事实源
 * 🔴 **不新建并列的 `hooks.codex.json`**：两份声明必然漂移（F238 教训），Codex 侧内容一律
 * 从 `plugins/spec-driver/hooks/hooks.json` 派生。两个运行时的差异只有两处，都在本文件里：
 *
 * 1. **事件过滤**：`WorktreeCreate` / `WorktreeRemove` 是 Claude adapter 独有，Codex 事件全集
 *    中不存在（`_grounding.md` §2）。写进去不会报错也不会触发（§8.2：未知事件名静默忽略）。
 * 2. **路径展开**：`${CLAUDE_PLUGIN_ROOT}` 在**生成期**展开为绝对路径。`_grounding.md` §8.6
 *    实测 Codex **不注入**任何 `PLUGIN_ROOT` / `CODEX_PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT`
 *    变量，运行期插值会展开为空串 → `bash /hooks/x.sh` → 必然失败。
 *
 * ## 范围声明：本批次**不改写** matcher
 * `_grounding.md` §8.4 实测 Codex 下 `tool_name` 恒为 `Bash`（无 Edit/Write 工具），因此
 * canonical 的 `"matcher": "Edit|Write"` 在 Codex 下永不匹配。**本批次刻意保持 matcher 逐字
 * 不变**，理由：
 * - 改成 `Bash` 或空 matcher 会让 `pre-tool-use-guard.sh` / `post-tool-use-format.sh` 在 Codex
 *   下对每次 Bash 调用触发。这两个脚本全仓零测试覆盖且刚由 F245 修过，本 feature 明令不改
 *   （tasks T026/T027 已废止），在此扩大其触发面等于绕开该禁令；
 * - 要让它们在 Codex 下有意义，必须从 `tool_input.command` 里解析目标路径 —— 正是 F231 已
 *   实测证伪的路线（用户已拍板禁止）。
 * 因此「Codex 下文件编辑类 hook 覆盖不到」是**已诚实挂账的上游缺口**（§8.4/§8.8），不在本
 * 批次用 matcher 改写来假装解决。
 *
 * 运行相关测试: npx vitest run tests/unit/codex-hooks-generator.test.ts
 */

import {
  CODEX_EVENT_PRODUCT_SET,
  OWNED_PATH_COMPONENT,
  isClaudeOnlyEntry,
  validateCodexHooksDocument,
} from './codex-hooks-schema.mjs';

/** canonical 声明相对插件根的位置（唯一事实源） */
export const CANONICAL_HOOKS_RELATIVE_PATH = 'hooks/hooks.json';

/** 生成期需要展开的插值记号 */
export const PLUGIN_ROOT_PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';

/**
 * 无需引号包裹的安全字符集。
 *
 * 🔴 **刻意不含 `=`**，尽管 POSIX 常见 safe set 含它。理由：归属判定的 token 切分
 * （`codex-hooks-schema.mjs` 的 `splitCommandTokens`）把 `=` 当分隔符（`VAR=value cmd` 形态），
 * 若这里让含 `=` 的路径裸奔不加引号，token 会在 `=` 处被腰斩成相对路径 ⇒ 安装期直接
 * `owned-command-not-absolute` 硬失败。实测：`pluginRoot` 含 `=` 时 install 退出码 1 ×4 条。
 * 两处规则必须相容 —— 让含 `=` 的路径走单引号包裹是唯一无歧义的相容方式。
 */
const SHELL_SAFE = /^[A-Za-z0-9_@%+:,./-]+$/;

/**
 * POSIX 单引号包裹。
 *
 * 为什么需要：插件可能装在含空格的路径下（如 macOS 的 `/Users/John Smith/...`）。不加引号
 * 会让 `bash /Users/John Smith/.../x.sh` 被 shell 切成两个参数 —— 这是一个**静默失效**面
 * （hook 报错在 Codex 侧不可见）。单引号 + `'\''` 是完整的 POSIX 规则，不是「手写半个 shell
 * 解析器」（F231 禁止的是**解析**别人的命令串，这里是**构造**我们自己的）。
 */
function shellQuote(value) {
  if (SHELL_SAFE.test(value)) return value;
  return `'${value.split("'").join(`'\\''`)}'`;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 该事件下的全部 handler 是否都是我方 Claude-only hook（可安全过滤掉）。
 * canonical 里的路径还带 `${CLAUDE_PLUGIN_ROOT}` 占位，故归属判定开 `allowPlaceholderRoot`。
 */
function isClaudeOnlyEvent(groups) {
  const commands = [];
  for (const group of groups) {
    if (!isPlainObject(group) || !Array.isArray(group.hooks)) continue;
    for (const handler of group.hooks) {
      if (isPlainObject(handler)) commands.push(handler.command);
    }
  }
  return (
    commands.length > 0 &&
    commands.every((command) => isClaudeOnlyEntry(command, { allowPlaceholderRoot: true }))
  );
}

/**
 * 生成 Codex 侧 hooks 声明。
 *
 * @param {{canonical: unknown, pluginRoot: string}} args
 *   `pluginRoot` **必填且必须是绝对路径** —— 不给默认值：F238 已实测证明「可选参数 + 内部
 *   默认值」会让 caller 的遗漏静默降级，这里降级的后果是把相对路径写进全局 hooks.json。
 * @returns {{hooks: Record<string, unknown[]>}}
 */
export function generateCodexHooks({ canonical, pluginRoot } = {}) {
  if (typeof pluginRoot !== 'string' || pluginRoot.length === 0) {
    throw new TypeError('generateCodexHooks: pluginRoot 必填，且必须是非空字符串');
  }
  if (/[\r\n]/.test(pluginRoot)) {
    throw new TypeError('generateCodexHooks: pluginRoot 不得含换行，无法安全嵌入 shell 命令');
  }
  if (!pluginRoot.startsWith('/')) {
    throw new TypeError(`generateCodexHooks: pluginRoot 必须是绝对路径，实际为 ${pluginRoot}`);
  }
  // 归属锚点的硬前提：展开后的 command 必须含 `spec-driver` 目录分量，否则卸载时
  // `isOwnedEntry` 认不出自己写进去的条目（残留 + 重装重复）。此处 fail-loud 给出准确
  // 原因，而不是把问题留到下面的自检里报成含义模糊的 product-event-missing。
  if (!pluginRoot.split('/').includes(OWNED_PATH_COMPONENT)) {
    throw new Error(
      `generateCodexHooks: pluginRoot 必须含 '${OWNED_PATH_COMPONENT}' 目录分量（归属锚点前提），实际为 ${pluginRoot}`,
    );
  }
  if (!isPlainObject(canonical) || !isPlainObject(canonical.hooks)) {
    throw new TypeError('generateCodexHooks: canonical 必须是 { hooks: {...} } 形态的对象');
  }

  const quotedRoot = shellQuote(pluginRoot);
  const expand = (command) => {
    if (typeof command !== 'string') {
      throw new TypeError('generateCodexHooks: handler.command 必须是字符串');
    }
    // 引号包裹只作用于被替换进去的路径本身，命令其余部分逐字保留
    return command.split(PLUGIN_ROOT_PLACEHOLDER).join(quotedRoot);
  };

  const hooks = {};
  const sourceEvents = Object.keys(canonical.hooks);

  for (const event of sourceEvents) {
    const raw = canonical.hooks[event];
    const groups = Array.isArray(raw) ? raw : [];
    if (CODEX_EVENT_PRODUCT_SET.includes(event)) continue;
    // 空事件键（`"WorktreeCreate": []`）下没有任何 handler 可丢失，分类无从谈起。
    // 不跳过的话会撞上下面那句「请登记进 CLAUDE_ONLY_HOOK_SCRIPT_NAMES」——对空数组毫无意义的指引。
    if (Array.isArray(raw) && raw.length === 0) continue;
    if (isClaudeOnlyEvent(groups)) continue;
    // 🔴 fail-loud：canonical 新增了一个既不在 Codex 4 事件子集、又不是已知 Claude-only 脚本的
    // 事件。静默丢弃会让新 hook 在 Codex 下神秘失踪；这必须由人决定是纳入产品集还是登记为
    // Claude-only。
    throw new Error(
      `generateCodexHooks: canonical hooks.json 含未分类事件 ${event} —— ` +
        '请将其加入 CODEX_EVENT_PRODUCT_SET，或把其脚本登记进 CLAUDE_ONLY_HOOK_SCRIPT_NAMES',
    );
  }

  for (const event of CODEX_EVENT_PRODUCT_SET) {
    const groups = canonical.hooks[event];
    if (!Array.isArray(groups)) continue;
    hooks[event] = groups.map((group) => {
      if (!isPlainObject(group)) {
        throw new TypeError(`generateCodexHooks: ${event} 下存在非对象条目`);
      }
      const handlers = Array.isArray(group.hooks) ? group.hooks : [];
      return {
        ...group,
        hooks: handlers.map((handler) => {
          if (!isPlainObject(handler)) {
            throw new TypeError(`generateCodexHooks: ${event} 下存在非对象 handler`);
          }
          // 🔴 Claude-only 过滤 MUST 做到 handler 级，不能只做事件级。
          // 上面的分类循环是按**事件**判 Claude-only 的；一旦 canonical 把
          // `worktree-lifecycle.sh` 挂到已知产品事件（如 `Stop`）下，事件级判定会因为该事件
          // 在产品集里而直接 `continue`，本循环再无条件展开该事件下的**全部** handler ——
          // 实测产物里会出现 `worktree-lifecycle.sh`，静默装进 Codex（那里没有对应事件语义）。
          // 本模块存在的唯一理由就是防这类漂移，对未分类**事件** fail-loud 却对未分类
          // **handler** 静默放行，是自相矛盾。
          if (isClaudeOnlyEntry(handler.command, { allowPlaceholderRoot: true })) {
            throw new Error(
              `generateCodexHooks: 事件 ${event} 下挂了 Claude adapter 独有脚本 ` +
                `(${handler.command}) —— Codex 侧无对应语义，请从 canonical 的该事件移走，` +
                '或把它纳入产品集并给出 Codex 侧实现',
            );
          }
          return { ...handler, command: expand(handler.command) };
        }),
      };
    });
  }

  const generated = { hooks };

  // 自守卫：产物必须自己过得了两层门禁（含「零 `${` 残留」与「绝对路径」）。
  // 生成器与门禁互为对方的回归防线，任一侧写错都在此处炸出来，而不是等到写进用户的全局文件。
  const report = validateCodexHooksDocument(generated, { checkCommandShape: true });
  if (!report.ok) {
    const codes = report.findings
      .filter((f) => f.level === 'fail')
      .map((f) => `${f.code}${f.event ? `(${f.event})` : ''}`)
      .join(', ');
    throw new Error(`generateCodexHooks: 产物未通过事件门禁自检 —— ${codes}`);
  }

  return generated;
}
