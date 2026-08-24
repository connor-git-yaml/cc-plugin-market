/**
 * codex-plugin-registration.mjs
 * Feature 264 / D1-D2 — 双注册守卫：判定本插件是否已被 Codex 原生注册
 *
 * ## 背景（`specs/264-fix-codex-hooks-distribution/fix-report.md`）
 * `codex plugin add` 之后 Codex 会直接注册插件包内的 `hooks/hooks.json`；若此时再跑
 * `install-codex-hooks.mjs` 把同一批 hook 合并写进 `$CODEX_HOME/hooks.json`，同一 hook
 * 会被注册两遍（`hooks/list` 返回 10 条同名重复，Codex 不去重、不告警）。本模块只回答
 * 一个问题：**这台机器上，Codex 是否已经原生注册了本插件？** 命中则 `install-codex-hooks.mjs`
 * 拒绝写入（见该文件的 `EXIT_ALREADY_REGISTERED`）。
 *
 * ## 🔴 判据设计经过两轮异构对抗，两轮的结论**方向相反**，最终形态是二者的合取
 *
 * **第一轮（绕过面）实测**：初版把 config.toml 与 cache 写成对等 AND，任一侧判不出即放行 ——
 * 于是 symlink 快照、10 种合法但我方词法扫描器认不出的 TOML 段头写法、BOM、EACCES
 * 全部静默放行，双注册照旧发生（审查方用完整生产 shell 链实跑复现）。
 *
 * **第二轮（误拒面）实测**：把 cache 改成主信号同样错，因为 **cache 是内容仓，不是注册台账**。
 * 本机真实 `~/.codex` 反证：`github` 同时躺在 `openai-curated/` 与 `openai-curated-remote/`
 * 两个 cache 目录里，而 `config.toml` 只有 `[plugins."github@openai-curated"]` 一条；
 * `openai-curated-remote/` 下另有 5 个插件目录在 config.toml 里**零对应条目**。
 * 即：**幽灵 cache 真实存在**（换 marketplace 名 / 拷贝 `~/.codex` / 插件改名都会留下），
 * 且 **cache 一级目录名 ≠ config.toml 的 `@marketplace` token**。
 * 后果：用户明确写了 `enabled = false` 却因目录名对不上而豁免失效（误拒），
 * 提示里点名的还是一个 config.toml 里根本不存在的名字（用户无从下手）。
 * 加重这条的是：codex-cli 0.144.6 的 `codex plugin` **没有 `disable` 子命令**
 * （只有 add / list / marketplace / remove），`enabled = false` 只能手改文件 ——
 * 把它设成"唯一豁免"等于把误拒出口修在一条大多数用户走不到的路上。
 *
 * **终版判据（config.toml 为注册台账，cache 仅作兜底证据）**：
 *
 * | # | 条件 | 结论 | 依据 |
 * |---|---|---|---|
 * | 1 | config.toml 读不出 | 有 cache 证据 → 拒绝（并记 `config-unreadable`）；否则放行 | 判不出时才轮到兜底证据 |
 * | 2 | 解析出 `[plugins."<name>@<mkt>"]` 表，且**全部**显式 `enabled = false` | 放行 | E2：此时 `hooks/list` 返回 0 条。**不再要求与 cache 目录名对上**，C1 由此关闭 |
 * | 3 | 解析出表且**存在**未被显式关闭的 | 拒绝，点名该表的 `@mkt` token（**该 token 一定在 config.toml 里找得到**） | E3：`enabled` 键缺失时 Codex 照常注册 |
 * | 4 | 一条表都没解析出，但配置文本里**出现过插件名**，且有 cache 证据 | 拒绝（记 `config-plugin-mention-unparsed`） | 第一轮那 10 种 exotic 写法全都含插件名字面量；缺了这条就是 fail-open |
 * | 5 | 配置文本里根本没提到插件名 | 放行 | C2：幽灵 cache 不再造成永久误拒 |
 *
 * 行 4 的已知代价（诚实登记）：用户用 exotic 写法写的 `enabled = false`，或 config.toml 里
 * 因别的原因提到 `spec-driver` 字样，会拿到一次**误拒**。这比第一轮的 fail-open 窄得多，
 * 且落在可见一侧：命中时打印诊断 + 证据路径，`--force-hooks` 可覆盖。
 *
 * ## 🔴 已知残余误拒面（诚实登记，不假装已消除）
 * 复用 `normalizeTomlLines` 带来一个**方向翻转**：它头部那份"不支持形态清单 → 全部落 absent
 * 安全方向"的承诺，是对 doctor（absent = indeterminate）说的；在本模块里 absent ⇒ 判不出归属
 * ⇒ `enabled` 停在 `undefined` ⇒ 判"启用" ⇒ **拒绝**。也就是说**词法扫描器的每个盲区都自动
 * 等价于一次误拒**。已用 `scanPluginMentions` 把其中最常见的几种（段头内侧空白、literal string
 * 键、inline table）连同它们的 `enabled = false` 一起救回来，但仍有一类救不回：
 *
 * > 插件表内在 `enabled` **之前**出现以 `[` 开头的续行（如多行数组 `matrix = [\n  [1, 2],\n]`），
 * > 归属会被提前断开，`enabled = false` 读不到 ⇒ 误拒。
 *
 * 不为它加"值上下文跟踪"是刻意的：那等于在这里再造半个 TOML 解析器，而本仓已被
 * 手写解析器的枚举式盲区反复教育过（F231 / F236 / F259）。现实性也低 —— Codex 自己写出的
 * 插件表只有 `enabled` 一个键。误拒时用户会看到判定依据路径与 `--force-hooks` 出口。
 *
 * ## 为什么误拒比漏拦更可接受（两个方向不对称）
 * - **漏拦**（该拒没拒）⇒ 静默双注册：Stop 判定器每轮跑两遍、`BLOCK_LIMIT=2` 一次 Stop 烧尽
 *   即降级放行 —— 用户**看不见**，且损坏的正是依从性门禁本身；
 * - **误拒**（不该拒却拒了）⇒ 一条中文指引 + 证据路径 + `--force-hooks`，skills 安装照常完成。
 *
 * ## 与 `codex-runtime-doctor-io.mjs` 的分工
 * 复用其导出的 `normalizeTomlLines`（同一份单遍词法扫描器，避免第三份手写 TOML 解析器 ——
 * F231/F259 教训：每次独立实现都会漏判某种形态）。**不**复用 `parsePluginRegistry`：
 * 后者的 `enabled` 语义是"默认 false，只有显式 `true` 才置真"（doctor "保守确认 active"的语义），
 * 直接拿来会在 E3 场景下得出相反结论（假阴性，放行本该拦住的双注册）。
 *
 * ## marketplace 名不写死，且两侧的名字**互不推导**
 * config.toml 侧接受任意 `@marketplace` token；cache 侧遍历全部一级目录。
 * 🔴 **绝不**拿一侧的名字去推另一侧的路径 —— 本机实测二者不一一对应，推导即误判（C1 根因）。
 * `marketplaceName` 仅供调用方在诊断场景窄化 cache 扫描范围，生产调用点不传。
 *
 * 运行相关测试:
 *   npx vitest run tests/unit/codex-plugin-registration.test.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { normalizeTomlLines } from './codex-runtime-doctor-io.mjs';
import { collectHandlers, isOwnedEntry } from './codex-hooks-schema.mjs';

/**
 * 目录判定 MUST 走 `statSync`（跟随 symlink），不能用 `Dirent.isDirectory()`。
 *
 * 🔴 对抗审查实测的 CRITICAL：`Dirent.isDirectory()` 是 **lstat 语义**，指向目录的 symlink
 * 返回 `false`。而本机真实 Codex cache 里就有这种形态
 * （`~/.codex/plugins/cache/openai-bundled/chrome/latest -> .../26.810.41047`）。
 * 用 lstat 语义会把这类快照整个跳过 → 守卫判"未注册" → 放行 → 双注册（已用完整生产 shell 链复现）。
 * 同一行代码在 `probeCodexPluginManifest` 里跳过是安全方向（absent → indeterminate），
 * 搬到守卫里跳过就是 fail-open —— 方向必须跟着翻。
 */
