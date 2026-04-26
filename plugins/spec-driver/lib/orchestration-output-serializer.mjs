/**
 * orchestration-output-serializer.mjs
 * Feature 133 — orchestration 配置的 YAML 序列化与 diff 格式化辅助模块
 *
 * 导出：
 *   - yamlScalar              将标量值序列化为 YAML 字符串（引号处理）
 *   - serializeYaml           将对象递归序列化为 YAML 字符串
 *   - serializeWithAnnotations 带 source 注释的 YAML 序列化（--annotate 模式）
 *   - formatDiff              仅展示 overrides 改变字段的 diff 输出（--diff 模式）
 */

// ─────────────────────────────────────────────────────────────
// YAML 标量序列化
// ─────────────────────────────────────────────────────────────

/**
 * 将值序列化为简单 YAML 标量（字符串引号处理）
 * @param {*} val
 * @returns {string}
 */
export function yamlScalar(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'number') return String(val);
  const s = String(val);
  // 需要引号的情况：含特殊字符或看起来像数字/布尔
  if (/[\s:{}[\],&*#?|<>=!%@`]/.test(s) || s === '' || /^(true|false|null|\d+)$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────
// 递归 YAML 序列化
// ─────────────────────────────────────────────────────────────

/**
 * 将对象序列化为 YAML 字符串（仅序列化 string/number/boolean/null 标量和数组/对象）
 * @param {*} obj
 * @param {number} indent
 * @returns {string}
 */
export function serializeYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return yamlScalar(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item);
        const firstKey = entries[0]?.[0];
        const rest = entries.slice(1);
        const firstLine = `${pad}- ${firstKey}: ${serializeYaml(entries[0]?.[1], indent + 1)}`;
        const restLines = rest.map(([k, v]) => {
          if (typeof v === 'object' && v !== null) {
            return `${pad}  ${k}:\n${serializeYaml(v, indent + 2)}`;
          }
          return `${pad}  ${k}: ${serializeYaml(v, indent + 1)}`;
        });
        return [firstLine, ...restLines].join('\n');
      }
      return `${pad}- ${serializeYaml(item, indent + 1)}`;
    }).join('\n');
  }
  // 普通对象
  return Object.entries(obj).map(([k, v]) => {
    if (typeof v === 'object' && v !== null) {
      return `${pad}${k}:\n${serializeYaml(v, indent + 1)}`;
    }
    return `${pad}${k}: ${serializeYaml(v, indent + 1)}`;
  }).join('\n');
}

// ─────────────────────────────────────────────────────────────
// 带 source 注释的 YAML 序列化（--annotate 模式）
// ─────────────────────────────────────────────────────────────

/**
 * 带 source 注释的 YAML 序列化（T-016，D-PLAN-5 决策）
 * 注释粒度：Mode 级 + Gate 级 + 全局字段级
 * 不下钻到 phase 数组元素（CL-005 决策）
 *
 * @param {object} config - mergedConfig
 * @param {object} fieldSources - fieldSources 映射
 * @returns {string}
 */
