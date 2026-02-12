/**
 * CLI 参数解析器
 * 解析 process.argv，输出 CLICommand 对象
 */

/** CLI 命令结构 */
export interface CLICommand {
  subcommand: 'generate' | 'batch' | 'diff';
  target?: string;
  specFile?: string;
  deep: boolean;
  force: boolean;
  outputDir?: string;
  version: boolean;
  help: boolean;
}

/** 解析错误 */
export interface ParseError {
  type: 'invalid_subcommand' | 'missing_target' | 'missing_args';
  message: string;
}

/** 解析结果 */
export type ParseResult =
  | { ok: true; command: CLICommand }
  | { ok: false; error: ParseError };

/**
 * 解析 CLI 参数
 * @param argv process.argv.slice(2) 后的参数数组
 */
export function parseArgs(argv: string[]): ParseResult {
  // 全局选项优先处理
  if (argv.includes('--version') || argv.includes('-v')) {
    return {
      ok: true,
      command: {
        subcommand: 'generate',
        deep: false,
        force: false,
        version: true,
        help: false,
      },
    };
  }

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    return {
      ok: true,
      command: {
        subcommand: 'generate',
        deep: false,
        force: false,
        version: false,
        help: true,
      },
    };
  }

  const sub = argv[0];
  if (sub !== 'generate' && sub !== 'batch' && sub !== 'diff') {
    return {
      ok: false,
      error: {
        type: 'invalid_subcommand',
        message: `未知子命令: ${sub}`,
      },
    };
  }

  // 提取选项
  const deep = argv.includes('--deep');
  const force = argv.includes('--force');
  const outputDirIdx = argv.indexOf('--output-dir');
  const outputDir = outputDirIdx !== -1 ? argv[outputDirIdx + 1] : undefined;

  // 提取位置参数（排除选项和选项值）
  const positional = extractPositionalArgs(argv.slice(1));

  if (sub === 'generate') {
    if (positional.length === 0) {
      return {
        ok: false,
        error: {
          type: 'missing_target',
          message: 'generate 命令需要指定目标路径，例如: reverse-spec generate src/',
        },
      };
    }
    return {
      ok: true,
      command: {
        subcommand: 'generate',
        target: positional[0],
        deep,
        force: false,
        outputDir,
        version: false,
        help: false,
      },
    };
  }

  if (sub === 'batch') {
    return {
      ok: true,
      command: {
        subcommand: 'batch',
        deep: false,
        force,
        outputDir,
        version: false,
        help: false,
      },
    };
  }

  // diff 子命令
  if (positional.length < 2) {
    return {
      ok: false,
      error: {
        type: 'missing_args',
        message: 'diff 命令需要两个参数，例如: reverse-spec diff specs/auth.spec.md src/auth/',
      },
    };
  }
  return {
    ok: true,
    command: {
      subcommand: 'diff',
      specFile: positional[0],
      target: positional[1],
      deep: false,
      force: false,
      outputDir,
      version: false,
      help: false,
    },
  };
}

/**
 * 从参数数组中提取位置参数（排除以 -- 开头的选项和选项值）
 */
function extractPositionalArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith('--')) {
      // 跳过带值的选项（如 --output-dir <dir>）
      if (args[i] === '--output-dir') {
        i++; // 跳过选项值
      }
      continue;
    }
    result.push(args[i]!);
  }
  return result;
}