function isDirectoryFollowingLinks(absPath) {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    // 悬空软链 / 权限不足 / 竞态删除：不是可枚举的目录，按"此快照无证据"处理
    return false;
  }
}

/** 剥掉 UTF-8 BOM —— 带 BOM 的 JSON 会让 `JSON.parse` 抛错，进而静默丢掉这份证据 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readDirEntries(absPath, diagnostics, what) {
  try {
    return fs.readdirSync(absPath, { withFileTypes: true });
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      // 🔴 "判不出"必须可见：静默当成"没有证据"正是对抗审查抓到的 S5。
      diagnostics.push({ level: 'warning', code: 'cache-scan-unreadable', what, errno: code ?? null });
    }
    return [];
  }
}

/**
 * 扫 cache，返回**有我方 owned hooks 证据**的 marketplace 一级目录名集合。
 *
 * 🔴 cache 内的 `hooks.json` 是**未展开**的静态副本（`${CLAUDE_PLUGIN_ROOT}` 字面量原样落盘，
 * Codex 只在运行时展开），故必须以 `allowPlaceholderRoot: true` 调 `isOwnedEntry`，
 * 否则永远判不出命中。
 */
function collectCacheEvidence(codexHome, pluginName, marketplaceName, diagnostics) {
  const cacheRoot = path.join(codexHome, 'plugins', 'cache');
  const found = [];
  for (const marketplaceEntry of readDirEntries(cacheRoot, diagnostics, 'cache-root')) {
    const marketplace = marketplaceEntry.name;
    if (marketplaceName !== null && marketplace !== marketplaceName) continue;
    const pluginDir = path.join(cacheRoot, marketplace, pluginName);
    if (!isDirectoryFollowingLinks(pluginDir)) continue;
    for (const snapshotEntry of readDirEntries(pluginDir, diagnostics, 'plugin-dir')) {
      const snapshotDir = path.join(pluginDir, snapshotEntry.name);
      if (!isDirectoryFollowingLinks(snapshotDir)) continue;
      const hooksPath = path.join(snapshotDir, 'hooks', 'hooks.json');
      let doc;
      try {
        doc = JSON.parse(stripBom(fs.readFileSync(hooksPath, 'utf-8')));
      } catch (error) {
        const code = error && typeof error === 'object' ? error.code : undefined;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
          diagnostics.push({
            level: 'warning',
            code: 'cache-hooks-unreadable',
            path: hooksPath,
            errno: code ?? null,
          });
        }
        continue;
      }
      const hit = collectHandlers(doc).some(
        ({ handler }) =>
          handler !== null &&
          typeof handler === 'object' &&
          isOwnedEntry(handler.command, { allowPlaceholderRoot: true }),
      );
      if (hit) {
        // 🔴 连证据路径一起回传（第二轮 W3）：误拒时用户必须能看见"是哪个文件让你拒的"，
        // 否则拿到一个 config.toml 里不存在的名字，无从自救。
        found.push({ marketplace, path: hooksPath });
        break; // 一个 marketplace 命中一次就够，不需要枚举它的全部快照
      }
    }
  }
  return found;
}

