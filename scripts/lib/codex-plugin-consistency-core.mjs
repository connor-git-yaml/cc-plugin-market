import fs from 'node:fs';
import path from 'node:path';
import { parseYamlDocument } from '../../plugins/spec-driver/scripts/lib/simple-yaml.mjs';

// Feature 213（A1）— Codex Plugin 一体分发一致性矩阵。
// 纯只读函数：仅读文件系统与 JSON/YAML，无副作用。接入 repo:check（validateRepository 经
// aggregateValidation）与 release:check（validate-release-contracts.mjs 薄壳扁平合并）双链。
// 契约唯一事实源 contracts/codex-plugin-consistency.yaml。

const CONTRACT_RELATIVE_PATH = 'contracts/codex-plugin-consistency.yaml';

// spectra-skill-neutrality warn check 的四类"硬阻断"标记 pattern。
// 只覆盖会让技能在 Codex 运行时调不动工具的硬绑定；`/spectra` slash 示例与 `$ARGUMENTS`
// 占位符为已知接受项（不入 pattern），详见 research/spectra-skill-neutrality-scan.md。
const NEUTRALITY_HARD_MARKER = /Task tool|mcp__|AskUserQuestion|Task\(/;

function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

// 严格"普通对象"判定：排除 null / 数组 / 标量。用于校验解析产物（JSON manifest / YAML 合同节点）
// 形态，避免 `in` 操作或属性访问在畸形输入上抛 TypeError（破坏 {status,checks,warnings,errors} 输出合约）。
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonSafe(filePath) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// 列出目录下含 SKILL.md 的子目录 id 集合（排序）。目录不存在时返回 null 以区分"缺目录"与"空目录"。
function listSkillIds(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }
  const ids = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (fs.existsSync(path.join(dirPath, entry.name, 'SKILL.md'))) {
      ids.push(entry.name);
    }
  }
  return ids.sort();
}

// 从 wrapper/skill source-of-truth 合同的 entries[].id 派生期望 skill id 集合。
function entryIdsFromContract(contractPath) {
  const doc = parseYamlDocument(fs.readFileSync(contractPath, 'utf-8'));
  const entries = doc?.codexWrappers?.entries ?? doc?.skills?.entries ?? [];
  return entries.map((entry) => entry.id).filter((id) => typeof id === 'string').sort();
}

