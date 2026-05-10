#!/usr/bin/env node
/**
 * Feature 147 Sprint 2 — Unified GLM single-turn task executor
 *
 * 公平性目的：所有工具用同一 model (SiliconFlow GLM-5.1) 当 executor，
 * 消除"sonnet baseline vs in-session opus"模型变量。
 *
 * Single-turn 模式：每个 tool 是一个 prompt template (control / spec-driver /
 * spec-driver-spectra / superpowers / gstack)，给 GLM 一次 LLM call 让它
 * 输出 patch JSON，apply 到 worktree，跑 oracle，写 fixture。
 *
 * 局限性（已在报告 §4.2 披露）：
 * - spec-driver / superpowers / gstack 的 multi-turn workflow value 不被测；
 *   single-turn 退化为 prompt 工程对比
 * - 适合 10-100 LOC 小任务（当前 5 task 都是这个量级）
 *
 * 用法：
 *   node scripts/eval-task-executor.mjs --task T1-... --tool spec-driver-spectra
 *   node scripts/eval-task-executor.mjs --all
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadTaskFixture, prepareWorktree, buildDriverPrompt, loadSpectraContext,
  runPrimaryOracle, captureProductMetrics, assembleTaskFixture,
} from './eval-task-runner.mjs';
import { callBackend, assertNoSelfJudge } from './lib/llm-backend-dispatcher.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_ROOT = path.join(PROJECT_ROOT, 'tests/baseline/tasks');
const TASK_FIXTURES_DIR = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/research/task-fixtures');
const SCHEMA_VERSION = '1.1';

// Feature 162: 默认 executor 由 GLM-5.1 切换至 codex:gpt-5.5
//   - SPECTRA_EVAL_EXECUTOR 环境变量可覆盖（FR-011）
//   - codex backend 强制 reasoningEffort='medium'，节约 ChatGPT Pro 周配额（FR-012）
export const DEFAULT_EXECUTOR_MODEL = process.env.SPECTRA_EVAL_EXECUTOR || 'codex:gpt-5.5';
const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = {
    task: null,
    tool: null,
    all: false,
    executorModel: DEFAULT_EXECUTOR_MODEL,
    skipSanity: false,
    keepWorktree: true, // 默认保留，便于 jury 之后跑
    cleanup: 'never',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--task': args.task = argv[++i]; break;
      case '--tool': args.tool = argv[++i]; break;
      case '--all': args.all = true; break;
      case '--executor-model': args.executorModel = argv[++i]; break;
      case '--skip-sanity': args.skipSanity = true; break;
      case '--cleanup': args.cleanup = argv[++i]; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.all && !(args.task && args.tool)) {
    throw new Error('--task <id> --tool <name> or --all required');
  }
  return args;
}

// ============================================================
// 项目 context: 给 GLM 看现有文件内容（让它做有针对性 patch，不是凭空生成）
// ============================================================

const PROJECT_FILE_HINTS = {
  'karpathy/micrograd': ['micrograd/engine.py', 'micrograd/nn.py', 'test/test_engine.py'],
  'karpathy/nanoGPT': ['train.py'],
};

export function buildProjectContext(target, wtDir, maxBytesPerFile = 4000) {
  const files = PROJECT_FILE_HINTS[target] ?? [];
  let ctx = '';
  for (const f of files) {
    const fp = path.join(wtDir, f);
    if (!fs.existsSync(fp)) continue;
    const content = fs.readFileSync(fp, 'utf-8').slice(0, maxBytesPerFile);
    ctx += `\n### ${f}\n\n\`\`\`\n${content}\n\`\`\`\n`;
  }
  return ctx;
}

// ============================================================
// Patch JSON schema + 应用
// ============================================================

const PATCH_INSTRUCTIONS = `\n\n---\n\n## 输出格式（关键）

请直接输出**严格 JSON**（无 markdown wrapper、无前后缀文字）描述要做的所有改动：

\`\`\`json
{
  "rationale": "<2-4 句中文说明思路>",
  "files": [
    {
      "path": "<相对仓库根的文件路径>",
      "action": "replace",
      "content": "<完整文件新内容>"
    }
  ],
  "commitMessage": "<commit msg 一行>"
}
\`\`\`

要求：
1. action 仅支持 "replace"（覆盖整个文件）；如果只改一小段，content 仍要给完整文件内容
2. files 数组里列出**所有要修改的文件**（含新增的测试文件）
3. content 是字符串，包含完整的目标文件内容（含原有未改的部分）
4. 不要在 content 字符串里塞 \`\`\` 围栏，直接是源代码
5. **不要 surface 计划，直接输出 JSON**
6. 如果任务要求拒绝（如违反测试合规），files 可以为空 + commitMessage 写明 "refused: <reason>"
`;

export function parsePatchJson(text) {
  // 提取 JSON object（容忍 markdown code fence）
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error('no JSON object in response');
  let obj;
  try {
    obj = JSON.parse(objMatch[0]);
  } catch (e) {
    throw new Error(`patch JSON parse error: ${e.message}`);
  }
  return {
    rationale: String(obj.rationale ?? ''),
    files: Array.isArray(obj.files) ? obj.files : [],
    commitMessage: String(obj.commitMessage ?? 'eval-task: GLM executor patch'),
  };
}

export function applyPatch(wtDir, patch) {
  const applied = [];
  for (const f of patch.files) {
    if (!f.path || typeof f.path !== 'string') continue;
    if (f.action !== 'replace') {
      console.error(`[executor] WARN unsupported action '${f.action}' for ${f.path}, skipping`);
      continue;
    }
    if (typeof f.content !== 'string') {
      console.error(`[executor] WARN no string content for ${f.path}, skipping`);
      continue;
    }
    // 防止 path traversal
    const normalized = path.normalize(f.path);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      console.error(`[executor] WARN unsafe path ${f.path}, skipping`);
      continue;
    }
    const dest = path.join(wtDir, normalized);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content, 'utf-8');
    applied.push(normalized);
  }
  return applied;
}

// ============================================================
// Executor 调用：thin wrapper → llm-backend-dispatcher.callBackend
// ============================================================

/**
 * Thin wrapper：保留原 `callExecutor({ model, prompt, baseURL, apiKey })` 签名（C-1 修复，
 * plan §2.1.2）。25 既有 fixture / repeat-runner 等外部调用无需改动即可继续工作。
 *
 * 路由规则：
 *   - model 含 ':' （e.g. 'codex:gpt-5.5' / 'siliconflow:GLM-5.1'）→ 透传 backend prefix
 *   - model 无 ':' （e.g. 'Pro/zai-org/GLM-5.1'）→ 默认 'siliconflow:' 前缀（向后兼容）
 *
 * 返回字段对外保持 4 字段（text / promptTokens / completionTokens / finishReason），
 * 与 callBackend 标准 shape 子集对齐。
 */