/**
 * 解析 config.toml 里全部 `[plugins."<pluginName>@<marketplace>"]` 表，`enabled` 取三态。
 *
 * 与 `parsePluginRegistry` 共用同一段边界/段头判据（`isSectionBoundary` / `headerName`），
 * 但 `enabled` 语义不同：那边默认 false（doctor 的"保守确认 active"），这边 `undefined` 独立成态 ——
 * fix-report E3 实测 `enabled` 键缺失时 Codex 照常注册，两者不能混。
 *
 * @returns {{readable: boolean, lines: Array<object>,
 *            tables: Array<{marketplace: string, enabled: boolean|undefined}>}}
 */
function readPluginTables(codexHome, pluginName, diagnostics) {
  const configPath = path.join(codexHome, 'config.toml');
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf-8');
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      // 读不出 ⇒ 台账不可用 ⇒ 退到 cache 兜底证据。必须让用户看得见原因。
      diagnostics.push({ level: 'warning', code: 'config-unreadable', errno: code ?? null });
    }
    return { readable: false, lines: [], tables: [] };
  }

  const tables = [];
  const lines = normalizeTomlLines(text);
  let current = null;
  for (const line of lines) {
    if (line.isSectionBoundary) {
      current = null;
      const pluginKey =
        line.headerName !== null && !line.isArrayTable
          ? /^plugins\."([^"]+)"$/.exec(line.headerName)
          : null;
      if (pluginKey) {
        const atIndex = pluginKey[1].lastIndexOf('@');
        if (atIndex > 0 && pluginKey[1].slice(0, atIndex) === pluginName) {
          current = { marketplace: pluginKey[1].slice(atIndex + 1), enabled: undefined };
          tables.push(current);
        }
      }
      continue;
    }
    if (current === null) continue;
    if (/^enabled\s*=\s*true$/.test(line.text)) current.enabled = true;
    else if (/^enabled\s*=\s*false$/.test(line.text)) current.enabled = false;
  }
  return { readable: true, lines, tables };
}


