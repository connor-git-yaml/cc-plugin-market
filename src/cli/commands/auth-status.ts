/**
 * auth-status 子命令
 * 检测并显示当前环境的认证状态
 */

import { detectAuth, verifyAuth } from '../../auth/auth-detector.js';
import type { AuthMethod } from '../../auth/auth-detector.js';
import type { CLICommand } from '../utils/parse-args.js';

/**
 * 执行 auth-status 子命令
 */
export async function runAuthStatus(command: CLICommand): Promise<void> {
  const useVerify = command.verify === true;

  console.log('认证状态:');

  const result = useVerify ? await verifyAuth() : detectAuth();

  for (const method of result.methods) {
    const icon = method.available ? '✓' : '✗';
    const label = getMethodLabel(method);
    console.log(`  ${icon} ${label}: ${method.details}`);
  }

  console.log();

  if (result.preferred) {
    console.log(`  优先级: API Key > CLI 代理`);
    console.log(`  当前使用: ${result.preferred.type === 'api-key' ? 'API Key (SDK 直连)' : 'CLI 代理 (子进程)'}`);
  } else {
    console.log('  未找到可用的认证方式。请配置以下方式之一：');
    console.log('    1. 设置环境变量: export ANTHROPIC_API_KEY=your-key-here');
    console.log('    2. 安装并登录 Claude Code: claude auth login');
  }
}

/**
 * 获取认证方式的中文标签
 */
function getMethodLabel(method: AuthMethod): string {
  switch (method.type) {
    case 'api-key':
      return 'ANTHROPIC_API_KEY';
    case 'cli-proxy':
      return 'Claude CLI';
    default:
      return method.type;
  }
}