function sameStringSet(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

// 单个 plugin 的 manifest 存在性 + JSON 合法性 + no-hooks 校验。
// 返回 { manifest | null }，manifest 为 null 表示 manifest-exists 已 fail，调用方跳过依赖 manifest 的后续 check。
function checkManifestBase(pluginId, manifestPath, checks, errors) {
  if (!fs.existsSync(manifestPath)) {
    checks.push(createCheck(`manifest-exists:${pluginId}`, `${pluginId} Codex manifest 存在`, 'fail', { manifestPath }));
    errors.push(`${pluginId} Codex manifest 缺失：${manifestPath}`);
    return { manifest: null };
  }
  const parsed = readJsonSafe(manifestPath);
  if (!parsed.ok) {
    checks.push(createCheck(`manifest-exists:${pluginId}`, `${pluginId} Codex manifest 存在`, 'fail', { manifestPath, jsonError: parsed.error }));
    errors.push(`${pluginId} Codex manifest JSON 非法：${parsed.error}`);
    return { manifest: null };
  }
  // JSON 合法但不是普通对象（如 `null` / 数组 / 标量）→ 视为 manifest 非法，避免后续 `in`/属性访问崩溃
  if (!isPlainObject(parsed.value)) {
    checks.push(createCheck(`manifest-exists:${pluginId}`, `${pluginId} Codex manifest 存在`, 'fail', { manifestPath, reason: 'not-an-object' }));
    errors.push(`${pluginId} Codex manifest 顶层不是对象（实际类型 ${parsed.value === null ? 'null' : Array.isArray(parsed.value) ? 'array' : typeof parsed.value}）`);
    return { manifest: null };
  }
  checks.push(createCheck(`manifest-exists:${pluginId}`, `${pluginId} Codex manifest 存在`, 'pass', { manifestPath }));

  const manifest = parsed.value;
  if ('hooks' in manifest) {
    checks.push(createCheck(`no-hooks-field:${pluginId}`, `${pluginId} manifest 无 hooks 字段`, 'fail', { manifestPath }));
    errors.push(`${pluginId} Codex manifest 不应含 hooks 字段（FR-006）`);
  } else {
    checks.push(createCheck(`no-hooks-field:${pluginId}`, `${pluginId} manifest 无 hooks 字段`, 'pass', {}));
  }
  return { manifest };
}

// skills-reference check：manifest.skills 精确等于期望引用值 + 引用目录存在 + skill id 集合与期望一致。
function checkSkillsReference(pluginId, manifest, projectRoot, config, expectedIds, checks, errors) {
  const checkId = `skills-reference:${pluginId}`;
  const title = `${pluginId} manifest.skills 引用一致`;
  const expectedRef = config.skillsReference;
  if (manifest.skills !== expectedRef) {
    checks.push(createCheck(checkId, title, 'fail', { expected: expectedRef, actual: manifest.skills }));
    errors.push(`${pluginId} manifest.skills 应为 ${expectedRef}，实际为 ${JSON.stringify(manifest.skills)}`);
    return;
  }
  const skillsDir = path.resolve(projectRoot, config.skillsRoot);
  const actualIds = listSkillIds(skillsDir);
  if (actualIds === null) {
    checks.push(createCheck(checkId, title, 'fail', { skillsRoot: config.skillsRoot, reason: 'referenced-directory-missing' }));
    errors.push(`${pluginId} manifest.skills 引用目录不存在：${config.skillsRoot}`);
    return;
  }
  if (!sameStringSet(actualIds, expectedIds)) {
    checks.push(createCheck(checkId, title, 'fail', { skillsRoot: config.skillsRoot, expectedIds, actualIds }));
    errors.push(`${pluginId} manifest.skills 引用目录 skill id 集合与期望不符：期望 [${expectedIds.join(', ')}]，实际 [${actualIds.join(', ')}]`);
    return;
  }
  checks.push(createCheck(checkId, title, 'pass', { skillsRoot: config.skillsRoot, skillIds: actualIds }));
}

export function validateCodexPluginConsistency({ projectRoot }) {
  const resolvedRoot = path.resolve(projectRoot);
  const checks = [];
  const warnings = [];
  const errors = [];

  const contractPath = path.join(resolvedRoot, CONTRACT_RELATIVE_PATH);
  if (!fs.existsSync(contractPath)) {
    return {
      status: 'fail',
      checks: [createCheck('contract-exists', '一致性矩阵合同存在', 'fail', { contractPath })],
      warnings,
      errors: [`一致性矩阵合同缺失：${CONTRACT_RELATIVE_PATH}`],
    };
  }

  // 全程 try/catch：畸形 YAML / JSON / 文件系统异常一律折算为稳定的 fail check，
  // 绝不 throw——保证 {status,checks,warnings,errors} 输出合约与 --json 消费链不被破坏。
  try {
    return runMatrix(resolvedRoot, contractPath, checks, warnings, errors);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(createCheck('matrix-internal-error', '一致性矩阵执行未抛异常', 'fail', { message }));
    errors.push(`一致性矩阵执行异常（畸形输入或内部错误）：${message}`);
    return { status: 'fail', checks, warnings, errors };
  }
}

function runMatrix(resolvedRoot, contractPath, checks, warnings, errors) {
  const contract = parseYamlDocument(fs.readFileSync(contractPath, 'utf-8'));

  // 合同形态显式校验：畸形 YAML 会让 parseYamlDocument 退化为 {} 或非预期结构，
  // 若不显式核查，后续 `contract.manifests.spectra` 会抛 TypeError。
  if (!isPlainObject(contract.manifests)
    || !isPlainObject(contract.manifests.spectra)
    || !isPlainObject(contract.manifests['spec-driver'])
    || !isPlainObject(contract.marketplace)) {
    checks.push(createCheck('contract-shape', '一致性矩阵合同结构完整', 'fail', {
      hasManifests: isPlainObject(contract.manifests),
      hasSpectra: isPlainObject(contract.manifests?.spectra),
      hasSpecDriver: isPlainObject(contract.manifests?.['spec-driver']),
      hasMarketplace: isPlainObject(contract.marketplace),
    }));
    errors.push('一致性矩阵合同结构不完整（缺 manifests.spectra / manifests.spec-driver / marketplace 之一），疑似畸形 YAML');
    return { status: 'fail', checks, warnings, errors };
  }

  // ---- spectra ----
  const spectraCfg = contract.manifests.spectra;
  const spectraManifestPath = path.resolve(resolvedRoot, spectraCfg.codexManifestPath);
  const { manifest: spectraManifest } = checkManifestBase('spectra', spectraManifestPath, checks, errors);

  if (spectraManifest) {
    // mcp-servers-reference:spectra
    const mcpConfigPath = path.resolve(resolvedRoot, spectraCfg.mcpConfigPath);
    const mcpParsed = fs.existsSync(mcpConfigPath) ? readJsonSafe(mcpConfigPath) : { ok: false, error: 'missing' };
    const mcpHasServer = mcpParsed.ok && mcpParsed.value?.mcpServers && spectraCfg.mcpServerName in mcpParsed.value.mcpServers;
    const mcpRefOk = spectraManifest.mcpServers === './.mcp.json' && mcpHasServer;
    checks.push(createCheck('mcp-servers-reference:spectra', 'spectra manifest.mcpServers 引用有效', mcpRefOk ? 'pass' : 'fail', {
      manifestMcpServers: spectraManifest.mcpServers,
      mcpServerName: spectraCfg.mcpServerName,
      mcpHasServer,
    }));
    if (!mcpRefOk) {
      errors.push(`spectra manifest.mcpServers 应为 ./.mcp.json 且 .mcp.json 含 mcpServers.${spectraCfg.mcpServerName} server`);
    }

    // skill-count:spectra + skills-reference:spectra（期望 id 集合来自 skill-source-of-truth entries）
    const expectedSpectraIds = entryIdsFromContract(path.resolve(resolvedRoot, spectraCfg.skillSourceContract));
    const spectraSkillsDir = path.resolve(resolvedRoot, spectraCfg.skillsRoot);
    const spectraActualIds = listSkillIds(spectraSkillsDir) ?? [];
    const countOk = spectraActualIds.length === expectedSpectraIds.length;
    checks.push(createCheck('skill-count:spectra', 'spectra canonical skill 数量与合同一致', countOk ? 'pass' : 'fail', {
      expected: expectedSpectraIds.length,
      actual: spectraActualIds.length,
    }));
    if (!countOk) {
      errors.push(`spectra canonical skill 数量不一致：期望 ${expectedSpectraIds.length}，实际 ${spectraActualIds.length}`);
    }
    checkSkillsReference('spectra', spectraManifest, resolvedRoot, spectraCfg, expectedSpectraIds, checks, errors);

    // spectra-skill-neutrality（warn）
    const offenders = [];
    for (const id of spectraActualIds) {
      const skillPath = path.join(spectraSkillsDir, id, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (NEUTRALITY_HARD_MARKER.test(lines[i])) {
          offenders.push({ skill: id, line: i + 1, text: lines[i].trim() });
        }
      }
    }
    if (offenders.length > 0) {
      checks.push(createCheck('spectra-skill-neutrality', 'spectra SKILL.md 无 Claude 专属硬阻断标记', 'warn', { offenders }));
      warnings.push(`spectra SKILL.md 含疑似 Claude 专属硬阻断标记（${offenders.length} 处），可能破坏 Codex 直接复用路径`);
    } else {
      checks.push(createCheck('spectra-skill-neutrality', 'spectra SKILL.md 无 Claude 专属硬阻断标记', 'pass', {}));
    }
  }

  // ---- spec-driver ----
  const sdCfg = contract.manifests['spec-driver'];
  const sdManifestPath = path.resolve(resolvedRoot, sdCfg.codexManifestPath);
  const { manifest: sdManifest } = checkManifestBase('spec-driver', sdManifestPath, checks, errors);

  const codexEntryIds = entryIdsFromContract(path.resolve(resolvedRoot, sdCfg.wrapperSourceContract));

  if (sdManifest) {
    // skill-count:spec-driver-codex-dir（精确匹配 wrapper entries，不走 waiver）
    const codexDir = path.resolve(resolvedRoot, sdCfg.skillsRoot);
    const codexActualIds = listSkillIds(codexDir) ?? [];
    const codexCountOk = codexActualIds.length === codexEntryIds.length;
    checks.push(createCheck('skill-count:spec-driver-codex-dir', 'spec-driver skills-codex 数量与 wrapper entries 一致', codexCountOk ? 'pass' : 'fail', {
      expected: codexEntryIds.length,
      actual: codexActualIds.length,
    }));
    if (!codexCountOk) {
      errors.push(`spec-driver skills-codex 数量不一致：期望 ${codexEntryIds.length}，实际 ${codexActualIds.length}`);
    }
    checkSkillsReference('spec-driver', sdManifest, resolvedRoot, sdCfg, codexEntryIds, checks, errors);
  }

  // canonical-vs-codex-gap:spec-driver（waiver 折算 + waiver 审计）——独立于 manifest 存在性
  const canonicalDir = path.resolve(resolvedRoot, sdCfg.canonicalSkillsRoot);
  const canonicalIds = listSkillIds(canonicalDir) ?? [];
  const codexSet = new Set(codexEntryIds);
  const gap = canonicalIds.filter((id) => !codexSet.has(id));
  const gapSet = new Set(gap);

  const sdWaivers = (contract.waivers ?? []).filter((w) => isPlainObject(w) && w.scope === 'spec-driver');

  // 审计 1：waiver id 唯一（重复 id 静默过是隐患——两条条目描述漂移无从追踪）
  const seenWaiverIds = new Set();
  for (const w of sdWaivers) {
    if (seenWaiverIds.has(w.id)) {
      warnings.push(`waiver id 重复：${w.id}（请合并/清理契约中的重复条目）`);
    }
    seenWaiverIds.add(w.id);
  }

  // waivedBy：skillId → 首个覆盖它的 waiverId；同时做 missingSkillIds 去重审计 + 陈旧 waiver 审计
  const waivedBy = new Map();
  for (const w of sdWaivers) {
    const seenInWaiver = new Set();
    for (const id of w.missingSkillIds ?? []) {
      if (seenInWaiver.has(id)) {
        warnings.push(`waiver ${w.id} 的 missingSkillIds 含重复项：${id}`);
      }
      seenInWaiver.add(id);
      if (!waivedBy.has(id)) {
        waivedBy.set(id, w.id);
      }
      // 审计 3（A2 收尾核心护栏）：waiver 覆盖的 skill 已不在当前 gap
      // → Codex wrapper 疑似已补齐但 waiver 忘删，报 warning 提示删除陈旧条目
      if (!gapSet.has(id)) {
        warnings.push(`陈旧 waiver：${w.id} 覆盖的 skill "${id}" 已不在 canonical→codex 缺口中（Codex wrapper 可能已补齐，请删除该 waiver 条目）`);
      }
    }
  }

  const uncovered = gap.filter((id) => !waivedBy.has(id));
  // evidence 记 {skillId, waiverId} 对，而非纯 skill id——审计时可回溯每个缺口由哪条 waiver 豁免
  const waived = gap.filter((id) => waivedBy.has(id)).map((id) => ({ skillId: id, waiverId: waivedBy.get(id) }));
  if (uncovered.length > 0) {
    checks.push(createCheck('canonical-vs-codex-gap:spec-driver', 'spec-driver canonical→codex 缺口经 waiver 覆盖', 'fail', { gap, uncovered, waived }));
    errors.push(`spec-driver canonical skill 未被 Codex 适配且无 waiver 覆盖：${uncovered.join(', ')}`);
  } else {
    checks.push(createCheck('canonical-vs-codex-gap:spec-driver', 'spec-driver canonical→codex 缺口经 waiver 覆盖', 'pass', { gap, waived }));
  }

  // ---- marketplace-entries ----
  const marketplaceCfg = contract.marketplace;
  const marketplacePath = path.resolve(resolvedRoot, marketplaceCfg.path);
  if (!fs.existsSync(marketplacePath)) {
    checks.push(createCheck('marketplace-entries', 'Codex marketplace 条目一致', 'fail', { marketplacePath, reason: 'missing' }));
    errors.push(`Codex marketplace catalog 缺失：${marketplaceCfg.path}`);
  } else {
    const parsed = readJsonSafe(marketplacePath);
    if (!parsed.ok) {
      checks.push(createCheck('marketplace-entries', 'Codex marketplace 条目一致', 'fail', { marketplacePath, jsonError: parsed.error }));
      errors.push(`Codex marketplace catalog JSON 非法：${parsed.error}`);
    } else {
      const marketplace = parsed.value;
      const actualPlugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
      const mismatches = [];
      const expected = marketplaceCfg.expectedPlugins ?? [];
      if (actualPlugins.length !== expected.length) {
        mismatches.push(`plugins 条目数期望 ${expected.length}，实际 ${actualPlugins.length}`);
      }
      for (const exp of expected) {
        const found = actualPlugins.find((p) => p.name === exp.name);
        if (!found) {
          mismatches.push(`缺 marketplace 条目：${exp.name}`);
          continue;
        }
        const actualPath = found.source?.path;
        if (actualPath !== exp.sourcePath) {
          mismatches.push(`${exp.name} source.path 期望 ${exp.sourcePath}，实际 ${JSON.stringify(actualPath)}`);
        }
        // 路径下必须真实存在 .codex-plugin/plugin.json
        const pluginManifest = path.resolve(resolvedRoot, exp.sourcePath.replace(/^\.\/+/, ''), '.codex-plugin', 'plugin.json');
        if (!fs.existsSync(pluginManifest)) {
          mismatches.push(`${exp.name} 引用路径缺 .codex-plugin/plugin.json：${exp.sourcePath}`);
        }
      }
      if (mismatches.length > 0) {
        checks.push(createCheck('marketplace-entries', 'Codex marketplace 条目一致', 'fail', { mismatches }));
        errors.push(`Codex marketplace 条目不一致：${mismatches.join('；')}`);
      } else {
        checks.push(createCheck('marketplace-entries', 'Codex marketplace 条目一致', 'pass', { pluginCount: actualPlugins.length }));
      }
    }
  }

  return {
    status: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    checks,
    warnings,
    errors,
  };
}
