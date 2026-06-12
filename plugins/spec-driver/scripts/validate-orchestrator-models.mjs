#!/usr/bin/env node
/**
 * validate-orchestrator-models — 断言 5 个主编排器 SKILL 的双层 frontmatter `model: opus`。
 *
 * 显式 allowlist（不要用"任何含 Task 的 SKILL"）：fix/story/feature/implement/resume。
 * sync/doc 也委派子代理但设计上保持 sonnet（轻编排器），全量断言会误伤。
 *
 * 校验双层：
 *   - plugins/spec-driver/skills/spec-driver-<m>/SKILL.md
 *   - .codex/skills/spec-driver-<m>/SKILL.md
 * 任一层 model ≠ opus → status fail + error 明示哪个文件哪层。
 *
 * 背景：F176 实测 sonnet 编排器无视委派硬约束；6281a27 sonnet→opus 漂移多时无人发现的根因
 * 是 frontmatter model 不在任何 contract/check 管辖——本断言机制化守护。
 *
 * 退出码：0 = 全 opus；1 = 检测到非 opus。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');

/** 显式 allowlist：仅这 5 个主编排器要求 opus。 */
const ORCHESTRATOR_MODES = ['fix', 'story', 'feature', 'implement', 'resume'];

/**
 * 已记录的豁免：在 allowed-tools 声明了 Task（具备委派能力）但**不**纳入 F185 opus 硬断言的 mode。
 * key = mode，value = 豁免理由（fail-loud 时回显，杜绝"无说明的漏网"，对应 codex Warning-3）。
 * - refactor：已是 opus 且委派 batch implement，但 F185 硬约束块注入范围限定 5 个核心模式；
 *   refactor 委派契约纳入视后续 milestone（当前已 opus，无 model 漂移风险）。
 * 注：sync / doc 的 allowed-tools **不含 Task**（无委派能力），天然不进入此覆盖断言。
 */
const DOCUMENTED_EXCEPTIONS = {
  refactor: 'F185 硬约束范围限定 5 核心模式；refactor 已 opus，委派契约纳入视后续',
};

/**
 * 动态枚举全部 SKILL 目录 mode（去 spec-driver- 前缀）。
 * 不用硬编码列表（codex Warning：新增 skill 目录若漏更新列表，coverage 守护对其失效）。
 */
function listAllModes(root) {
  const skillsDir = path.join(root, 'plugins/spec-driver/skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('spec-driver-'))
    .map((d) => d.name.slice('spec-driver-'.length));
}

/** 判断某 mode 的 plugins 层 SKILL 是否在 allowed-tools 声明了 Task（即具备委派能力）。 */
function declaresTaskTool(root, mode) {
  const p = path.join(root, 'plugins/spec-driver/skills', `spec-driver-${mode}`, 'SKILL.md');
  if (!fs.existsSync(p)) return false;
  const fm = String(fs.readFileSync(p, 'utf-8')).match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return false;
  const at = fm[1].match(/^allowed-tools:\s*\[(.*)\]/m);
  return at ? /\bTask\b/.test(at[1]) : false;
}

/** 从 SKILL.md frontmatter 解析 `model:` 值（仅 frontmatter 首块内）。 */
function parseFrontmatterModel(skillText) {
  const text = String(skillText ?? '');
  // 仅匹配文件开头 --- ... --- 之间的 frontmatter
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^model:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

function resolveRoot(projectRoot) {
  return projectRoot ? path.resolve(projectRoot) : path.resolve(PLUGIN_DIR, '../..');
}

/** 返回某 mode 的双层 SKILL 路径（plugins + .codex）。 */
function layerPaths(root, mode) {
  return [
    {
      layer: 'plugins',
      path: path.join(root, 'plugins/spec-driver/skills', `spec-driver-${mode}`, 'SKILL.md'),
    },
    {
      layer: '.codex',
      path: path.join(root, '.codex/skills', `spec-driver-${mode}`, 'SKILL.md'),
    },
  ];
}

/**
 * 供 repo:check（repo-maintenance-core）复用的 model 断言：
 * 返回 { status, checks, warnings, errors }，与 aggregateValidation 契约一致。
 * check id 形如 `orchestrator-model-<m>`。
 */
export function validateOrchestratorModels({ projectRoot } = {}) {
  const root = resolveRoot(projectRoot);
  const errors = [];
  const checks = [];

  for (const mode of ORCHESTRATOR_MODES) {
    const offenders = [];
    for (const { layer, path: p } of layerPaths(root, mode)) {
      if (!fs.existsSync(p)) {
        offenders.push(`${layer}(缺失)`);
        errors.push(`spec-driver-${mode} ${layer} 层 SKILL.md 缺失: ${path.relative(root, p)}`);
        continue;
      }
      const model = parseFrontmatterModel(fs.readFileSync(p, 'utf-8'));
      if (model !== 'opus') {
        offenders.push(`${layer}=${model ?? '未声明'}`);
        errors.push(`spec-driver-${mode} ${layer} 层 frontmatter model=${model ?? '未声明'}，要求 opus（${path.relative(root, p)}）`);
      }
    }
    checks.push({
      id: `orchestrator-model-${mode}`,
      title: `spec-driver-${mode} 双层 frontmatter model=opus`,
      status: offenders.length > 0 ? 'fail' : 'pass',
      evidence: { offenders },
    });
  }

  // 覆盖断言（codex Warning-3）：任何在 allowed-tools 声明 Task 的 mode，必须要么在
  // opus-allowlist，要么在已记录豁免里——杜绝未来新增委派 SKILL 静默漏出硬约束管辖。
  const classified = new Set([...ORCHESTRATOR_MODES, ...Object.keys(DOCUMENTED_EXCEPTIONS)]);
  const unclassified = listAllModes(root).filter((m) => declaresTaskTool(root, m) && !classified.has(m));
  for (const m of unclassified) {
    errors.push(`spec-driver-${m} 在 allowed-tools 声明了 Task（具备委派能力）但未分类：需加入 ORCHESTRATOR_MODES（要求 opus）或 DOCUMENTED_EXCEPTIONS（注明理由）`);
  }
  checks.push({
    id: 'orchestrator-task-coverage',
    title: '所有含 Task 委派的 SKILL 均已分类（allowlist 或已记录豁免）',
    status: unclassified.length > 0 ? 'fail' : 'pass',
    evidence: { unclassified, exceptions: Object.keys(DOCUMENTED_EXCEPTIONS) },
  });

  return {
    status: errors.length > 0 ? 'fail' : 'pass',
    checks,
    warnings: [],
    errors,
  };
}

function run() {
  const result = validateOrchestratorModels({});
  if (result.errors.length > 0) {
    result.errors.forEach((e) => console.error(`[validate-orchestrator-models] ${e}`));
    process.exit(1);
  }
  console.log('[validate-orchestrator-models] 5 编排器双层 model=opus ✅');
}

const isCliEntry = process.argv[1] != null
  && path.resolve(process.argv[1]).endsWith('validate-orchestrator-models.mjs');
if (isCliEntry) {
  run();
}