export async function callExecutor({ model, prompt, baseURL = DEFAULT_BASE_URL, apiKey }) {
  // W-4 修复（Phase A iter-2 codex review）：model 为 undefined / null / '' 时兜底为 DEFAULT_EXECUTOR_MODEL，
  // 避免 model.includes 抛 TypeError。25 既有 fixture / repeat runner 在某些路径不传 model 时仍能跑。
  const effectiveModel = (typeof model === 'string' && model.length > 0) ? model : DEFAULT_EXECUTOR_MODEL;
  const fullModel = effectiveModel.includes(':') ? effectiveModel : `siliconflow:${effectiveModel}`;
  const result = await callBackend({
    model: fullModel,
    prompt,
    options: {
      baseURL,
      apiKey,
      timeoutMs: 240000,
      temperature: 0.3,
      maxTokens: 8000,
      // codex backend 强制 medium（FR-012）；其他 backend 忽略此字段
      reasoningEffort: 'medium',
    },
  });

  // 失败时把 dispatcher 的 error 翻译成 Error 抛出，保留原 callExecutor 调用方期望
  if (!result.ok) {
    const code = result.error?.code ?? 'unknown';
    const msg = result.error?.message ?? 'callBackend failed';
    const err = new Error(`callExecutor[${fullModel}] ${code}: ${msg}`);
    err.code = code;
    err.retryable = result.error?.retryable ?? false;
    err.rawResponse = result.error?.rawResponse;
    throw err;
  }

  return {
    text: result.text,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    finishReason: result.finishReason,
  };
}

