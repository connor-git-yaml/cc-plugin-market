/**
 * namespace-consistency-core.mjs
 *
 * 从 plugin.json name + .mcp.json server key 派生期望 namespace，
 * 校验 spec-driver agent frontmatter 一致性。
 * 单一源派生守护，防止人工错改 frontmatter。
 */
import fs from 'node:fs';
import path from 'node:path';

/** frontmatter 内「出现了一个 tools 键」的**宽**检测（用于计数与形态判定）。
 *  刻意比取值正则宽：`tools :`（冒号前空格）/ `"tools":` / `'tools':` / 带缩进的
 *  嵌套键都要被**看见**——看不见就会走到「无 tools 键 ⇒ 返回 null」那一支，
 *  而那一支在消费侧等价于「文件里没写工具面」，与事实相反。 */
const TOOLS_KEY_DETECT_RE = /^[ \t]*(["']?)tools\1[ \t]*:/;

/** 唯一受支持的**规范**键写法：顶层、无引号、冒号紧贴键名 */
const TOOLS_KEY_CANONICAL_RE = /^tools:(.*)$/;

/** 块序列项：`  - X`（也允许与键同列的 `- X`，那同样是合法 YAML）*/
const BLOCK_ITEM_RE = /^[ \t]*-[ \t]+(.*)$/;

/** 行内流式数组：必须在**同一行**闭合，`]` 之后只允许空白或行内注释 */
const INLINE_FLOW_RE = /^\[([^[\]]*)\][ \t]*(#.*)?$/;

function unsupportedToolsSyntax(reason) {
  return new Error(
    `frontmatter 的 tools 键写法不受支持，拒绝解析（判不出⇒判失败）：${reason}`
    + '。本解析器只支持两种规范写法——单行闭合的行内数组 `tools: [A, B]`，'
    + '或紧随其后的块序列 `- A`（不得夹带空行 / 注释行 / 非序列项）。'
    + '任何其他写法都可能与运行时的 YAML 解析器读出不同的工具面，'
    + '此时给出的 pass 不构成证据',
  );
}

/** 去引号 */
function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, '');
}

/**
 * 解析行内流式数组。整段必须单行闭合，且不得含空元素——
 * 空元素会让「读到的项」少于「文件里写的项」，那正是必须消失的那条路径。
 */
function parseInlineToolsFlow(rest) {
  const match = INLINE_FLOW_RE.exec(rest);
  if (!match) {
    throw unsupportedToolsSyntax(
      `行内数组未在同一行闭合或含嵌套结构：${JSON.stringify(rest)}`,
    );
  }
  const inner = match[1].trim();
  if (inner === '') return [];
  const items = match[1].split(',').map((t) => t.trim());
  if (items.some((t) => t === '')) {
    throw unsupportedToolsSyntax(`行内数组含空元素：${JSON.stringify(rest)}`);
  }
  return items.map(stripQuotes);
}

/**
 * 解析块序列。**遇到任何不可归类的行即抛错**，绝不「读到哪算哪」。
 *
 * 三种曾经导致静默截断的写法（都是合法 YAML，规范解析器会读到全部条目）
 * 现在一律 throw：序列中间夹空行、夹注释行、夹非 `- ` 行之后又出现 `- ` 项。
 */
function parseToolsBlockSequence(lines, keyIndex) {
  const items = [];
  let sawGap = false;
  let gapSample = '';
  for (let i = keyIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const item = BLOCK_ITEM_RE.exec(line);
    if (item) {
      if (sawGap) {
        throw unsupportedToolsSyntax(
          `块序列被 ${JSON.stringify(gapSample)} 截断后又出现序列项 ${JSON.stringify(line)}`
          + '——截断处之后的条目会被静默丢弃',
        );
      }
      const raw = item[1];
      if (/(^|\s)#/.test(raw)) {
        throw unsupportedToolsSyntax(`块序列项带行内注释：${JSON.stringify(line)}`);
      }
      const value = stripQuotes(raw.trim());
      if (value === '') {
        throw unsupportedToolsSyntax(`块序列含空序列项：${JSON.stringify(line)}`);
      }
      items.push(value);
      continue;
    }
    // 顶层的下一个键 ⇒ 块序列正常结束
    if (/^\S/.test(line)) break;
    if (line.trim() === '' || /^[ \t]*#/.test(line)) {
      // 尾随空行 / 注释本身无害；只有「其后还有序列项」才是丢条目
      sawGap = true;
      gapSample = line;
      continue;
    }
    throw unsupportedToolsSyntax(`块序列中出现不可归类的行：${JSON.stringify(line)}`);
  }
  return items;
}

/**
 * 从 YAML frontmatter 中提取 tools 数组。
 *
 * **返回值三分**（Feature 277 Phase A 对抗修订第二轮 · β-C1 / α-W2 三变体）：
 *   - `null`      —— 无 frontmatter，或 frontmatter 内**没有** tools 键；
 *   - **抛错**    —— 有 tools 键但写法不受支持（见 `unsupportedToolsSyntax` 的枚举）；
 *   - `string[]`  —— 规范写法，**完整**数组。
 *
 * **「读不全就返回真子集」这条路径已被删除**。它是 β-C1 的根因：
 * `verify:no-added-tools` 的判据当时是单向集合差，解析器每漏读一项，`added` 就少一项，
 * 完全读不出时 `added = ∅` 恒成立——「解析器失效」与「确实零新增」在那条判据上是同一个观测值。
 * 实测的失效构造包括：frontmatter 前多一个空行、文件带 BOM（`fmMatch` 不匹配 ⇒ 旧实现返回 `[]`）、
 * 块序列中间夹空行 / 注释行 / 空序列项（旧实现静默截断，`Write` / `Edit` 落在截断之后）。
 *
 * 支持的两种规范写法：
 *   1. 行内数组（可带引号）：`tools: [Read, mcp__plugin_spectra_spectra__context]`
 *   2. YAML block sequence：
 *        tools:
 *          - Read
 *          - mcp__plugin_spectra_spectra__context
 *
 * 不受支持因而**抛错**的写法（α-W2 复验的三种变体在列）：
 * `tools :`（冒号前空格）、`"tools":` / `'tools':`（引号键）、`tools:` 后接行内注释、
 * 缩进的嵌套 `tools:` 键、标量取值、流式数组跨行、块序列被空行 / 注释行 / 非序列项截断、
 * 重复 tools 键。**判不出⇒判失败**：运行时解析器取哪一份不在本仓可观测范围内，
 * 猜一个读法给出的 pass 不构成证据。
 *
 * **诚实边界（δ-W2：不得口径为「任何歧义文档一律判红」）**：本文件是**手写词法**，
 * 不是 YAML 解析器。检测面是 `TOOLS_KEY_DETECT_RE` 这一条行首正则——它覆盖了
 * `tools :` / `"tools":` / `'tools':` / 带缩进这几类（α-W2 复验的 b1 / b2 与嵌套形态），
 * 但**不覆盖** YAML 的显式键语法（`? tools` / `: [...]`）、多文档流（`---` 分隔的第二篇）、
 * 锚点与别名（`<<: *base`）等把 `tools` 键写在别处的形态。这些形态下本解析器会返回
 * `null`（消费侧判 fail，方向安全），但那是「看不见 ⇒ 当作没写」的巧合，不是判据覆盖。
 * 根治要引 YAML 依赖，与 FR-037 的零依赖纪律冲突，须走 spec 修订。
 *
 * Feature 277（FR-017）：由私有函数改为具名导出。`scripts/lib/agent-tools-core.mjs`
 * 复用同一份解析器——两个守护项读的是同一批 frontmatter，各写一份解析器必然漂移。
 * 两者的差别只在**过滤**：本文件在消费侧只保留 `mcp__` 前缀项，agent-tools 侧
 * 不过滤（该过滤正是 `Edit` / `Bash` 在既有守护项里结构性不可见的根因）。
 *
 * @param {string} content 文件全文
 * @returns {string[]|null} 完整 tool 名称列表；无 frontmatter / 无 tools 键时为 `null`
 * @throws {Error} 有 tools 键但写法不受支持（含重复键）时
 */
export function extractFrontmatterTools(content) {
  const fmMatch = typeof content === 'string' ? content.match(/^---\s*\n([\s\S]*?)\n---/) : null;
  if (!fmMatch) return null;
  const lines = fmMatch[1].split('\n');

  const keyLineIndexes = [];
  lines.forEach((line, index) => {
    if (TOOLS_KEY_DETECT_RE.test(line)) keyLineIndexes.push(index);
  });

  if (keyLineIndexes.length === 0) return null;
  if (keyLineIndexes.length > 1) {
    throw new Error(
      `frontmatter 内 "tools" 键出现 ${keyLineIndexes.length} 次，语义有歧义，拒绝解析`
      + '（判不出⇒判失败：符合规范的 YAML 解析器对重复键要么报错要么末键胜出，'
      + '本解析器取首个，二者不一致时给出的 pass 不构成证据）',
    );
  }

  const keyIndex = keyLineIndexes[0];
  const keyLine = lines[keyIndex];
  const canonical = TOOLS_KEY_CANONICAL_RE.exec(keyLine);
  if (!canonical) {
    throw unsupportedToolsSyntax(
      `键行不是规范的顶层 "tools:"：${JSON.stringify(keyLine)}`,
    );
  }

  const rest = canonical[1].trim();
  if (rest === '') return parseToolsBlockSequence(lines, keyIndex);
  if (rest.startsWith('[')) return parseInlineToolsFlow(rest);
  throw unsupportedToolsSyntax(`键行取值既不是行内数组也不是空（块序列）：${JSON.stringify(keyLine)}`);
}

/**
 * 从 plugin.json + .mcp.json 派生期望 namespace 前缀。
 * 公式：mcp__plugin_{pluginName}_{serverKey}__
 * 仅支持单 server（多 server 时 fail-loud）。
 */
export function deriveExpectedNamespace(projectRoot) {
  const pluginJsonPath = path.join(
    projectRoot,
    'plugins/spectra/.claude-plugin/plugin.json',
  );
  const mcpJsonPath = path.join(projectRoot, 'plugins/spectra/.mcp.json');

  if (!fs.existsSync(pluginJsonPath)) {
    throw new Error(`plugin.json 不存在：${pluginJsonPath}`);
  }
  if (!fs.existsSync(mcpJsonPath)) {
    throw new Error(`.mcp.json 不存在：${mcpJsonPath}`);
  }

  const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
  const mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));

  const pluginName = pluginJson.name;
  if (!pluginName) {
    throw new Error('plugin.json 缺少 name 字段');
  }

  const serverKeys = Object.keys(mcpJson.mcpServers ?? {});
  if (serverKeys.length === 0) {
    throw new Error('.mcp.json 的 mcpServers 为空');
  }
  if (serverKeys.length > 1) {
    throw new Error(
      `.mcp.json 含多个 mcpServers（${serverKeys.join(', ')}），namespace 派生需明确指定目标 server`,
    );
  }
  const serverKey = serverKeys[0];

  return `mcp__plugin_${pluginName}_${serverKey}__`;
}

