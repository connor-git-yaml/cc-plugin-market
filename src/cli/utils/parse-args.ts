/**
 * CLI 参数解析器
 * 解析 process.argv，输出 CLICommand 对象
 */

/** CLI 命令结构 */
export interface CLICommand {
  subcommand: 'generate' | 'batch' | 'diff' | 'init' | 'prepare' | 'auth-status' | 'mcp-server' | 'panoramic' | 'cache' | 'watch' | 'graph' | 'community' | 'query' | 'install' | 'export';
  target?: string;
  specFile?: string;
  deep: boolean;
  force: boolean;
  incremental?: boolean;
  /** 语言过滤（如 ['typescript', 'python']），仅处理指定语言（仅 batch） */
  languages?: string[];
  outputDir?: string;
  version: boolean;
  help: boolean;
  /** --global 选项（仅 init 子命令） */
  global: boolean;
  /** --remove 选项（仅 init 子命令） */
  remove: boolean;
  /** init 目标平台（仅 init 子命令） */
  skillTarget: 'claude' | 'codex' | 'both';
  /** --verify 选项（仅 auth-status 子命令） */
  verify?: boolean;
  /** 用户在 CLI 中显式提供的参数名集合（用于与配置文件合并） */
  _explicitFlags?: Set<string>;
  /** panoramic 子操作（仅 panoramic 子命令） */
  panoramicOperation?: 'cross-package' | 'architecture-ir' | 'overview';
  /** --json 输出标志（仅 panoramic 子命令） */
  jsonOutput?: boolean;
  /** --project-root 参数（仅 panoramic 子命令，未传时使用 process.cwd()） */
  projectRoot?: string;
  /** cache 子操作（仅 cache 子命令） */
  cacheOperation?: 'stats' | 'clear';
  /** --generator 参数（仅 cache clear 子命令） */
  cacheGeneratorId?: string;
  /** watch debounce 时长（秒，仅 watch 子命令，默认 3） */
  watchDebounce?: number;
  /** watch 详细日志模式（仅 watch 子命令） */
  watchVerbose?: boolean;
  /** graph 命令操作类型 */
  graphOperation?: 'build';
  /** 是否生成有向图（仅 graph 命令） */
  directed?: boolean;
  /** 最小社区节点数过滤（仅 community 命令） */
  communityMinSize?: number;
  /** query 命令查询词（仅 query 子命令，来自第一个位置参数） */
  queryQuestion?: string;
  /** query 命令 budget 上限（仅 query 子命令，--budget <N>） */
  budget?: number;
  /** query 命令输出格式（仅 query 子命令，--format text|json，默认 text） */
  format?: 'text' | 'json';
  /** install 子命令：是否同时操作 git hook */
  installGit?: boolean;
  /** install 子命令：是否切换为卸载模式 */
  installRemove?: boolean;
  /** 启用 Markdown 文档 + API 规范提取（仅 batch 子命令）— Feature 107 */
  includeDocs?: boolean;
  /** 启用图像/图表 Vision 提取（仅 batch 子命令）— Feature 107 */
  includeImages?: boolean;
  /** export 命令目标格式（使用 exportFormat 避免与 query 的 format 冲突） */
  exportFormat?: 'obsidian' | 'html';
}

/** 解析错误 */
export interface ParseError {
  type: 'invalid_subcommand' | 'missing_target' | 'missing_args' | 'invalid_option';
  message: string;
}

/** 解析结果 */
export type ParseResult =
  | { ok: true; command: CLICommand }
  | { ok: false; error: ParseError };