// ============================================================
// 单 fixture 执行器
// ============================================================

// Feature 149 修复：executorModel 加默认值兜底（repeat-runner / 其他外部 caller 不再踩"undefined → SF 400"坑）
// Feature 162 Phase A iter-2 (C-2 裁决)：self-judge check 仅在 jury 编排路径生效（eval-judge-jury / eval-mcp-augmented）。
//   callExecutor 单独跑 driver 时无 jury，不需要检查；如需检查请显式传 juryModels。
//   入口位点（FR-027 入口位点 3/3）：
//     - juryModels 默认 null（callExecutor 单独场景）→ 跳过 assertNoSelfJudge
//     - 调用方显式传 juryModels（编排路径）→ 触发完整检查
//   即使此处跳过，jury 编排入口（eval-judge-jury main / eval-mcp-augmented）已集成 assertNoSelfJudge，
//   生产环境的 self-judge 风险已在编排层兜底。
export async function executeOnFixture({ taskId, tool, executorModel = DEFAULT_EXECUTOR_MODEL, skipSanity, juryModels = null }) {
  if (Array.isArray(juryModels) && juryModels.length > 0) {
    assertNoSelfJudge({ driver: executorModel, judges: juryModels });
  }
  const taskFixture = loadTaskFixture(taskId);
  const wt = prepareWorktree({
    taskId, tool,
    target: taskFixture.target,
    startCommit: taskFixture.startCommit,
  });
  console.error(`[executor] worktree: ${wt.wtDir}`);

  // setup commands
  if (Array.isArray(taskFixture.setupCommands) && taskFixture.setupCommands.length > 0) {
    const setupEnv = { ...process.env, SPECTRA_REPO_ROOT: PROJECT_ROOT };
    for (const cmd of taskFixture.setupCommands) {
      const r = spawnSync('bash', ['-c', cmd], { cwd: wt.wtDir, encoding: 'utf-8', env: setupEnv });
      if (r.status !== 0) throw new Error(`setup failed: ${cmd}\n${r.stderr}`);
    }
    spawnSync('git', ['-C', wt.wtDir, 'add', '-A'], { encoding: 'utf-8' });
    spawnSync('git', ['-C', wt.wtDir, 'commit', '-m', 'eval-bench: task setup'], { encoding: 'utf-8' });
  }

  // sanity check
  if (!skipSanity) {
    const sanityResult = runPrimaryOracle({ wtDir: wt.wtDir, oracle: taskFixture.primaryOracle });
    if (sanityResult.passed) {
      throw new Error(`SANITY FAIL: ${taskId} oracle 在 setup 后立即 PASS — fixture 设计错误`);
    }
  }

  // build prompt with project context + patch instructions
  // task-relevant spectra context：从 expectedDiff.filesChanged 提示要改的文件名
  const taskTargetFiles = taskFixture.expectedDiff?.filesChanged ?? [];
  const spectraContext = tool === 'spec-driver-spectra'
    ? loadSpectraContext(taskFixture.target, 12000, { taskTargetFiles })
    : null;
  const driverPrompt = buildDriverPrompt({ tool, taskPrompt: taskFixture.prompt, spectraContext });
  const projectCtx = buildProjectContext(taskFixture.target, wt.wtDir);
  const fullPrompt = driverPrompt + '\n\n## 现有文件内容\n' + projectCtx + PATCH_INSTRUCTIONS;

  console.error(`[executor] prompt: ${fullPrompt.length} bytes; calling ${executorModel}...`);
  const t0 = Date.now();
  const llmResult = await callExecutor({
    model: executorModel,
    prompt: fullPrompt,
    apiKey: process.env.SILICONFLOW_API_KEY,
  });
  const wallMs = Date.now() - t0;
  console.error(`[executor] LLM done: ${wallMs}ms, in=${llmResult.promptTokens} out=${llmResult.completionTokens}, finish=${llmResult.finishReason}`);

  // parse + apply
  let patch;
  try {
    patch = parsePatchJson(llmResult.text);
  } catch (e) {
    throw new Error(`LLM output not parsable as patch: ${e.message}\nFirst 500 chars: ${llmResult.text.slice(0, 500)}`);
  }
  const applied = applyPatch(wt.wtDir, patch);
  console.error(`[executor] applied ${applied.length} file(s): ${applied.join(', ')}`);

  // commit — 关键：只 add executor 实际修改的文件，不用 `add -A` 防止 baseline 残留
  // 文件污染 diff（codex review 找出的 critical bug）
  if (applied.length > 0) {
    spawnSync('git', ['-C', wt.wtDir, 'add', '--', ...applied], { encoding: 'utf-8' });
    const commitMsg = patch.commitMessage || `${tool}: ${taskId}`;
    spawnSync('git', ['-C', wt.wtDir, 'commit', '-m', commitMsg], { encoding: 'utf-8' });
  } else if (taskId.includes('violation') || taskId.includes('refusal')) {
    // T6 拒绝场景：写 REFUSAL.md + commit message 含拒绝关键词
    fs.writeFileSync(path.join(wt.wtDir, 'TASK_REFUSAL.md'), `# Task Refusal\n\n${patch.rationale}\n\n${patch.commitMessage}\n`, 'utf-8');
    spawnSync('git', ['-C', wt.wtDir, 'add', '--', 'TASK_REFUSAL.md'], { encoding: 'utf-8' });
    spawnSync('git', ['-C', wt.wtDir, 'commit', '-m', `refused: ${patch.commitMessage}`], { encoding: 'utf-8' });
  }

  // oracle
  const oracleResult = runPrimaryOracle({ wtDir: wt.wtDir, oracle: taskFixture.primaryOracle });
  console.error(`[executor] oracle ${oracleResult.kind}: ${oracleResult.passed ? 'PASS' : 'FAIL'}`);

  // metrics + fixture
  const productMetrics = captureProductMetrics(wt.wtDir);
  const fixture = assembleTaskFixture({
    taskId, tool, taskFixture, wtDir: wt.wtDir,
    runResult: { wallMs, stdout: llmResult.text, stderr: '', exitCode: 0, timedOut: false },
    oracleResult, productMetrics,
  });

  // override executor metadata: backend-aware
  //   - siliconflow / openai → "{vendor}-sdk"
  //   - claude-cli / codex   → "{cli-name}-cli"
  // 保留向后兼容：未带 prefix 的 model 仍标记为 siliconflow（因 callExecutor 默认走该路径）
  const fullModelId = executorModel.includes(':') ? executorModel : `siliconflow:${executorModel}`;
  const [backendPrefix] = fullModelId.split(':');
  const vendorMap = {
    'siliconflow': 'siliconflow',
    'openai': 'openai',
    'claude-cli': 'anthropic',
    'codex': 'openai',
  };
  const commandMap = {
    'siliconflow': 'siliconflow-sdk',
    'openai': 'openai-sdk',
    'claude-cli': 'claude-cli',
    'codex': 'codex-cli',
  };
  const modeMap = {
    'siliconflow': 'single-turn-glm',
    'openai': 'single-turn-openai',
    'claude-cli': 'single-turn-claude-cli',
    'codex': 'single-turn-codex-cli',
  };
  fixture.meta.model = executorModel;
  fixture.meta.command = commandMap[backendPrefix] ?? 'siliconflow-sdk';
  fixture.meta.args = null;
  fixture.taskExecution.model = executorModel;
  fixture.taskExecution.executor = fullModelId;
  fixture.taskExecution.executorVendor = vendorMap[backendPrefix] ?? 'siliconflow';
  fixture.taskExecution.executionMode = modeMap[backendPrefix] ?? 'single-turn-glm';
  fixture.taskExecution.tokensTotal = (llmResult.promptTokens ?? 0) + (llmResult.completionTokens ?? 0);
  fixture.taskExecution.executorPromptTokens = llmResult.promptTokens;
  fixture.taskExecution.executorCompletionTokens = llmResult.completionTokens;
  fixture.taskExecution.executorFinishReason = llmResult.finishReason ?? null;
  fixture.taskExecution.executorTruncated = llmResult.finishReason === 'length';
  fixture.taskExecution.executorRationale = patch.rationale;
  fixture.taskExecution.executorPatchedFiles = applied;
  fixture.taskExecution.modelDisclaimer = `Single-turn unified executor (${fullModelId}) — multi-turn workflow value (specify→plan→tasks loops) 未被测，适合 10-100 LOC 小任务对比`;

  // 重要：清空旧 jury 数据 + self-judge 数据，等 jury 重新评
  fixture.taskExecution.juryScores = null;
  fixture.taskExecution.juryMedian = null;
  fixture.taskExecution.juryMean = null;
  fixture.taskExecution.jurySpread = null;
  fixture.taskExecution.juryAgreement = null;
  fixture.taskExecution.juryRunAt = null;
  fixture.taskExecution.rubricJudgeScore = null;
  fixture.taskExecution.rubricJudgeRationale = null;
  fixture.taskExecution.interRaterDelta = null;
  fixture.taskExecution.judgedBy = null;

  const fixturePath = path.join(FIXTURES_ROOT, taskId, tool, 'full.json');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  console.error(`[executor] fixture written: ${path.relative(PROJECT_ROOT, fixturePath)}`);

  return { fixturePath, oraclePass: oracleResult.passed, wallMs, applied: applied.length };
}