/**
 * 在 config.toml 里**结构化地**找本插件的痕迹（F264 / 第一轮审查 CRITICAL-1 修订）。
 *
 * 🔴 这里绝不能用「全文件子串匹配插件名」。异构对抗实测出三条误拒链，全都命中那种写法：
 * - 用户**注释掉**插件段来停用（`codex plugin` 没有 `disable` 子命令，手改是唯一途径，
 *   而注释掉正是最自然的手改）—— 注释在归约后已被剥掉，语义上就是"没注册"；
 * - `[projects."/Users/dev/code/spec-driver"]` 这类**信任目录**段：Codex 给每个受信目录写一条，
 *   本机实测有 8 条，路径里带插件名再正常不过；
 * - `[plugins."spec-driver-lite@other"]` 这类**名字含子串**的第三方插件。
 * 三者都会让守卫吐出「已由 Codex 原生注册生效」——一句在这些情形下**是假的**陈述，
 * 而用户没有理由怀疑它，唯一出口 `--force-hooks` 也就无从想起。
 *
 * 故判据收紧为两条合取：
 * 1. **作用域**：该行必须落在 plugins 语境里 —— `[plugins…]` / `[[plugins…]]` 段头、
 *    `plugins.` 点分键、`[profiles.<x>.plugins…]`，或位于 `[plugins]` 表体内；
 * 2. **token 边界**：行内出现 `"<name>@` / `'<name>@` / `"<name>"` / `'<name>'`，
 *    而不是裸子串（挡掉 `spec-driver-lite`）。
 *
 * 命中后继续向前扫到下一个段边界，找**显式 `enabled = false`**（含同行的 inline table 形态）：
 * 找到即视为用户已关停 —— 这让 `[ plugins."x@y" ]`、`[plugins.'x@y']` 这类我方解析不出的
 * 合法写法**仍然能豁免**，把第二轮 WARNING-2 那类误拒也一并收掉。
 *
 * @returns {{mentioned: boolean, disabled: boolean}}
 */
