import fs from 'node:fs';
import path from 'node:path';

// Feature 238（US-3 收尾 / FR-310）：模型字面量 grep 门禁核心模块。
//
// 只扫描 spec「Grep 门禁定义」列举的固定用户表面清单（非全仓扫描），命中即失败。
// pattern 右边界（negative lookahead）防止 `gpt-50`/`gpt-5x` 一类非目标字面量误报。
//
// 本文件自身不落在扫描面清单内（清单固定为下方 REQUIRED_FILE_TARGETS 等常量，不含
// `scripts/lib/**`），避免 pattern 字面量或注释字符串把自身误判为命中。
//
// Codex implement 审查修复轮 W2（fail-open 修复）：旧实现对"文件不存在"与
// "文件存在但零命中"一视同仁，都判定为 pass——这意味着 `--project-root` 传错
// （指向不存在目录，或仓库缺失必需文件）时，门禁会静默返回 pass，是典型的
// fail-open。修复后按 required/optional 两层分类：
//   - required（5 个固定文件 + skills / skills-codex 两个目录）缺失或读取错误 →
//     status='fail'，errors 明确指出 missing/unreadable 目标。
//   - optional（.codex/skills，未 install 合法缺席）缺失只记 warnings，不 fail。

const MODEL_LITERAL_PATTERN = /gpt-5(\.\d+)?(-[a-z0-9]+)*(?![0-9a-zA-Z])/gi;

/** FR-310 固定扫描清单中的 5 个必需文件（缺失或读取失败即 fail）。 */
const REQUIRED_FILE_TARGETS = [
  'README.md',
  'plugins/spec-driver/README.md',
  'docs/configuration.md',
  'plugins/spec-driver/templates/spec-driver.config-template.yaml',
  'plugins/spec-driver/scripts/codex-skills.sh',
];

/** FR-310 固定扫描清单中的 2 个必需 skill 镜像目录（目录本身缺失即 fail）。 */
const REQUIRED_SKILL_DIR_TARGETS = [
  'plugins/spec-driver/skills',
  'plugins/spec-driver/skills-codex',
];

/**
 * `.codex/skills/` 是 install-time 生成产物，未 install 的仓库检出不含它——
 * 缺失属于合法状态，只记 warning，不计入 required 缺失面。
 */
const OPTIONAL_SKILL_DIR_TARGETS = ['.codex/skills'];

function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

function toRelative(projectRoot, absPath) {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
}

function existsAsFile(absPath) {
  try {
    return fs.existsSync(absPath) && fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

function existsAsDir(absPath) {
  try {
    return fs.existsSync(absPath) && fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/** 递归收集 `dir` 下所有名为 `SKILL.md` 的文件（相对路径，POSIX 分隔符）。 */
function collectSkillMdFiles(projectRoot, relDir) {
  const absDir = path.join(projectRoot, relDir);
  if (!existsAsDir(absDir)) return [];

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

/** 对已读取到的文件内容按行扫描，返回该文件内所有命中（行号从 1 起）。 */
function scanContent(relPath, content) {
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

/** 读取单个文件并扫描；把结果落入调用方传入的累积数组。 */
function readAndScanFile(projectRoot, relPath, { plannedTargets, actuallyReadFiles, missingTargets, readErrors, offenders }) {
  plannedTargets.push(relPath);
  const absPath = path.join(projectRoot, relPath);

  if (!existsAsFile(absPath)) {
    missingTargets.push(relPath);
    return;
  }

  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    actuallyReadFiles.push(relPath);
    offenders.push(...scanContent(relPath, content));
  } catch (err) {
    readErrors.push({ relPath, message: err instanceof Error ? err.message : String(err) });
  }
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

  const plannedTargets = [];
  const actuallyReadFiles = [];
  const missingTargets = [];
  const readErrors = [];
  const offenders = [];

  // CRITICAL 修复核心场景：projectRoot 自身不存在（如 --project-root 传错路径）时，
  // 旧实现对所有必需目标"存在性检查为 false" → 静默跳过 → 零 offenders → status=pass。
  // 这里显式短路为 fail，杜绝路径打错导致的静默假通过。
  if (!existsAsDir(resolvedRoot)) {
    errors.push(`projectRoot 不存在或不是目录：${resolvedRoot}`);
    return {
      status: 'fail',
      checks: [
        createCheck('model-literal-scan', '模型版本字面量门禁（FR-310 固定扫描清单）', 'fail', {
          scannedFiles: 0,
          offenders: [],
          plannedTargets: [],
          actuallyReadFiles: [],
          missingTargets: [],
          readErrors: [],
        }),
      ],
      warnings,
      errors,
    };
  }

  const accumulators = { plannedTargets, actuallyReadFiles, missingTargets, readErrors, offenders };

  // required：5 个固定文件
  for (const relPath of REQUIRED_FILE_TARGETS) {
    readAndScanFile(resolvedRoot, relPath, accumulators);
  }

  // required：2 个 skill 镜像目录（目录必须存在；内部 SKILL.md 数量不定，不作数量要求）
  for (const relDir of REQUIRED_SKILL_DIR_TARGETS) {
    plannedTargets.push(relDir);
    if (!existsAsDir(path.join(resolvedRoot, relDir))) {
      missingTargets.push(relDir);
      continue;
    }
    for (const relPath of collectSkillMdFiles(resolvedRoot, relDir)) {
      readAndScanFile(resolvedRoot, relPath, {
        plannedTargets: [], // 已在上面记录目录本身，避免重复计入 plannedTargets
        actuallyReadFiles,
        missingTargets: [],
        readErrors,
        offenders,
      });
    }
  }

  // optional：.codex/skills（未 install 合法缺席，只记 warning）
  for (const relDir of OPTIONAL_SKILL_DIR_TARGETS) {
    if (!existsAsDir(path.join(resolvedRoot, relDir))) {
      warnings.push(`可选扫描面缺席（未 install，合法）：${relDir}`);
      continue;
    }
    plannedTargets.push(relDir);
    for (const relPath of collectSkillMdFiles(resolvedRoot, relDir)) {
      readAndScanFile(resolvedRoot, relPath, {
        plannedTargets: [],
        actuallyReadFiles,
        missingTargets: [],
        readErrors,
        offenders,
      });
    }
  }

  const hasOffenders = offenders.length > 0;
  const hasMissingRequired = missingTargets.length > 0;
  const hasReadErrors = readErrors.length > 0;
  const status = hasOffenders || hasMissingRequired || hasReadErrors ? 'fail' : 'pass';

  if (hasOffenders) {
    errors.push(
      `发现 ${offenders.length} 处未清理的模型版本字面量：${offenders
        .map((o) => `${o.file}:${o.line}(${o.match})`)
        .join(', ')}`,
    );
  }
  if (hasMissingRequired) {
    errors.push(`必需扫描面缺失：${missingTargets.join(', ')}`);
  }
  if (hasReadErrors) {
    errors.push(
      `必需扫描面读取失败：${readErrors.map((e) => `${e.relPath}(${e.message})`).join(', ')}`,
    );
  }

  const checks = [
    createCheck('model-literal-scan', '模型版本字面量门禁（FR-310 固定扫描清单）', status, {
      // scannedFiles 语义：实际成功读取并扫描的文件数（而非"计划扫描数"），
      // 杜绝旧实现"路径不存在时仍报告 scannedFiles=N"的虚报。
      scannedFiles: actuallyReadFiles.length,
      offenders,
      plannedTargets,
      actuallyReadFiles,
      missingTargets,
      readErrors,
    }),
  ];

  return {
    status,
    checks,
    warnings,
    errors,
  };
}