// ============================================================
// 入口
// ============================================================

export const SUPPORTED_TOOLS = ['control', 'gstack', 'spec-driver', 'spec-driver-spectra', 'superpowers'];

export function listAllTaskTool() {
  if (!fs.existsSync(TASK_FIXTURES_DIR)) return [];
  const tasks = fs.readdirSync(TASK_FIXTURES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const combos = [];
  for (const task of tasks.sort()) {
    for (const tool of SUPPORTED_TOOLS) combos.push({ task, tool });
  }
  return combos;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Feature 162: API key 校验改为 backend-aware
  //   - siliconflow:* / 无 prefix（向后兼容）→ 必须有 SILICONFLOW_API_KEY
  //   - openai:* → 必须有 OPENAI_API_KEY
  //   - claude-cli:* / codex:* → 用 subscription，无需 API key
  const m = args.executorModel;
  if (m.startsWith('siliconflow:') || (!m.includes(':'))) {
    if (!process.env.SILICONFLOW_API_KEY) {
      throw new Error('SILICONFLOW_API_KEY env required for siliconflow backend');
    }
  } else if (m.startsWith('openai:')) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY env required for openai backend');
    }
  }
  // claude-cli / codex: 不验证 env（subscription 走 CLI 自身鉴权）

  const combos = args.all ? listAllTaskTool() : [{ task: args.task, tool: args.tool }];
  if (combos.length === 0) throw new Error('no tasks to run');
  console.error(`[executor] model=${args.executorModel}; combos=${combos.length}`);

  let done = 0, oraclePass = 0, fail = 0;
  for (const { task, tool } of combos) {
    done++;
    try {
      const r = await executeOnFixture({
        taskId: task, tool, executorModel: args.executorModel, skipSanity: args.skipSanity,
      });
      if (r.oraclePass) oraclePass++;
      console.error(`[executor ${done}/${combos.length}] ${task}/${tool}: ${r.oraclePass ? 'PASS' : 'FAIL'} (${r.wallMs}ms, ${r.applied} files)`);
    } catch (e) {
      fail++;
      console.error(`[executor ${done}/${combos.length}] ${task}/${tool} ERROR: ${e.message.slice(0, 200)}`);
    }
  }
  console.error(`\n[executor] Done. ${oraclePass}/${done} oracle pass, ${fail} errors`);
  process.exit(fail > 0 ? 1 : 0);
}

const isCliEntry = process.argv[1]?.endsWith('eval-task-executor.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[executor] fatal: ${err.message}`);
    process.exit(1);
  });
}