function scanPluginMentions(lines, pluginName) {
  const tokens = [`"${pluginName}@`, `'${pluginName}@`, `"${pluginName}"`, `'${pluginName}'`];
  let insidePluginsTable = false;
  let mentioned = false;
  let disabled = false;
  let trailing = false; // 正处在"某条提及本插件的行"之后、下一个段边界之前

  for (const line of lines) {
    const text = line.text;
    // 段头内侧空白（`[ plugins."x" ]` / `[\tplugins…`）在作用域判定前吸收掉
    const compact = text.replace(/^\[+\s+/, (m) => m.replace(/\s+/g, ''));

    if (line.isSectionBoundary) {
      trailing = false;
      insidePluginsTable = /^\[\s*plugins\s*\]$/.test(text);
    }
    const pluginsScoped =
      insidePluginsTable ||
      compact.startsWith('[plugins') ||
      compact.startsWith('[[plugins') ||
      text.startsWith('plugins.') ||
      (compact.startsWith('[profiles.') && compact.includes('.plugins'));

    if (pluginsScoped && tokens.some((token) => text.includes(token))) {
      mentioned = true;
      trailing = true;
      if (/enabled\s*=\s*false/.test(text)) disabled = true; // inline table 形态
      continue;
    }
    if (trailing && /^enabled\s*=\s*false$/.test(text)) disabled = true;
  }
  return { mentioned, disabled };
}

/**
 * 判定本插件是否已被 Codex 原生注册。
 *
 * @param {{codexHome: string, pluginName: string, marketplaceName?: string|null}} params
 * @returns {{registered: boolean, marketplace: string|null, evidencePaths: string[],
 *            diagnostics: Array<{level: string, code: string}>}}
 *   `marketplace` 命中时点名注册来源：走台账分支时是 config.toml 里**确实存在**的 `@mkt` token
 *   （用户按它就能找到该改哪一行）；走兜底分支时退化为 cache 一级目录名。未命中恒为 `null`。
 *   `evidencePaths` 是触发判定的 cache 内 `hooks.json` 绝对路径清单（第二轮 W3：误拒时用户
 *   必须看得见"是哪个文件让你拒的"）。`diagnostics` 承载"判不出"的可见信号，调用方 MUST 打印。
 */
export function detectNativePluginRegistration({ codexHome, pluginName, marketplaceName = null }) {
  if (typeof codexHome !== 'string' || codexHome.length === 0) {
    throw new Error('detectNativePluginRegistration: codexHome 缺失或为空串');
  }
  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    throw new Error('detectNativePluginRegistration: pluginName 缺失或为空串');
  }

  const diagnostics = [];
  const blocked = (marketplace, evidencePaths) => ({
    registered: true,
    marketplace,
    evidencePaths,
    diagnostics,
  });
  const allowed = () => ({ registered: false, marketplace: null, evidencePaths: [], diagnostics });

  const config = readPluginTables(codexHome, pluginName, diagnostics);
  const diagnosticsBeforeCacheScan = diagnostics.length;
  const cache = collectCacheEvidence(codexHome, pluginName, marketplaceName, diagnostics);
  const cachePaths = cache.map((item) => item.path);
  /** cache 侧是否**干净地**扫完（没有 EACCES 之类的"判不出"）—— 决定"没找到"能不能当结论用 */
  const cacheScanClean = diagnostics.length === diagnosticsBeforeCacheScan;

  /** 台账对"本插件是否处于启用注册态"的回答；`null` = 台账没给出答案 */
  const activeTable = config.readable
    ? (config.tables.find((table) => table.enabled !== false) ?? null)
    : null;
  /**
   * 台账解析不出表，但 plugins 语境里**结构化地**提到了本插件 —— 极可能是我方词法扫描器
   * 认不出的合法写法。同时看该处有没有显式 `enabled = false`（那就是用户已关停）。
   */
  const mention =
    config.readable && config.tables.length === 0
      ? scanPluginMentions(config.lines, pluginName)
      : { mentioned: false, disabled: false };
  const mentionOnly = mention.mentioned && !mention.disabled;

  if (cache.length > 0) {
    // 有我方 hooks 缓存 ⇒ Codex **有东西可注册**，此时由台账逐条裁决每一份证据。
    if (config.tables.length > 0) {
      for (const evidence of cache) {
        // 🔴 名字匹配是**单向优待**，不是硬绑定：
        // 能精确对上（cache 目录名 == 某个 `@mkt` token）就用那张表的 enabled 状态 —— 这样
        //「关掉了有证据的那个、另一个 marketplace 还开着」不会被误拒；
        // 对不上就退回**聚合判断**（任一表未被显式关闭即算启用）—— 本机实测 cache 目录名与
        // token 并不一一对应（`openai-curated` vs `openai-curated-remote`），若要求必须对上，
        // 用户写的 `enabled = false` 就永远豁免不了（C1 根因）。
        const exact = config.tables.find((table) => table.marketplace === evidence.marketplace);
        if (exact) {
          if (exact.enabled !== false) return blocked(exact.marketplace, cachePaths);
          continue;
        }
        if (activeTable !== null) return blocked(activeTable.marketplace, cachePaths);
      }
      return allowed();
    }
    if (!config.readable) return blocked(cache[0].marketplace, cachePaths);
    if (mentionOnly) {
      diagnostics.push({ level: 'warning', code: 'config-plugin-mention-unparsed' });
      return blocked(cache[0].marketplace, cachePaths);
    }
    // 台账里根本没提到本插件 ⇒ 这是幽灵 cache（实测真实存在：换 marketplace 名、
    // 拷贝 ~/.codex、插件改名都会留下）。据此拒绝会造成**永久性**误拒且无可操作出口。
    return allowed();
  }

  // 没有 cache 证据。分两种：
  // (a) **干净地**扫完但确实没有我方 hooks.json ⇒ Codex 无可注册（例如用户装的是更早、
  //     还没带 hooks 的插件版本）—— 拦下来纯属误拒，放行；
  // (b) 扫描本身判不出（EACCES 等）⇒ "没找到"不能当结论用。此时若台账说本插件处于启用态、
  //     或台账自己也读不出，就落回保守侧拒绝，并让诊断把"为什么判不出"说清楚。
  if (!cacheScanClean && (!config.readable || activeTable !== null || mentionOnly)) {
    diagnostics.push({ level: 'warning', code: 'cache-scan-inconclusive' });
    return blocked(activeTable?.marketplace ?? null, cachePaths);
  }
  return allowed();
}
