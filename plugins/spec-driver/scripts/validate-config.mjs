#!/usr/bin/env node
/**
 * validate-config.mjs -- spec-driver.config.yaml 校验和 effective config 展示的 CLI 入口
 *
 * 用法:
 *   node validate-config.mjs --project-root <path> --validate
 *   node validate-config.mjs --project-root <path> --show-effective [--preset <name>]
 *
 * 退出码:
 *   0 - 校验通过 / effective config 展示成功
 *   1 - Schema 校验失败
 *   2 - YAML 语法错误
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseYamlDocument } from './lib/simple-yaml.mjs';
import { validateConfig, resolveEffectiveConfig } from './lib/config-schema.mjs';

// ────────────────────────────────────────
// 参数解析
// ────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    mode: null, // 'validate' | 'show-effective'
    preset: null,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--project-root':
        args.projectRoot = argv[++i] || process.cwd();
        break;
      case '--validate':
        args.mode = 'validate';
        break;
      case '--show-effective':
        args.mode = 'show-effective';
        break;
      case '--preset':
        args.preset = argv[++i] || null;
        break;
      default:
        break;
    }
  }
  return args;
}

// ────────────────────────────────────────
// 配置文件定位
// ────────────────────────────────────────

function findConfigFile(projectRoot) {
  const primary = path.resolve(projectRoot, 'spec-driver.config.yaml');
  if (existsSync(primary)) return primary;

  const alt = path.resolve(projectRoot, '.specify', 'spec-driver.config.yaml');
  if (existsSync(alt)) return alt;

  return null;
}

// ────────────────────────────────────────
// createCheck 输出格式
// ────────────────────────────────────────

function createCheck(id, label, status, detail) {
  const check = { id, label, status, ...detail };
  return check;
}

function printCheck(check) {
  const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
  console.log(`${icon} [${check.id}] ${check.label}: ${check.status}`);
  if (check.diagnostics) {
    for (const d of check.diagnostics) {
      const prefix = d.level === 'warning' ? '  ⚠️ ' : '  ❌ ';
      console.log(`${prefix}${d.message}`);
    }
  }
}

// ────────────────────────────────────────
// --validate 模式
// ────────────────────────────────────────

function runValidate(projectRoot) {
  const configPath = findConfigFile(projectRoot);

  if (!configPath) {
    // 配置文件不存在，视为合法（全用默认值）
    printCheck(createCheck('config-schema', '配置文件 Schema 校验', 'pass', {
      configPath: '(不存在，使用默认值)',
      fieldCount: 0,
    }));
    process.exit(0);
  }

  // 检查空文件
  const stat = statSync(configPath);
  if (stat.size === 0) {
    printCheck(createCheck('config-schema', '配置文件 Schema 校验', 'fail', {
      configPath: path.relative(projectRoot, configPath),
      errorCount: 1,
      diagnostics: [
        { level: 'error', code: 'config.empty-file', message: '配置文件为空，请参考模板填写' },
      ],
    }));
    process.exit(2);
  }

  // YAML 解析阶段
  let parsed;
  try {
    const content = readFileSync(configPath, 'utf8');
    parsed = parseYamlDocument(content);
  } catch (err) {
    printCheck(createCheck('config-schema', '配置文件 Schema 校验', 'fail', {
      configPath: path.relative(projectRoot, configPath),
      errorCount: 1,
      diagnostics: [
        { level: 'error', code: 'config.yaml-syntax-error', message: `YAML 语法错误: ${err.message}` },
      ],
    }));
    process.exit(2);
  }

  // Schema 校验阶段
  const { success, diagnostics } = validateConfig(parsed);

  const errors = diagnostics.filter((d) => d.level === 'error');
  const warnings = diagnostics.filter((d) => d.level === 'warning');

  if (errors.length > 0) {
    printCheck(createCheck('config-schema', '配置文件 Schema 校验', 'fail', {
      configPath: path.relative(projectRoot, configPath),
      errorCount: errors.length,
      diagnostics: errors,
    }));
    process.exit(1);
  }

  if (warnings.length > 0) {
    printCheck(createCheck('config-schema', '配置文件 Schema 校验', 'warn', {
      configPath: path.relative(projectRoot, configPath),
      warningCount: warnings.length,
      diagnostics: warnings,
    }));
    process.exit(0);
  }

  printCheck(createCheck('config-schema', '配置文件 Schema 校验', 'pass', {
    configPath: path.relative(projectRoot, configPath),
    fieldCount: (parsed && typeof parsed === 'object') ? Object.keys(parsed).length : 0,
  }));
  process.exit(0);
}

// ────────────────────────────────────────
// --show-effective 模式
// ────────────────────────────────────────

function padRight(str, len) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, len - s.length));
}

function runShowEffective(projectRoot, presetOverride) {
  const configPath = findConfigFile(projectRoot);
  let configYaml = {};

  if (configPath) {
    try {
      const content = readFileSync(configPath, 'utf8');
      configYaml = parseYamlDocument(content);
    } catch {
      // 解析失败时用空对象
      configYaml = {};
    }
  }

  const entries = resolveEffectiveConfig({
    configYaml,
    presetOverride: presetOverride || undefined,
  });

  // 计算列宽
  const colKey = Math.max(6, ...entries.map((e) => e.key.length)) + 2;
  const colVal = Math.max(6, ...entries.map((e) => String(e.value).length)) + 2;
  const colSrc = Math.max(4, ...entries.map((e) => e.source.length)) + 2;

  // 输出 ASCII 表格
  console.log('');
  console.log('[Effective Config]');
  const sep = `+-${'-'.repeat(colKey)}-+-${'-'.repeat(colVal)}-+-${'-'.repeat(colSrc)}-+`;
  console.log(sep);
  console.log(`| ${padRight('配置项', colKey)} | ${padRight('生效值', colVal)} | ${padRight('来源', colSrc)} |`);
  console.log(sep);
  for (const entry of entries) {
    const val = Array.isArray(entry.value) ? JSON.stringify(entry.value) : String(entry.value);
    console.log(`| ${padRight(entry.key, colKey)} | ${padRight(val, colVal)} | ${padRight(entry.source, colSrc)} |`);
  }
  console.log(sep);
  console.log('');
}

// ────────────────────────────────────────
// 主入口
// ────────────────────────────────────────

const args = parseArgs(process.argv);

if (args.mode === 'validate') {
  runValidate(args.projectRoot);
} else if (args.mode === 'show-effective') {
  runShowEffective(args.projectRoot, args.preset);
} else {
  console.error('用法: node validate-config.mjs --project-root <path> --validate|--show-effective [--preset <name>]');
  process.exit(1);
}