const AGENT_FILES = [
  'plan.md',
  'implement.md',
  'verify.md',
  'spec-review.md',
  'quality-review.md',
];

/**
 * 验证 spec-driver agent frontmatter namespace 一致性。
 * 这 5 个受保护 agent 文件必须包含至少一个正确 namespace 的 MCP 工具——
 * 无 MCP 工具视为配置缺失（FAIL），而非 skip。
 */
export function validateNamespaceConsistency(projectRoot) {
  const checks = [];
  const errors = [];
  const warnings = [];

  let expectedNamespace;
  try {
    expectedNamespace = deriveExpectedNamespace(projectRoot);
  } catch (err) {
    errors.push(`无法派生期望 namespace：${err.message}`);
    return { status: 'fail', checks, warnings, errors };
  }

  const agentsDir = path.join(projectRoot, 'plugins/spec-driver/agents');

  for (const agentFile of AGENT_FILES) {
    const agentPath = path.join(agentsDir, agentFile);
    const checkId = `agent-frontmatter-${agentFile.replace('.md', '')}`;

    if (!fs.existsSync(agentPath)) {
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'fail',
        evidence: { missing: agentPath },
      });
      errors.push(`${agentFile} 不存在`);
      continue;
    }

    const content = fs.readFileSync(agentPath, 'utf-8');
    let tools;
    try {
      tools = extractFrontmatterTools(content);
    } catch (err) {
      // 解析器 fail-loud（α-W2 的重复 tools: 键）不得把整条 repo:check 链炸掉，
      // 也不得被吞成 pass——就地记 fail，其余 agent 的结论完整保留。
      const message = err instanceof Error ? err.message : String(err);
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'fail',
        evidence: { degraded: true, reason: message },
      });
      errors.push(`${agentFile} frontmatter 解析失败（判不出⇒判失败，不放行）：${message}`);
      continue;
    }

    // 解析器返回 null = 「无 frontmatter / frontmatter 内无 tools 键」。
    // 这是**取不到事实**，不是「工具面为空」——旧实现把二者合并成 `[]`，
    // 于是「读不出」被消费成一个确定的观测值（β-C1）。此处按判不出⇒判失败处置。
    if (tools === null) {
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'fail',
        evidence: { degraded: true, reason: 'frontmatter 缺席或其中没有 tools 键，工具面取不到' },
      });
      errors.push(
        `${agentFile} 的 frontmatter 缺席或没有 tools 键（判不出⇒判失败，不放行）`,
      );
      continue;
    }

    const mcpTools = tools.filter((t) => t.startsWith('mcp__'));

    // CRITICAL：这 5 个 agent 文件必须含 MCP 工具，缺失视为配置错误
    if (mcpTools.length === 0) {
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'fail',
        evidence: { note: '未找到 mcp__ 前缀工具，受保护 agent 必须包含 Spectra MCP 工具' },
      });
      errors.push(`${agentFile} 未找到任何 mcp__ 工具（受保护 agent 必须包含 Spectra MCP 工具）`);
      continue;
    }

    const wrongNamespace = mcpTools.filter((t) => !t.startsWith(expectedNamespace));

    if (wrongNamespace.length > 0) {
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'fail',
        evidence: { expectedNamespace, wrongTools: wrongNamespace },
      });
      errors.push(
        `${agentFile} 含非期望 namespace 工具：${wrongNamespace.join(', ')}（期望前缀：${expectedNamespace}）`,
      );
    } else {
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'pass',
        evidence: { expectedNamespace, mcpTools },
      });
    }
  }

  const hasFail = checks.some((c) => c.status === 'fail');
  return {
    status: hasFail ? 'fail' : 'pass',
    checks,
    warnings,
    errors,
  };
}
