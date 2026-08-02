import fs from 'node:fs';
import path from 'node:path';

// Feature 238（US-3 收尾 / FR-310）：模型字面量 grep 门禁核心模块。
//
// 只扫描 spec「Grep 门禁定义」列举的固定用户表面清单（非全仓扫描），命中即失败。
// pattern 右边界（negative lookahead）防止 `gpt-50`/`gpt-5x` 一类非目标字面量误报。
//
// 本文件自身不落在扫描面清单内（清单固定为下方 FIXED_SCAN_TARGETS，不含
// `scripts/lib/**`），避免 pattern 字面量或注释字符串把自身误判为命中。

const MODEL_LITERAL_PATTERN = /gpt-5(\.\d+)?(-[a-z0-9]+)*(?![0-9a-zA-Z])/gi;

/**
 * FR-310 固定扫描清单。`glob: '**\/SKILL.md'` 的条目表示对 `dir` 做递归遍历，
 * 只收 `SKILL.md` 文件；单文件条目直接用 `file` 相对路径。
 * 清单中任何路径在当前工作树不存在时静默跳过（不视为 warning/error）——
 * 例如 `.codex/skills/` 是 install-time 生成产物，未 install 的仓库检出不含它。
 */
const FIXED_SCAN_TARGETS = [
  { kind: 'file', relPath: 'README.md' },
  { kind: 'file', relPath: 'plugins/spec-driver/README.md' },
  { kind: 'file', relPath: 'docs/configuration.md' },
  { kind: 'file', relPath: 'plugins/spec-driver/templates/spec-driver.config-template.yaml' },
  { kind: 'glob-skill-md', relDir: 'plugins/spec-driver/skills' },
  { kind: 'glob-skill-md', relDir: 'plugins/spec-driver/skills-codex' },
  { kind: 'glob-skill-md', relDir: '.codex/skills' },
  { kind: 'file', relPath: 'plugins/spec-driver/scripts/codex-skills.sh' },
];

function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

function toRelative(projectRoot, absPath) {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
}

/** 递归收集 `dir` 下所有名为 `SKILL.md` 的文件（相对路径，POSIX 分隔符）。 */
function collectSkillMdFiles(projectRoot, relDir) {
  const absDir = path.join(projectRoot, relDir);
  if (!fs.existsSync(absDir)) return [];

  const results = [];
  const stack = [absDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(toRelative(projectRoot, entryPath));
      }
    }
  }
  return results.sort();
}

/** 展开固定清单为具体的相对文件路径列表（不存在的文件在下一步读取时被静默跳过）。 */
function resolveScanFiles(projectRoot) {
  const files = [];
  for (const target of FIXED_SCAN_TARGETS) {
    if (target.kind === 'file') {
      files.push(target.relPath);
    } else if (target.kind === 'glob-skill-md') {
      files.push(...collectSkillMdFiles(projectRoot, target.relDir));
    }
  }
  return files;
}

/** 扫描单个文件，返回该文件内所有命中（行号从 1 起）。 */
function scanFile(projectRoot, relPath) {
  const absPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return [];
  }

  const content = fs.readFileSync(absPath, 'utf-8');
  const lines = content.split('\n');
  const offenders = [];

  lines.forEach((line, index) => {
    MODEL_LITERAL_PATTERN.lastIndex = 0;
    const match = MODEL_LITERAL_PATTERN.exec(line);
    if (match) {
      offenders.push({
        file: relPath,
        line: index + 1,
        match: match[0],
      });
    }
  });

  return offenders;
}

/**
 * 对 FR-310 固定扫描清单跑模型字面量门禁。
 *
 * @param {{ projectRoot: string }} options
 * @returns {{ status: 'pass'|'fail', checks: Array<object>, warnings: string[], errors: string[] }}
 */
export function validateModelLiteralGate({ projectRoot }) {
  const resolvedRoot = path.resolve(projectRoot);
  const warnings = [];
  const errors = [];

  const scanFiles = resolveScanFiles(resolvedRoot);
  const offenders = scanFiles.flatMap((relPath) => scanFile(resolvedRoot, relPath));

  const status = offenders.length > 0 ? 'fail' : 'pass';
  if (status === 'fail') {
    errors.push(
      `发现 ${offenders.length} 处未清理的模型版本字面量：${offenders
        .map((o) => `${o.file}:${o.line}(${o.match})`)
        .join(', ')}`,
    );
  }

  const checks = [
    createCheck('model-literal-scan', '模型版本字面量门禁（FR-310 固定扫描清单）', status, {
      scannedFiles: scanFiles.length,
      offenders,
    }),
  ];

  return {
    status,
    checks,
    warnings,
    errors,
  };
}
