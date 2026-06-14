import fs from 'node:fs';
import path from 'node:path';
import { parseYamlDocument } from './simple-yaml.mjs';
import {
  ALLOWED_TOP_LEVEL_FIELDS,
  EXCLUDED_EXECUTION_FIELDS,
  referenceEntrySchema,
  resolvedProjectProfileSchema,
  zodAvailable,
} from './project-profile-schema.mjs';

function createDiagnostic(level, code, message) {
  return { level, code, message };
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== null && entry !== undefined);
  }
  if (value === null || value === undefined || value === '') {
    return [];
  }
  return [value];
}

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value) {
  return ensureArray(value)
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function isUrlLike(value) {
  return /^https?:\/\//i.test(value);
}

function normalizeReferenceEntry(entry, source, projectRoot, diagnostics) {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) {
      return null;
    }
    if (isUrlLike(trimmed)) {
      return { label: trimmed, url: trimmed, required: false, source };
    }
    const resolvedPath = path.resolve(projectRoot, trimmed);
    const exists = fs.existsSync(resolvedPath);
    if (!exists) {
      diagnostics.push(
        createDiagnostic('warning', 'project-context.missing-reference', `[参考路径缺失] ${trimmed}`),
      );
    }
    return {
      label: path.basename(trimmed),
      path: trimmed,
      resolvedPath,
      exists,
      required: false,
      source,
    };
  }

  if (!entry || typeof entry !== 'object') {
    diagnostics.push(
      createDiagnostic('warning', 'project-context.invalid-reference', '存在无法识别的 reference 条目，已忽略'),
    );
    return null;
  }

  let normalized;
  if (zodAvailable) {
    // zod 在场：保持原有 schema 校验逻辑逐字节不变
    const parsed = referenceEntrySchema.safeParse(entry);
    if (!parsed.success) {
      diagnostics.push(
        createDiagnostic(
          'warning',
          'project-context.invalid-reference',
          `reference 条目无效：${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
        ),
      );
      return null;
    }
    normalized = { ...parsed.data, source };
  } else {
    // 缺 zod 降级：手写构造已知字段。必须复现 referenceEntrySchema 的 .trim() 语义，
    // 否则 `path: " docs/a.md "` 在降级路径会带空格、与正常路径 shape 分叉（W1）。
    // 不浅拷贝 entry（会绕过 trim），逐字段 trim；空串视为缺省（不带入）。
    // 这 4 个字段在 zod schema 里均为 z.string()，非字符串值（如 simple-yaml 把
    // `path: 123` 强转成 number）本就应被拒绝；故仅接受 string 且 trim 后非空，
    // 不再原样带入非字符串值（否则后续 path.resolve 会因 number 抛 ERR_INVALID_ARG_TYPE）。
    normalized = { source };
    for (const key of ['label', 'path', 'url', 'purpose']) {
      const raw = entry[key];
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed) normalized[key] = trimmed;
      }
    }
    if (typeof entry.required === 'boolean') {
      normalized.required = entry.required;
    }
    // 有效性判定基于 trim 后的 path/url（与 referenceEntrySchema.refine 等价）
    if (!normalized.path && !normalized.url) {
      diagnostics.push(
        createDiagnostic(
          'warning',
          'project-context.invalid-reference',
          'reference 条目无效：reference entry requires either path or url',
        ),
      );
      return null;
    }
  }
  if (normalized.path) {
    normalized.resolvedPath = path.resolve(projectRoot, normalized.path);
    normalized.exists = fs.existsSync(normalized.resolvedPath);
    if (!normalized.exists) {
      diagnostics.push(
        createDiagnostic('warning', 'project-context.missing-reference', `[参考路径缺失] ${normalized.path}`),
      );
    }
  }
  return normalized;
}

function normalizeOwner(value) {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { name } : null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const name = toTrimmedString(value.name);
  const team = toTrimmedString(value.team);
  const email = toTrimmedString(value.email);
  if (!name && !team && !email) {
    return null;
  }
  return {
    ...(name ? { name } : {}),
    ...(team ? { team } : {}),
    ...(email ? { email } : {}),
  };
}

function normalizeProduct(value) {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { name } : null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const name = toTrimmedString(value.name);
  const summary = toTrimmedString(value.summary || value.description);
  if (!name && !summary) {
    return null;
  }
  return {
    ...(name ? { name } : {}),
    ...(summary ? { summary } : {}),
  };
}

function normalizeVerificationPolicy(value) {
  if (typeof value === 'string') {
    return {
      requireRealExecution: true,
      requiredCommands: [],
      notes: [value.trim()].filter(Boolean),
    };
  }
  const objectValue = value && typeof value === 'object' ? value : {};
  const requiredCommands = normalizeStringList(
    objectValue.required_commands ?? objectValue.requiredCommands ?? objectValue.commands,
  );
  const notes = normalizeStringList(objectValue.notes);
  const requireRealExecution =
    typeof objectValue.require_real_execution === 'boolean'
      ? objectValue.require_real_execution
      : typeof objectValue.requireRealExecution === 'boolean'
        ? objectValue.requireRealExecution
        : true;
  return {
    requireRealExecution,
    requiredCommands,
    notes,
  };
}

function normalizeResearchPolicy(value, diagnostics, source) {
  if (typeof value === 'string') {
    const onlineRequired = /perplexity|sonar-pro-search|在线调研|在线搜索/i.test(value);
    return {
      onlineRequired,
      minPoints: 0,
      maxPoints: 5,
      preferredTools: onlineRequired ? ['perplexity'] : [],
      notes: [value.trim()].filter(Boolean),
    };
  }

  const objectValue = value && typeof value === 'object' ? value : {};
  const onlineRequired =
    typeof objectValue.online_required === 'boolean'
      ? objectValue.online_required
      : typeof objectValue.onlineRequired === 'boolean'
        ? objectValue.onlineRequired
        : false;
  const minPoints =
    typeof objectValue.min_points === 'number'
      ? objectValue.min_points
      : typeof objectValue.minPoints === 'number'
        ? objectValue.minPoints
        : 0;
  const maxPoints =
    typeof objectValue.max_points === 'number'
      ? objectValue.max_points
      : typeof objectValue.maxPoints === 'number'
        ? objectValue.maxPoints
        : 5;
  const preferredTools = normalizeStringList(
    objectValue.preferred_tools ?? objectValue.preferredTools,
  );
  const notes = normalizeStringList(objectValue.notes);

  if (minPoints > maxPoints) {
    diagnostics.push(
      createDiagnostic(
        'warning',
        'project-context.invalid-research-policy',
        `${source} 中 research_policy.min_points 大于 max_points，已按 ${minPoints}=${maxPoints} 修正`,
      ),
    );
  }

  return {
    onlineRequired,
    minPoints: Math.max(0, Math.min(minPoints, maxPoints)),
    maxPoints: Math.max(0, maxPoints),
    preferredTools,
    notes,
  };
}

function normalizeWorkflowPreferences(value) {
  if (typeof value === 'string') {
    const defaultMode = value.trim();
    return {
      defaultMode: defaultMode || null,
      preferredPreset: null,
      notes: [],
    };
  }
  const objectValue = value && typeof value === 'object' ? value : {};
  const defaultMode = toTrimmedString(objectValue.default_mode ?? objectValue.defaultMode) || null;
  const preferredPreset =
    toTrimmedString(objectValue.preferred_preset ?? objectValue.preferredPreset) || null;
  const notes = normalizeStringList(objectValue.notes);
  return {
    defaultMode,
    preferredPreset,
    notes,
  };
}

function buildProjectContextBlock(profile) {
  const lines = [];

  if (profile.product?.name || profile.product?.summary) {
    lines.push(`产品: ${profile.product.name ?? '未命名'}`);
    if (profile.product.summary) {
      lines.push(`产品摘要: ${profile.product.summary}`);
    }
  }

  if (profile.owner?.name || profile.owner?.team || profile.owner?.email) {
    lines.push(
      `Owner: ${[profile.owner.name, profile.owner.team, profile.owner.email].filter(Boolean).join(' / ')}`,
    );
  }

  const existingReferences = profile.references.filter((entry) => entry.exists !== false || entry.url);
  if (existingReferences.length > 0) {
    lines.push('参考资料:');
    for (const reference of existingReferences) {
      const target = reference.url ?? reference.path;
      const label = reference.label ?? target;
      lines.push(`- ${label}: ${target}`);
    }
  }

  if (profile.architectureConstraints.length > 0) {
    lines.push('架构约束:');
    for (const constraint of profile.architectureConstraints) {
      lines.push(`- ${constraint}`);
    }
  }

  if (
    profile.verificationPolicy.requiredCommands.length > 0 ||
    profile.verificationPolicy.notes.length > 0 ||
    profile.verificationPolicy.requireRealExecution === false
  ) {
    lines.push('验证偏好:');
    lines.push(`- require_real_execution: ${profile.verificationPolicy.requireRealExecution}`);
    for (const command of profile.verificationPolicy.requiredCommands) {
      lines.push(`- required_command: ${command}`);
    }
    for (const note of profile.verificationPolicy.notes) {
      lines.push(`- note: ${note}`);
    }
  }

  if (
    profile.researchPolicy.onlineRequired ||
    profile.researchPolicy.preferredTools.length > 0 ||
    profile.researchPolicy.notes.length > 0
  ) {
    lines.push('在线调研偏好:');
    lines.push(`- online_required: ${profile.researchPolicy.onlineRequired}`);
    lines.push(`- min_points: ${profile.researchPolicy.minPoints}`);
    lines.push(`- max_points: ${profile.researchPolicy.maxPoints}`);
    for (const tool of profile.researchPolicy.preferredTools) {
      lines.push(`- preferred_tool: ${tool}`);
    }
    for (const note of profile.researchPolicy.notes) {
      lines.push(`- note: ${note}`);
    }
  }

  if (profile.workflowPreferences.defaultMode || profile.workflowPreferences.preferredPreset) {
    lines.push('Workflow 偏好:');
    if (profile.workflowPreferences.defaultMode) {
      lines.push(`- default_mode: ${profile.workflowPreferences.defaultMode}`);
    }
    if (profile.workflowPreferences.preferredPreset) {
      lines.push(`- preferred_preset: ${profile.workflowPreferences.preferredPreset}`);
    }
    for (const note of profile.workflowPreferences.notes) {
      lines.push(`- note: ${note}`);
    }
  }

  if (profile.forbiddenChanges.length > 0) {
    lines.push('禁止变更:');
    for (const item of profile.forbiddenChanges) {
      lines.push(`- ${item}`);
    }
  }

  if (profile.notes.length > 0) {
    lines.push('补充说明:');
    for (const note of profile.notes) {
      lines.push(`- ${note}`);
    }
  }

  if (lines.length === 0) {
    return '未配置';
  }

  return lines.join('\n');
}

function parseMarkdownSections(content) {
  const sections = new Map();
  let currentTitle = 'root';
  let buffer = [];

  const flush = () => {
    sections.set(currentTitle, buffer.join('\n').trim());
    buffer = [];
  };

  for (const line of content.split('\n')) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)\s*$/);
    if (headingMatch) {
      flush();
      currentTitle = headingMatch[1].trim().toLowerCase();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

function extractMarkdownLinks(content) {
  return Array.from(content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)).map((match) => ({
    label: match[1]?.trim(),
    target: match[2]?.trim(),
  }));
}

function extractBacktickCommands(content) {
  return Array.from(content.matchAll(/`([^`]+)`/g))
    .map((match) => match[1]?.trim())
    .filter(Boolean);
}

function dedupeReferenceEntries(entries) {
  const seen = new Set();
  const deduped = [];

  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    const key = `${entry.label ?? ''}|${entry.path ?? ''}|${entry.url ?? ''}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function normalizeLegacyMarkdown(content, projectRoot, diagnostics) {
  const sections = parseMarkdownSections(content);
  const referencesSection =
    sections.get('references') ??
    sections.get('参考资料') ??
    sections.get('references / links') ??
    '';
  const verificationSection = sections.get('verification policy') ?? sections.get('验证策略') ?? '';
  const researchSection = sections.get('research policy') ?? sections.get('调研策略') ?? '';
  const workflowSection = sections.get('workflow preferences') ?? sections.get('workflow 偏好') ?? '';
  const architectureSection =
    sections.get('architecture constraints') ?? sections.get('架构约束') ?? '';
  const forbiddenSection = sections.get('forbidden changes') ?? sections.get('禁区') ?? '';
  const notesSection = sections.get('notes') ?? sections.get('备注') ?? '';
  const productSection = sections.get('product') ?? sections.get('产品') ?? '';
  const ownerSection = sections.get('owner') ?? sections.get('负责人') ?? '';

  const references = dedupeReferenceEntries(
    [...extractMarkdownLinks(referencesSection), ...extractMarkdownLinks(content)]
      .map(({ label, target }) =>
        normalizeReferenceEntry(
          { label, ...(isUrlLike(target) ? { url: target } : { path: target }) },
          'markdown',
          projectRoot,
          diagnostics,
        ),
      )
      .filter(Boolean),
  );

  const onlineRequired = /perplexity|sonar-pro-search|在线调研|在线搜索/i.test(researchSection + '\n' + content);
  const minPointsMatch = (researchSection + '\n' + content).match(/min[_ -]?points?\s*[:：]\s*(\d+)/i);
  const maxPointsMatch = (researchSection + '\n' + content).match(/max[_ -]?points?\s*[:：]\s*(\d+)/i);
  const defaultModeMatch = workflowSection.match(/default[_ -]?mode\s*[:：]\s*([A-Za-z-]+)/i);
  const preferredPresetMatch = workflowSection.match(/preferred[_ -]?preset\s*[:：]\s*([A-Za-z-]+)/i);

  return {
    product: normalizeProduct(productSection.split('\n')[0] ?? ''),
    owner: normalizeOwner(ownerSection.split('\n')[0] ?? ''),
    references,
    architectureConstraints: normalizeStringList(
      architectureSection
        .split('\n')
        .map((line) => line.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean),
    ),
    verificationPolicy: {
      requireRealExecution: true,
      requiredCommands: extractBacktickCommands(verificationSection),
      notes: normalizeStringList(
        verificationSection
          .split('\n')
          .map((line) => line.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean),
      ),
    },
    researchPolicy: {
      onlineRequired,
      minPoints: minPointsMatch ? Number(minPointsMatch[1]) : 0,
      maxPoints: maxPointsMatch ? Number(maxPointsMatch[1]) : 5,
      preferredTools: onlineRequired ? ['perplexity'] : [],
      notes: normalizeStringList(
        researchSection
          .split('\n')
          .map((line) => line.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean),
      ),
    },
    workflowPreferences: {
      defaultMode: defaultModeMatch?.[1] ?? null,
      preferredPreset: preferredPresetMatch?.[1] ?? null,
      notes: normalizeStringList(
        workflowSection
          .split('\n')
          .map((line) => line.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean),
      ),
    },
    forbiddenChanges: normalizeStringList(
      forbiddenSection
        .split('\n')
        .map((line) => line.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean),
    ),
    notes: normalizeStringList(
      notesSection
        .split('\n')
        .map((line) => line.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean),
    ),
  };
}

function normalizeYamlInput(raw, projectRoot, diagnostics) {
  const topLevelKeys = raw && typeof raw === 'object' ? Object.keys(raw) : [];
  for (const key of topLevelKeys) {
    if (EXCLUDED_EXECUTION_FIELDS.has(key)) {
      diagnostics.push(
        createDiagnostic(
          'warning',
          'project-context.excluded-field',
          `字段 '${key}' 属于 Spec 级执行语义，已从 Project Context 中忽略`,
        ),
      );
      continue;
    }
    if (!ALLOWED_TOP_LEVEL_FIELDS.has(key)) {
      diagnostics.push(
        createDiagnostic(
          'warning',
          'project-context.unknown-field',
          `字段 '${key}' 不在推荐 schema 中，已忽略`,
        ),
      );
    }
  }

  return {
    product: normalizeProduct(raw.product),
    owner: normalizeOwner(raw.owner),
    references: ensureArray(raw.references)
      .map((entry) => normalizeReferenceEntry(entry, 'yaml', projectRoot, diagnostics))
      .filter(Boolean),
    architectureConstraints: normalizeStringList(raw.architecture_constraints),
    verificationPolicy: normalizeVerificationPolicy(raw.verification_policy),
    researchPolicy: normalizeResearchPolicy(raw.research_policy, diagnostics, 'project-context.yaml'),
    workflowPreferences: normalizeWorkflowPreferences(raw.workflow_preferences),
    forbiddenChanges: normalizeStringList(raw.forbidden_changes),
    notes: normalizeStringList(raw.notes),
  };
}

export function resolveProjectContext({ projectRoot }) {
  const specifyDir = path.join(projectRoot, '.specify');
  const yamlPath = path.join(specifyDir, 'project-context.yaml');
  const markdownPath = path.join(specifyDir, 'project-context.md');
  const diagnostics = [];
  // 缺 zod 降级：仅在入口 push 一条 warning（避免 reference 多条目时重复）
  if (!zodAvailable) {
    diagnostics.push(
      createDiagnostic(
        'warning',
        'project-context.zod-unavailable',
        '未能加载 zod，已跳过 project-context schema 校验并使用手写归一化结果；如需完整校验请在已安装依赖的目录运行（npm i）或从仓内源路径运行 spec-driver 脚本',
      ),
    );
  }
  const sourceLayers = [
    'user-input',
    'skill-contract',
    'agents-or-claude',
    'project-context-defaults',
  ];

  const yamlExists = fs.existsSync(yamlPath);
  const markdownExists = fs.existsSync(markdownPath);

  let usedSource = 'none';
  let usedPath = null;
  let normalized = {
    product: null,
    owner: null,
    references: [],
    architectureConstraints: [],
    verificationPolicy: {
      requireRealExecution: true,
      requiredCommands: [],
      notes: [],
    },
    researchPolicy: {
      onlineRequired: false,
      minPoints: 0,
      maxPoints: 5,
      preferredTools: [],
      notes: [],
    },
    workflowPreferences: {
      defaultMode: null,
      preferredPreset: null,
      notes: [],
    },
    forbiddenChanges: [],
    notes: [],
  };

  if (yamlExists && markdownExists) {
    diagnostics.push(
      createDiagnostic(
        'warning',
        'project-context.legacy-md-shadowed',
        '检测到 `.specify/project-context.yaml` 与 `.specify/project-context.md` 并存；已只读取 YAML，Markdown 仅作为 legacy 输入存在',
      ),
    );
  }

  if (yamlExists) {
    usedSource = 'yaml';
    usedPath = yamlPath;
    normalized = normalizeYamlInput(
      parseYamlDocument(fs.readFileSync(yamlPath, 'utf-8')),
      projectRoot,
      diagnostics,
    );
  } else if (markdownExists) {
    usedSource = 'markdown-legacy';
    usedPath = markdownPath;
    diagnostics.push(
      createDiagnostic(
        'warning',
        'project-context.legacy-md',
        '当前使用 `.specify/project-context.md` 作为 legacy 输入；建议迁移到 `.specify/project-context.yaml`',
      ),
    );
    normalized = normalizeLegacyMarkdown(
      fs.readFileSync(markdownPath, 'utf-8'),
      projectRoot,
      diagnostics,
    );
  } else {
    diagnostics.push(
      createDiagnostic(
        'info',
        'project-context.missing',
        '未找到 `.specify/project-context.yaml` 或 `.specify/project-context.md`，将使用默认空上下文',
      ),
    );
  }

  if (zodAvailable) {
    // zod 在场：保持原有 safeParse + schema-fallback 兜底逻辑逐字节不变
    const parsedProfile = resolvedProjectProfileSchema.safeParse(normalized);
    if (!parsedProfile.success) {
      diagnostics.push(
        createDiagnostic(
          'warning',
          'project-context.schema-fallback',
          `project-context 解析结果存在结构问题，已回退到安全默认值：${parsedProfile.error.issues
            .map((issue) => issue.message)
            .join('; ')}`,
        ),
      );
      normalized = resolvedProjectProfileSchema.parse({
        product: null,
        owner: null,
        references: [],
        architectureConstraints: [],
        verificationPolicy: {
          requireRealExecution: true,
          requiredCommands: [],
          notes: [],
        },
        researchPolicy: {
          onlineRequired: false,
          minPoints: 0,
          maxPoints: 5,
          preferredTools: [],
          notes: [],
        },
        workflowPreferences: {
          defaultMode: null,
          preferredPreset: null,
          notes: [],
        },
        forbiddenChanges: [],
        notes: [],
      });
    } else {
      normalized = parsedProfile.data;
    }
  }
  // 缺 zod 降级：跳过 safeParse（normalized 由手写 normalizeYamlInput / normalizeLegacyMarkdown
  // 构建，结构可信），直接沿用 normalized —— 等价于 zod 在场时 parse 成功分支的效果。

  const existingReferences = normalized.references.filter((entry) => entry.exists !== false || entry.url);
  const missingReferences = normalized.references.filter((entry) => entry.exists === false);
  const projectContextBlock =
    usedSource === 'none' ? '未配置' : buildProjectContextBlock(normalized);

  return {
    schemaVersion: 1,
    projectRoot,
    source: {
      canonicalPath: path.relative(projectRoot, yamlPath),
      legacyPath: path.relative(projectRoot, markdownPath),
      yamlExists,
      markdownExists,
      usedSource,
      usedPath: usedPath ? path.relative(projectRoot, usedPath) : null,
      canonicalSource: 'yaml',
    },
    sourceLayers,
    resolvedProfile: normalized,
    fieldSources: {
      product: usedSource === 'none' ? 'defaults' : usedSource,
      owner: usedSource === 'none' ? 'defaults' : usedSource,
      references: usedSource === 'none' ? 'defaults' : usedSource,
      architectureConstraints: usedSource === 'none' ? 'defaults' : usedSource,
      verificationPolicy: usedSource === 'none' ? 'defaults' : usedSource,
      researchPolicy: usedSource === 'none' ? 'defaults' : usedSource,
      workflowPreferences: usedSource === 'none' ? 'defaults' : usedSource,
      forbiddenChanges: usedSource === 'none' ? 'defaults' : usedSource,
      notes: usedSource === 'none' ? 'defaults' : usedSource,
    },
    projectContextBlock,
    referenceSummary: {
      existing: existingReferences.map((entry) => ({
        label: entry.label ?? entry.path ?? entry.url,
        path: entry.path ?? null,
        url: entry.url ?? null,
      })),
      missing: missingReferences.map((entry) => ({
        label: entry.label ?? entry.path,
        path: entry.path ?? null,
      })),
    },
    onlineResearch: {
      required: normalized.researchPolicy.onlineRequired,
      minPoints: normalized.researchPolicy.minPoints,
      maxPoints: normalized.researchPolicy.maxPoints,
      preferredTools: normalized.researchPolicy.preferredTools,
      source: usedSource === 'none' ? 'defaults' : usedSource,
    },
    diagnostics,
  };
}
