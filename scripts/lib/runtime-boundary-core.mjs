import fs from 'node:fs';
import path from 'node:path';
import { parseYamlDocument } from '../../plugins/spec-driver/scripts/lib/simple-yaml.mjs';

function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

function readGitignoreEntries(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return {
      gitignorePath,
      entries: new Set(),
    };
  }

  const entries = new Set(
    fs.readFileSync(gitignorePath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );

  return {
    gitignorePath,
    entries,
  };
}

export function loadRuntimeBoundaryContract(projectRoot) {
  const contractPath = path.join(projectRoot, 'contracts', 'runtime-boundary-contract.yaml');
  const contract = parseYamlDocument(fs.readFileSync(contractPath, 'utf-8'));
  return { contractPath, contract };
}

function validateIgnoredPaths(projectRoot, directories, gitignoreEntries, errors) {
  const missing = [];

  for (const [directoryId, directory] of Object.entries(directories)) {
    const ignoredPaths = Array.isArray(directory.ignoredPaths) ? directory.ignoredPaths : [];
    for (const ignoredPath of ignoredPaths) {
      if (!gitignoreEntries.entries.has(ignoredPath)) {
        missing.push({ directoryId, path: ignoredPath });
        errors.push(`缺少运行态忽略规则: ${ignoredPath}`);
      }
    }
  }

  return createCheck(
    'ignored-runtime-paths',
    '运行态路径已被 .gitignore 正确隔离',
    missing.length === 0 ? 'pass' : 'fail',
    {
      gitignorePath: path.relative(projectRoot, gitignoreEntries.gitignorePath).split(path.sep).join('/'),
      missing,
    },
  );
}

function validateRequiredFiles(projectRoot, directories, errors) {
  const missing = [];

  for (const [directoryId, directory] of Object.entries(directories)) {
    const requiredFiles = Array.isArray(directory.requiredFiles) ? directory.requiredFiles : [];
    for (const requiredFile of requiredFiles) {
      const absolutePath = path.join(projectRoot, requiredFile);
      if (!fs.existsSync(absolutePath)) {
        missing.push({ directoryId, path: requiredFile });
        errors.push(`缺少受控目录所需文件: ${requiredFile}`);
      }
    }
  }

  return createCheck(
    'required-controlled-files',
    '受控目录所需文件存在',
    missing.length === 0 ? 'pass' : 'fail',
    { missing },
  );
}

function validateAdvisoryAndLegacyPaths(projectRoot, directories, warnings) {
  const advisoryMissing = [];
  const legacyPresent = [];

  for (const [directoryId, directory] of Object.entries(directories)) {
    const advisoryFiles = Array.isArray(directory.advisoryFiles) ? directory.advisoryFiles : [];
    for (const advisoryFile of advisoryFiles) {
      if (!fs.existsSync(path.join(projectRoot, advisoryFile))) {
        advisoryMissing.push({ directoryId, path: advisoryFile });
      }
    }

    const legacyPaths = Array.isArray(directory.legacyPaths) ? directory.legacyPaths : [];
    for (const legacyPath of legacyPaths) {
      if (fs.existsSync(path.join(projectRoot, legacyPath))) {
        legacyPresent.push({ directoryId, path: legacyPath });
        warnings.push(`仍检测到 legacy 路径 ${legacyPath}，建议迁移或删除。`);
      }
    }
  }

  if (advisoryMissing.length > 0) {
    warnings.push(
      `缺少 advisory-only 产物：${advisoryMissing.map((item) => item.path).join(', ')}`,
    );
  }

  return createCheck(
    'advisory-and-legacy-paths',
    '建议产物与 legacy 路径状态可见',
    legacyPresent.length === 0 ? (advisoryMissing.length === 0 ? 'pass' : 'warn') : 'warn',
    {
      advisoryMissing,
      legacyPresent,
    },
  );
}

export function validateRuntimeBoundaries(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const { contractPath, contract } = loadRuntimeBoundaryContract(projectRoot);
  const directories = contract.directories ?? {};
  const errors = [];
  const warnings = [];
  const gitignoreEntries = readGitignoreEntries(projectRoot);

  const checks = [
    validateIgnoredPaths(projectRoot, directories, gitignoreEntries, errors),
    validateRequiredFiles(projectRoot, directories, errors),
    validateAdvisoryAndLegacyPaths(projectRoot, directories, warnings),
  ];

  return {
    schemaVersion: contract.schemaVersion ?? 1,
    status: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    contractPath: path.relative(projectRoot, contractPath).split(path.sep).join('/'),
    checks,
    warnings,
    errors,
  };
}