export function serializeWithAnnotations(config, fieldSources) {
  const lines = [];

  lines.push(`version: ${yamlScalar(config.version)}`);
  lines.push('');

  // parallel_scheduling（顶层字段级注释）
  if (config.parallel_scheduling) {
    lines.push('parallel_scheduling:');
    for (const [field, val] of Object.entries(config.parallel_scheduling)) {
      const src = fieldSources[`parallel_scheduling.${field}`] || 'base';
      lines.push(`  ${field}: ${yamlScalar(val)}  # source: ${src}`);
    }
    lines.push('');
  }

  // gates（Gate 级注释）
  if (config.gates) {
    lines.push('gates:');
    for (const [gateId, gateDef] of Object.entries(config.gates)) {
      // 检查该 gate 是否有任何字段被 overrides 覆盖
      const gateFields = Object.keys(gateDef);
      const gateOverriddenFields = gateFields.filter(f => fieldSources[`gates.${gateId}.${f}`] === 'overrides');
      const gateSrc = gateOverriddenFields.length > 0 ? 'overrides' : 'base';
      lines.push(`  ${gateId}:  # source: ${gateSrc}`);
      for (const [field, val] of Object.entries(gateDef)) {
        const fieldSrc = fieldSources[`gates.${gateId}.${field}`] || 'base';
        if (typeof val === 'object' && val !== null) {
          lines.push(`    ${field}:  # source: ${fieldSrc}`);
          if (Array.isArray(val)) {
            for (const item of val) {
              lines.push(`      - ${yamlScalar(item)}`);
            }
          } else {
            for (const [k, v] of Object.entries(val)) {
              lines.push(`      ${k}: ${yamlScalar(v)}`);
            }
          }
        } else {
          lines.push(`    ${field}: ${yamlScalar(val)}  # source: ${fieldSrc}`);
        }
      }
    }
    lines.push('');
  }

  // modes（Mode 级注释；不下钻到 phase 数组元素）
  if (config.modes) {
    lines.push('modes:');
    for (const [modeKey, modeDef] of Object.entries(config.modes)) {
      const modeSrc = fieldSources[`modes.${modeKey}`] || 'base';
      const lockNote = modeSrc === 'overrides' ? ' (locked - will not inherit plugin updates)' : '';
      lines.push(`  ${modeKey}:  # source: ${modeSrc}${lockNote}`);
      if (modeDef && modeDef.phases) {
        lines.push(`    phases:  # ${modeDef.phases.length} phase(s)`);
        for (const phase of modeDef.phases) {
          lines.push(`      - id: ${yamlScalar(phase.id)}`);
          lines.push(`        name: ${yamlScalar(phase.name)}`);
          lines.push(`        display_name: ${yamlScalar(phase.display_name)}`);
          // 简写：仅输出核心字段
          if (phase.agent !== undefined) {
            lines.push(`        agent: ${yamlScalar(Array.isArray(phase.agent) ? JSON.stringify(phase.agent) : phase.agent)}`);
          }
          lines.push(`        agent_mode: ${yamlScalar(phase.agent_mode)}`);
        }
      }
    }
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// diff 格式化（--diff 模式）
// ─────────────────────────────────────────────────────────────

/**
 * --diff 输出：仅展示被 overrides 改变的字段路径（T-017）
 * @param {object} fieldSources
 * @param {object} baseConfig
 * @param {object} mergedConfig
 * @returns {string}
 */
export function formatDiff(fieldSources, baseConfig, mergedConfig) {
  const overriddenFields = Object.entries(fieldSources)
    .filter(([, src]) => src === 'overrides')
    .map(([path]) => path);

  if (overriddenFields.length === 0) {
    return '(no diff: project has no overrides file or no fields were changed)';
  }

  const diffLines = [];

  // 对 overridden fields 按类别分组输出
  const processedModes = new Set();
  const processedGates = new Set();

  for (const fieldPath of overriddenFields) {
    if (fieldPath.startsWith('modes.')) {
      const modeKey = fieldPath.slice('modes.'.length);
      if (!processedModes.has(modeKey)) {
        processedModes.add(modeKey);
        const basePhases = (baseConfig.modes?.[modeKey]?.phases || []).length;
        const mergedPhases = (mergedConfig.modes?.[modeKey]?.phases || []).length;
        diffLines.push(`~ modes.${modeKey}  base phases: ${basePhases} → overrides phases: ${mergedPhases}`);
      }
    } else if (fieldPath.startsWith('gates.')) {
      const parts = fieldPath.split('.');
      // gates.<GATE_ID>.<field>
      if (parts.length === 3) {
        const [, gateId, field] = parts;
        const gateKey = `${gateId}.${field}`;
        if (!processedGates.has(gateKey)) {
          processedGates.add(gateKey);
          const baseVal = baseConfig.gates?.[gateId]?.[field];
          const mergedVal = mergedConfig.gates?.[gateId]?.[field];
          const baseStr = Array.isArray(baseVal) ? JSON.stringify(baseVal) : String(baseVal ?? 'null');
          const mergedStr = Array.isArray(mergedVal) ? JSON.stringify(mergedVal) : String(mergedVal ?? 'null');
          diffLines.push(`~ gates.${gateId}.${field}  base: ${baseStr} → overrides: ${mergedStr}`);
        }
      }
    } else if (fieldPath.startsWith('parallel_scheduling.')) {
      const field = fieldPath.slice('parallel_scheduling.'.length);
      const baseVal = baseConfig.parallel_scheduling?.[field];
      const mergedVal = mergedConfig.parallel_scheduling?.[field];
      diffLines.push(`~ parallel_scheduling.${field}  base: ${baseVal} → overrides: ${mergedVal}`);
    }
  }

  return diffLines.join('\n');
}