function defaultSkillTarget(env: NodeJS.ProcessEnv = process.env): 'claude' | 'codex' {
  return isCodexRuntimeEnv(env) ? 'codex' : 'claude';
}

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
        global: false,
        remove: false,
        skillTarget: defaultSkillTarget(),
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
        global: false,
        remove: false,
        skillTarget: defaultSkillTarget(),
      },
    };
  }

  const sub = argv[0];

  // panoramic 子命令
  if (sub === 'panoramic') {
    if (argv.includes('--help') || argv.includes('-h') || argv.length === 1) {
      return {
        ok: true,
        command: {
          subcommand: 'panoramic',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
        },
      };
    }
    const op = argv[1];
    if (op !== 'cross-package' && op !== 'architecture-ir' && op !== 'overview') {
      return {
        ok: false,
        error: {
          type: 'invalid_subcommand',
          message: `未知 panoramic 子操作: ${op ?? '（未提供）'}（可选: cross-package | architecture-ir | overview）`,
        },
      };
    }
    const jsonOutput = argv.includes('--json');
    const projectRootIdx = argv.indexOf('--project-root');
    const projectRoot = projectRootIdx !== -1 ? argv[projectRootIdx + 1] : undefined;
    return {
      ok: true,
      command: {
        subcommand: 'panoramic',
        panoramicOperation: op,
        jsonOutput,
        projectRoot,
        deep: false, force: false, version: false, help: false,
        global: false, remove: false, skillTarget: defaultSkillTarget(),
      },
    };
  }

  // cache 子命令
  if (sub === 'cache') {
    if (argv.includes('--help') || argv.includes('-h') || argv.length === 1) {
      return {
        ok: true,
        command: {
          subcommand: 'cache',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
        },
      };
    }
    const op = argv[1];
    if (op !== 'stats' && op !== 'clear') {
      return {
        ok: false,
        error: {
          type: 'invalid_subcommand',
          message: `未知 cache 子操作: ${op ?? '（未提供）'}（可选: stats | clear）`,
        },
      };
    }
    const outputDirIdx = argv.indexOf('--output-dir');
    const outputDir = outputDirIdx !== -1 ? argv[outputDirIdx + 1] : undefined;
    const generatorIdx = argv.indexOf('--generator');
    const cacheGeneratorId = generatorIdx !== -1 ? argv[generatorIdx + 1] : undefined;
    return {
      ok: true,
      command: {
        subcommand: 'cache',
        cacheOperation: op,
        cacheGeneratorId,
        outputDir,
        deep: false, force: false, version: false, help: false,
        global: false, remove: false, skillTarget: defaultSkillTarget(),
      },
    };
  }

  // watch 子命令
  if (sub === 'watch') {
    if (argv.includes('--help') || argv.includes('-h')) {
      return {
        ok: true,
        command: {
          subcommand: 'watch',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
        },
      };
    }
    const debounceIdx = argv.indexOf('--debounce');
    const debounceRaw = debounceIdx !== -1 ? argv[debounceIdx + 1] : undefined;
    let watchDebounce: number | undefined;
    if (debounceIdx !== -1) {
      // 未提供值，或值为另一个 flag
      if (debounceRaw === undefined || debounceRaw.startsWith('-')) {
        return {
          ok: false,
          error: {
            type: 'invalid_option',
            message: `--debounce 需要正整数值（秒），未提供有效值`,
          },
        };
      }
      const parsed = parseInt(debounceRaw, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return {
          ok: false,
          error: {
            type: 'invalid_option',
            message: `--debounce 必须为正整数，收到: ${debounceRaw}`,
          },
        };
      }
      watchDebounce = parsed;
    }
    const watchVerbose = argv.includes('--verbose');
    return {
      ok: true,
      command: {
        subcommand: 'watch',
        watchDebounce,
        watchVerbose,
        deep: false, force: false, version: false, help: false,
        global: false, remove: false, skillTarget: defaultSkillTarget(),
      },
    };
  }

  // community 子命令
  if (sub === 'community') {
    if (argv.includes('--help') || argv.includes('-h')) {
      return {
        ok: true,
        command: {
          subcommand: 'community',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
        },
      };
    }
    const outputDirIdx = argv.indexOf('--output-dir');
    const outputDir = outputDirIdx !== -1 ? argv[outputDirIdx + 1] : undefined;
    const minSizeIdx = argv.indexOf('--min-size');
    let communityMinSize: number | undefined;
    if (minSizeIdx !== -1 && argv[minSizeIdx + 1]) {
      const parsed = parseInt(argv[minSizeIdx + 1]!, 10);
      if (!isNaN(parsed) && parsed > 0) {
        communityMinSize = parsed;
      }
    }
    return {
      ok: true,
      command: {
        subcommand: 'community',
        communityMinSize,
        outputDir,
        deep: false, force: false, version: false, help: false,
        global: false, remove: false, skillTarget: defaultSkillTarget(),
      },
    };
  }

  // graph 子命令
  if (sub === 'graph') {
    if (argv.includes('--help') || argv.includes('-h')) {
      return {
        ok: true,
        command: {
          subcommand: 'graph',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
        },
      };
    }
    const outputDirIdx = argv.indexOf('--output-dir');
    const outputDir = outputDirIdx !== -1 ? argv[outputDirIdx + 1] : undefined;
    const directed = argv.includes('--directed');
    return {
      ok: true,
      command: {
        subcommand: 'graph',
        graphOperation: 'build',
        directed,
        outputDir,
        deep: false, force: false, version: false, help: false,
        global: false, remove: false, skillTarget: defaultSkillTarget(),
      },
    };
  }

  // query 子命令
  if (sub === 'query') {
    if (argv.includes('--help') || argv.includes('-h')) {
      return {
        ok: true,
        command: {
          subcommand: 'query',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
        },
      };
    }
    // 第一个位置参数为查询词
    const queryPositional = extractPositionalArgs(argv.slice(1));
    const queryQuestion = queryPositional[0];
    // 解析 --budget <N>
    const budgetIdx = argv.indexOf('--budget');
    let budget: number | undefined;
    if (budgetIdx !== -1 && argv[budgetIdx + 1] !== undefined) {
      const parsed = parseInt(argv[budgetIdx + 1]!, 10);
      if (!isNaN(parsed)) budget = parsed;
    }
    // 解析 --format text|json
    const formatIdx = argv.indexOf('--format');
    let format: 'text' | 'json' | undefined;
    if (formatIdx !== -1) {
      const raw = argv[formatIdx + 1];
      if (raw === 'json') format = 'json';
      else if (raw === 'text') format = 'text';
    }
    return {
      ok: true,
      command: {
        subcommand: 'query',
        queryQuestion,
        budget,
        format,
        deep: false, force: false, version: false, help: false,
        global: false, remove: false, skillTarget: defaultSkillTarget(),
      },
    };
  }

  // install 子命令（hook 安装）
  if (sub === 'install') {
    if (argv.includes('--help') || argv.includes('-h')) {
      return {
        ok: true,
        command: {
          subcommand: 'install',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
          installGit: false, installRemove: false,
        },
      };
    }
    const installGit = argv.includes('--git');
    const installRemove = argv.includes('--remove');
    return {
      ok: true,
      command: {
        subcommand: 'install',
        installGit,
        installRemove,
        deep: false, force: false, version: false, help: false,
        global: false, remove: false, skillTarget: defaultSkillTarget(),
      },
    };
  }

  // export 子命令
  if (sub === 'export') {
    if (argv.includes('--help') || argv.includes('-h')) {
      return {
        ok: true,
        command: {
          subcommand: 'export',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
        },
      };
    }
    const outputDirIdx = argv.indexOf('--output-dir');
    const outputDir = outputDirIdx !== -1 ? argv[outputDirIdx + 1] : undefined;
    const formatIdx = argv.indexOf('--format');
    const formatRaw = formatIdx !== -1 ? argv[formatIdx + 1] : undefined;
    // exportFormat 允许任意值传入，handler 层校验有效性
    const exportFormat = formatRaw as 'obsidian' | 'html' | undefined;
    return {
      ok: true,
      command: {
        subcommand: 'export',
        exportFormat,
        outputDir,
        deep: false, force: false, version: false, help: false,
        global: false, remove: false, skillTarget: defaultSkillTarget(),
      },
    };
  }

  // init 子命令
  if (sub === 'init') {
    const hasGlobal = argv.includes('--global') || argv.includes('-g');
    const hasRemove = argv.includes('--remove');
    const target = parseInitTarget(argv);
    if (target.error) {
      return {
        ok: false,
        error: {
          type: 'invalid_option',
          message: target.error,
        },
      };
    }

    // init 不接受位置参数
    const positional = extractPositionalArgs(argv.slice(1));
    if (positional.length > 0) {
      return {
        ok: false,
        error: {
          type: 'invalid_option',
          message:
            'init 命令不接受位置参数，用法: spectra init [--global] [--remove] [--target <claude|codex|both>]',
        },
      };
    }

    return {
      ok: true,
      command: {
        subcommand: 'init',
        deep: false,
        force: false,
        version: false,
        help: false,
        global: hasGlobal,
        remove: hasRemove,
        skillTarget: target.value,
      },
    };
  }

  // auth-status 子命令
  if (sub === 'auth-status') {
    const hasVerify = argv.includes('--verify');
    return {
      ok: true,
      command: {
        subcommand: 'auth-status',
        deep: false,
        force: false,
        version: false,
        help: false,
        global: false,
        remove: false,
        skillTarget: defaultSkillTarget(),
        verify: hasVerify,
      },
    };
  }

  // mcp-server 子命令（无额外参数）
  if (sub === 'mcp-server') {
    return {
      ok: true,
      command: {
        subcommand: 'mcp-server',
        deep: false,
        force: false,
        version: false,
        help: false,
        global: false,
        remove: false,
        skillTarget: defaultSkillTarget(),
      },
    };
  }

  // --global/--remove/--target 仅在 init 子命令下有效
  if (argv.includes('--global') || argv.includes('-g')) {
    return {
      ok: false,
      error: {
        type: 'invalid_option',
        message: '--global 选项仅在 init 子命令下有效',
      },
    };
  }
  if (argv.includes('--remove') && sub !== 'install') {
    return {
      ok: false,
      error: {
        type: 'invalid_option',
        message: '--remove 选项仅在 init / install 子命令下有效',
      },
    };
  }
  if (argv.includes('--target')) {
    return {
      ok: false,
      error: {
        type: 'invalid_option',
        message: '--target 选项仅在 init 子命令下有效',
      },
    };
  }
  if (argv.includes('--languages') && sub !== 'batch') {
    return {
      ok: false,
      error: {
        type: 'invalid_option',
        message: '--languages 选项仅在 batch 子命令下有效',
      },
    };
  }

  if (sub !== 'generate' && sub !== 'batch' && sub !== 'diff' && sub !== 'prepare' && sub !== 'auth-status' && sub !== 'mcp-server' && sub !== 'panoramic' && sub !== 'cache' && sub !== 'watch' && sub !== 'graph' && sub !== 'community' && sub !== 'query' && sub !== 'install' && sub !== 'export') {
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
  const incremental = argv.includes('--incremental');
  const outputDirIdx = argv.indexOf('--output-dir');
  const outputDir = outputDirIdx !== -1 ? argv[outputDirIdx + 1] : undefined;
  const languagesIdx = argv.indexOf('--languages');
  const languages = languagesIdx !== -1 && argv[languagesIdx + 1]
    ? argv[languagesIdx + 1]!.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;

  // 提取位置参数（排除选项和选项值）
  const positional = extractPositionalArgs(argv.slice(1));

  if (sub === 'generate' || sub === 'prepare') {
    if (positional.length === 0) {
      return {
        ok: false,
        error: {
          type: 'missing_target',
          message: `${sub} 命令需要指定目标路径，例如: spectra ${sub} src/`,
        },
      };
    }
    return {
      ok: true,
      command: {
        subcommand: sub,
        target: positional[0],
        deep,
        force: false,
        outputDir,
        version: false,
        help: false,
        global: false,
        remove: false,
        skillTarget: defaultSkillTarget(),
      },
    };
  }

  if (sub === 'batch') {
    const explicitFlags = new Set<string>();
    if (argv.includes('--force')) explicitFlags.add('force');
    if (argv.includes('--incremental')) explicitFlags.add('incremental');
    if (languagesIdx !== -1) explicitFlags.add('languages');
    if (outputDirIdx !== -1) explicitFlags.add('outputDir');

    // Feature 107：多模态提取标志
    const includeDocs = argv.includes('--include-docs');
    const includeImages = argv.includes('--include-images');
    if (includeDocs) explicitFlags.add('includeDocs');
    if (includeImages) explicitFlags.add('includeImages');

    return {
      ok: true,
      command: {
        subcommand: 'batch',
        target: positional[0], // batch 目标目录（可选，默认 cwd）
        deep: false,
        force,
        incremental,
        languages,
        outputDir,
        version: false,
        help: false,
        global: false,
        remove: false,
        skillTarget: defaultSkillTarget(),
        _explicitFlags: explicitFlags,
        includeDocs: includeDocs || undefined,
        includeImages: includeImages || undefined,
      },
    };
  }

  // diff 子命令
  if (positional.length < 2) {
    return {
      ok: false,
      error: {
        type: 'missing_args',
        message: 'diff 命令需要两个参数，例如: spectra diff specs/auth.spec.md src/auth/',
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
      global: false,
      remove: false,
      skillTarget: defaultSkillTarget(),
    },
  };
}

/**
 * 从参数数组中提取位置参数（排除以 -- 开头的选项和选项值及 -g 缩写）
 */
function extractPositionalArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith('--')) {
      // 跳过带值的选项（如 --output-dir <dir>, --target <value>）
      if (args[i] === '--output-dir' || args[i] === '--target' || args[i] === '--languages' || args[i] === '--project-root' || args[i] === '--generator' || args[i] === '--debounce' || args[i] === '--min-size' || args[i] === '--budget' || args[i] === '--format') {
        i++; // 跳过选项值
      }
      continue;
    }
    if (args[i] === '-g') {
      continue;
    }
    result.push(args[i]!);
  }
  return result;
}

/** 解析 init 的 --target 选项 */
function parseInitTarget(argv: string[]): {
  value: 'claude' | 'codex' | 'both';
  error?: string;
} {
  const fallbackTarget = defaultSkillTarget();
  const idx = argv.indexOf('--target');
  if (idx === -1) {
    return { value: fallbackTarget };
  }

  const raw = argv[idx + 1];
  if (!raw || raw.startsWith('-')) {
    return {
      value: fallbackTarget,
      error: '--target 需要值，可选: claude | codex | both',
    };
  }

  if (raw !== 'claude' && raw !== 'codex' && raw !== 'both') {
    return {
      value: fallbackTarget,
      error: `--target 取值无效: ${raw}（可选: claude | codex | both）`,
    };
  }

  return { value: raw };
}

function isCodexRuntimeEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env['CODEX_THREAD_ID'] ||
    env['CODEX_SHELL'] ||
    env['CODEX_INTERNAL_ORIGINATOR_OVERRIDE'],
  );
}
