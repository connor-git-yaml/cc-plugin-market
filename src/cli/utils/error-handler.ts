/**
 * CLI 错误处理工具
 * 友好的中文错误信息输出
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectAuth } from '../../auth/auth-detector.js';

/** 退出码定义 */
export const EXIT_CODES = {
  SUCCESS: 0,
  TARGET_ERROR: 1,
  API_ERROR: 2,
  /** Feature 127: 预算 gate 主动取消，供 CI 区分"成功 0 模块"和"被预算拦截" */
  BUDGET_EXCEEDED: 3,
} as const;

/**
 * 验证目标路径是否存在
 * @returns 如果路径不存在则输出错误信息并返回 false
 */
export function validateTargetPath(target: string): boolean {
  const resolved = resolve(target);
  if (!existsSync(resolved)) {
    printError(`目标路径不存在: ${resolved}`);
    return false;
  }
  return true;
}

/** 三种认证方式的配置指引，多处提示共用以防文案漂移 */
const AUTH_SETUP_HINT =
  '  1. 设置环境变量: export ANTHROPIC_API_KEY=your-key-here\n' +
  '  2. 安装并登录 Claude Code: claude auth login\n' +
  '  3. 安装并登录 Codex CLI: codex login';

/** 是否存在可用的认证方式（纯探测，无副作用） */
function hasAuth(): boolean {
  return Boolean(detectAuth().preferred);
}

/**
 * 默认的降级形态描述（spec 生成类命令）。
 * why 可定制：`diff` 的降级形态不是"产出 AST-only spec"，而是跳过语义评估仍产出完整
 * 结构漂移报告（`DriftReport` 根本没有 confidence 字段），套用默认文案即失实。
 */
const DEFAULT_DOWNGRADE_DESCRIPTION =
  '本次将降级为 AST-only 模式（仅结构骨架，无 LLM 语义摘要，置信度标记为 low）';

/**
 * 打印降级提示（非致命）。
 * why 与致命错误提示分开：这里表达"继续执行但降档"，不是"阻断"。
 */
function printDowngradeNotice(downgradeDescription: string): void {
  console.warn(
    `⚠ 未检测到可用的 LLM 认证方式，${downgradeDescription}。\n` +
      `  如需完整 LLM 增强，请配置以下任一方式后重新运行：\n${AUTH_SETUP_HINT}\n` +
      '  如需在缺少认证时强制失败（如 CI 场景），可添加 --require-llm 参数。',
  );
}

/**
 * Feature 222 统一认证门控：决定命令是否可以继续执行。
 * - 有认证：放行，无副作用。
 * - 无认证 + requireLlm=false（默认）：打印降级提示后放行，交由下游 orchestrator
 *   的既有降级分支接管。
 * - 无认证 + requireLlm=true：阻断执行（CI 逃生口）。
 *
 * why 不先打致命错误再放行：降级是成功路径，若在此吐 `✗ 错误` 到 stderr 会让 CI 日志误判失败。
 *
 * @param downgradeDescription 该命令实际的降级形态描述，缺省为 spec 生成类命令的 AST-only 表述
 */
export function resolveAuthGate(
  requireLlm: boolean,
  downgradeDescription: string = DEFAULT_DOWNGRADE_DESCRIPTION,
): boolean {
  if (hasAuth()) {
    return true;
  }
  if (requireLlm) {
    printError(
      '已指定 --require-llm，但未找到可用的认证方式，因此不降级而直接失败。\n' +
        `请配置以下任一方式后重试，或去掉 --require-llm 以允许降级：\n${AUTH_SETUP_HINT}`,
    );
    return false;
  }
  printDowngradeNotice(downgradeDescription);
  return true;
}

/**
 * 处理运行时错误，输出友好信息
 */
export function handleError(err: unknown): number {
  if (err instanceof Error) {
    // API 相关错误
    if (err.message.includes('API') || err.message.includes('api_key') || err.message.includes('authentication')) {
      printError(`LLM API 错误: ${err.message}`);
      return EXIT_CODES.API_ERROR;
    }

    // 文件系统错误
    if ('code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      printError(`文件或目录不存在: ${err.message}`);
      return EXIT_CODES.TARGET_ERROR;
    }

    printError(err.message);
  } else {
    printError(`未知错误: ${String(err)}`);
  }
  return EXIT_CODES.API_ERROR;
}

/**
 * 输出错误信息到 stderr
 */
export function printError(message: string): void {
  console.error(`✗ 错误: ${message}`);
}

/**
 * 输出警告信息
 */
export function printWarning(message: string): void {
  console.warn(`⚠ 警告: ${message}`);
}
