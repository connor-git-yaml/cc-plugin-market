/**
 * CLI 参数解析器
 * 解析 process.argv，输出 CLICommand 对象
 */

/** CLI 命令结构 */
export interface CLICommand {
  subcommand: 'generate' | 'batch' | 'diff' | 'init' | 'prepare' | 'auth-status' | 'mcp-server' | 'panoramic' | 'cache' | 'watch' | 'graph' | 'community' | 'query' | 'install' | 'export' | 'direction-audit' | 'index';
  target?: string;
  specFile?: string;
  deep: boolean;
  force: boolean;
  /** 显式全量重生成（regen 轴逃生口，绕过增量 cache + checkpoint，仅 batch）；--force 为等义别名 */
  full?: boolean;
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
  /** --project-root 参数（panoramic / batch / export 子命令支持，未传时使用 process.cwd()） */
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
  /** mcp-server 子命令：是否启用 dev 热重载模式（--dev 或 SPECTRA_DEV=1） */
  mcpDev?: boolean;
  /** direction-audit 子命令：graph.json 路径（默认: specs/_meta/graph.json） */
  directionAuditGraph?: string;
  /** direction-audit 子命令：报告写入路径（可选） */
  directionAuditOutput?: string;
  /** direction-audit 子命令：输出格式 json|text（默认: text） */
  directionAuditFormat?: 'json' | 'text';
  /** direction-audit 子命令：生成 CI baseline 快照的路径 */
  directionAuditSnapshot?: string;
  /** direction-audit 子命令：对比快照路径；incorrect 增加时 exit 1 */
  directionAuditCompareSnapshot?: string;
  /** 启用 Markdown 文档 + API 规范提取（仅 batch 子命令）— Feature 107 */
  includeDocs?: boolean;
  /** 启用图像/图表 Vision 提取（仅 batch 子命令）— Feature 107 */
  includeImages?: boolean;
  /** export 命令目标格式（使用 exportFormat 避免与 query 的 format 冲突） */
  exportFormat?: 'obsidian' | 'html';
  /** batch 并发数（仅 batch 子命令，默认 3 = Feature 146 新默认；显式传 1 退化为顺序处理） */
  concurrency?: number;
  /** Feature 127: 仅预估模式（仅 batch 子命令） */
  dryRun?: boolean;
  /** Feature 127: batch 预算上限，超出触发 gate（仅 batch 子命令，与 query 的 budget 独立） */
  batchBudget?: number;
  /** Feature 127: 超预算时的非交互策略（仅 batch 子命令） */
  onOverBudget?: 'continue' | 'cheaper-model' | 'skip-enrichment' | 'cancel';
  /** F5：批处理运行模式（full | reading | code-only，默认 full）；F195 新增 graph-only（纯 AST / 零 LLM 建图） */
  batchMode?: 'full' | 'reading' | 'code-only' | 'graph-only';
  /** F5 Story 3：是否在知识图谱写盘后生成 graph.html 可视化文件 */
  generateHtml?: boolean;
  /** Feature 133（adversarial-review post-fix）：是否启用 hyperedge LLM 提取（--hyperedges） */
  hyperedgesEnabled?: boolean;
  /** Feature 135 Bug 1：是否显式启用 ADR pipeline（v4.0.1 临时禁用，用 --enable-adr 显式开启） */
  enableAdr?: boolean;
  /** Feature 156：spectra index 持续监听模式（FR-12） */
  indexWatch?: boolean;
  /** Feature 156：spectra index 单次增量更新（FR-30） */
  indexIncremental?: boolean;
  /** Feature 156：spectra index caller 扩展深度（OQ-2 / clarify Q3，默认 1） */
  indexCallerDepth?: number;
  /**
   * Feature 156 W4：spectra index --git-range，post-commit hook 上下文使用。
   * 仅在 --incremental 模式生效；white-list 校验仅允许预设格式（防注入）：
   *   'HEAD' / 'ORIG_HEAD HEAD' / 'HEAD~1 HEAD' 或 SHA-like
   */
  indexGitRange?: string;
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

  // direction-audit 子命令
  if (sub === 'direction-audit') {
    if (argv.includes('--help') || argv.includes('-h')) {
      return {
        ok: true,
        command: {
          subcommand: 'direction-audit',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
        },
      };
    }
    const graphIdx = argv.indexOf('--graph');
    const directionAuditGraph = graphIdx !== -1 ? argv[graphIdx + 1] : undefined;
    const outputIdx = argv.indexOf('--output');
    const directionAuditOutput = outputIdx !== -1 ? argv[outputIdx + 1] : undefined;
    const formatIdx = argv.indexOf('--format');
    const formatRaw = formatIdx !== -1 ? argv[formatIdx + 1] : undefined;
    const directionAuditFormat = formatRaw === 'json' ? 'json' : formatRaw === 'text' ? 'text' : undefined;
    const snapshotIdx = argv.indexOf('--snapshot');
    const directionAuditSnapshot = snapshotIdx !== -1 ? argv[snapshotIdx + 1] : undefined;
    const compareIdx = argv.indexOf('--compare-snapshot');
    const directionAuditCompareSnapshot = compareIdx !== -1 ? argv[compareIdx + 1] : undefined;
    return {
      ok: true,
      command: {
        subcommand: 'direction-audit',
        directionAuditGraph,
        directionAuditOutput,
        directionAuditFormat,
        directionAuditSnapshot,
        directionAuditCompareSnapshot,
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
    const projectRootIdx = argv.indexOf('--project-root');
    const projectRoot = projectRootIdx !== -1 ? argv[projectRootIdx + 1] : undefined;
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
        projectRoot,
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

  // mcp-server 子命令
  if (sub === 'mcp-server') {
    const mcpDev = argv.includes('--dev');
    return {
      ok: true,
      command: {
        subcommand: 'mcp-server',
        mcpDev,
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

  // index 子命令（Feature 156 — spectra index）
  if (sub === 'index') {
    if (argv.includes('--help') || argv.includes('-h')) {
      return {
        ok: true,
        command: {
          subcommand: 'index',
          deep: false, force: false, version: false, help: true,
          global: false, remove: false, skillTarget: defaultSkillTarget(),
        },
      };
    }
    const indexWatch = argv.includes('--watch');
    const indexIncremental = argv.includes('--incremental');
    if (indexWatch && indexIncremental) {
      return {
        ok: false,
        error: {
          type: 'invalid_option',
          message: '--watch 与 --incremental 互斥，不能同时使用',
        },
      };
    }
    const callerDepthIdx = argv.indexOf('--caller-depth');
    let indexCallerDepth: number | undefined;
    if (callerDepthIdx !== -1 && argv[callerDepthIdx + 1] !== undefined) {
      const parsed = parseInt(argv[callerDepthIdx + 1]!, 10);
      if (isNaN(parsed) || parsed < 0) {
        return {
          ok: false,
          error: {
            type: 'invalid_option',
            message: `--caller-depth 必须为非负整数，收到: ${argv[callerDepthIdx + 1]}`,
          },
        };
      }
      indexCallerDepth = parsed;
    }
    const projectRootIdx = argv.indexOf('--project-root');
    const projectRoot = projectRootIdx !== -1 ? argv[projectRootIdx + 1] : undefined;
    // --git-range（W4 T-036 / WARN-2 加固）：仅在 --incremental 时有效，并做 white-list 校验
    const gitRangeIdx = argv.indexOf('--git-range');
    let indexGitRange: string | undefined;
    if (gitRangeIdx !== -1 && argv[gitRangeIdx + 1] !== undefined) {
      const raw = argv[gitRangeIdx + 1]!;
      // 白名单：仅允许 SHA-like / HEAD 系列引用 + 单空格组合
      // 形式：<ref> 或 <ref> <ref>；ref ∈ /^[A-Za-z0-9_~^@/.-]+$/（且至少 1 字符）
      const REF_PATTERN = /^[A-Za-z0-9_~^@/.-]+$/;
      const parts = raw.trim().split(/\s+/);
      const valid =
        parts.length >= 1 &&
        parts.length <= 2 &&
        parts.every((p) => p.length > 0 && p.length <= 100 && REF_PATTERN.test(p));
      if (!valid) {
        return {
          ok: false,
          error: {
            type: 'invalid_option',
            message: `--git-range 格式不合法（仅允许 1~2 个 git ref，如 'HEAD' / 'ORIG_HEAD HEAD'），收到: ${raw}`,
          },
        };
      }
      indexGitRange = parts.join(' ');
    }
    return {
      ok: true,
      command: {
        subcommand: 'index',
        indexWatch,
        indexIncremental,
        indexCallerDepth,
        indexGitRange,
        projectRoot,
        deep: false, force: false, version: false, help: false,
        global: false, remove: false, skillTarget: defaultSkillTarget(),
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

  if (sub !== 'generate' && sub !== 'batch' && sub !== 'diff' && sub !== 'prepare' && sub !== 'auth-status' && sub !== 'mcp-server' && sub !== 'panoramic' && sub !== 'cache' && sub !== 'watch' && sub !== 'graph' && sub !== 'community' && sub !== 'query' && sub !== 'install' && sub !== 'export' && sub !== 'direction-audit' && sub !== 'index') {
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
  // F175 FR-003：--full 显式全量逃生口（regen 轴）；--force 为等义别名（向后兼容）
  const full = argv.includes('--full');
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
    if (argv.includes('--full')) explicitFlags.add('full');
    if (argv.includes('--incremental')) explicitFlags.add('incremental');
    if (languagesIdx !== -1) explicitFlags.add('languages');
    if (outputDirIdx !== -1) explicitFlags.add('outputDir');

    // Feature 107：多模态提取标志
    const includeDocs = argv.includes('--include-docs');
    const includeImages = argv.includes('--include-images');
    if (includeDocs) explicitFlags.add('includeDocs');
    if (includeImages) explicitFlags.add('includeImages');

    // 并发数（Feature 146）：--concurrency <N> 或 --concurrency=N
    // 默认值由 spec-driver.config.yaml batch.concurrency 或代码默认值 3 决定
    // 非数字 / 非有限值时返回 invalid_option 错误，而非静默回退
    let concurrency: number | undefined;
    const concurrencyIdxSpace = argv.indexOf('--concurrency');
    const concurrencyEqArg = argv.find((a) => a.startsWith('--concurrency='));
    let rawConcurrencyValue: string | undefined;
    if (concurrencyIdxSpace >= 0 && argv[concurrencyIdxSpace + 1] !== undefined) {
      rawConcurrencyValue = argv[concurrencyIdxSpace + 1];
    } else if (concurrencyEqArg !== undefined) {
      rawConcurrencyValue = concurrencyEqArg.slice('--concurrency='.length);
    }
    if (rawConcurrencyValue !== undefined) {
      const parsed = Number(rawConcurrencyValue);
      if (!Number.isFinite(parsed)) {
        return {
          ok: false,
          error: {
            type: 'invalid_option',
            message: `--concurrency 需要数字，实际: ${rawConcurrencyValue}`,
          },
        };
      }
      concurrency = parsed;
      explicitFlags.add('concurrency');
    }

    // F5：--mode flag 解析（full | reading | code-only）；F195 新增 graph-only
    // 支持两种写法：--mode reading 和 --mode=reading
    const isValidBatchMode = (
      value: string,
    ): value is NonNullable<CLICommand['batchMode']> =>
      value === 'full' ||
      value === 'reading' ||
      value === 'code-only' ||
      value === 'graph-only';
    const INVALID_MODE_MSG = (raw: string) =>
      `--mode 值必须是 full | reading | code-only | graph-only，实际: ${raw}`;
    let batchMode: CLICommand['batchMode'] | undefined;
    const modeIdxSpace = argv.indexOf('--mode');
    const modeEqArg = argv.find((a) => a.startsWith('--mode='));
    if (modeIdxSpace !== -1 && argv[modeIdxSpace + 1] !== undefined) {
      const rawMode = argv[modeIdxSpace + 1]!;
      if (isValidBatchMode(rawMode)) {
        batchMode = rawMode;
      } else {
        return {
          ok: false,
          error: { type: 'invalid_option', message: INVALID_MODE_MSG(rawMode) },
        };
      }
    } else if (modeEqArg !== undefined) {
      const rawMode = modeEqArg.slice('--mode='.length);
      if (isValidBatchMode(rawMode)) {
        batchMode = rawMode;
      } else {
        return {
          ok: false,
          error: { type: 'invalid_option', message: INVALID_MODE_MSG(rawMode) },
        };
      }
    }

    // Feature 140 T18：graph.html 默认生成（FR-011 始终生成）。`--html` 旧 flag 仍兼容
    // （等价于显式 true），新增 `--no-html` 用于 CI / 资源紧张场景显式 opt-out。
    // 解析顺序：`--no-html` 优先 → 显式 false；`--html` 显式 true；都未指定 → undefined
    // （batch-orchestrator 用 `?? true` 默认生成）。
    const generateHtml: boolean | undefined = argv.includes('--no-html')
      ? false
      : argv.includes('--html')
        ? true
        : undefined;

    // Feature 133（adversarial-review post-fix）：--hyperedges flag — 显式 opt-in
    // hyperedge LLM 提取（默认 false，避免对所有 batch 静默触发额外 Anthropic 调用）
    const hyperedgesEnabled = argv.includes('--hyperedges') || undefined;

    // Feature 135 Bug 1：--enable-adr flag — 显式 opt-in ADR pipeline
    // ADR pipeline 在 v4.0.1 临时禁用（默认 false），用 --enable-adr 显式开启
    const enableAdr = argv.includes('--enable-adr') || undefined;

    // Feature 127: dry-run / budget / on-over-budget
    const dryRun = argv.includes('--dry-run');
    const batchBudgetIdx = argv.indexOf('--budget');
    let batchBudget: number | undefined;
    if (batchBudgetIdx !== -1 && argv[batchBudgetIdx + 1] !== undefined) {
      const parsed = parseInt(argv[batchBudgetIdx + 1]!, 10);
      if (!isNaN(parsed) && parsed > 0) batchBudget = parsed;
    }
    const onOverBudgetIdx = argv.indexOf('--on-over-budget');
    let onOverBudget: CLICommand['onOverBudget'];
    if (onOverBudgetIdx !== -1 && argv[onOverBudgetIdx + 1] !== undefined) {
      const raw = argv[onOverBudgetIdx + 1]!;
      if (
        raw === 'continue' ||
        raw === 'cheaper-model' ||
        raw === 'skip-enrichment' ||
        raw === 'cancel'
      ) {
        onOverBudget = raw;
      } else {
        return {
          ok: false,
          error: {
            type: 'invalid_option',
            message: `--on-over-budget 值必须是 continue | cheaper-model | skip-enrichment | cancel，实际: ${raw}`,
          },
        };
      }
    }

    return {
      ok: true,
      command: {
        subcommand: 'batch',
        target: positional[0], // batch 目标目录（可选，默认 cwd）
        deep: false,
        force,
        full: full || undefined,
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
        // Feature 146：保留显式传入值（含 0/负数），由 runBatch 内部统一规范化（FR-002）
        concurrency,
        dryRun: dryRun || undefined,
        batchBudget,
        onOverBudget,
        batchMode,
        generateHtml,
        hyperedgesEnabled,
        enableAdr,
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
      if (args[i] === '--output-dir' || args[i] === '--target' || args[i] === '--languages' || args[i] === '--project-root' || args[i] === '--generator' || args[i] === '--debounce' || args[i] === '--min-size' || args[i] === '--budget' || args[i] === '--format' || args[i] === '--concurrency' || args[i] === '--on-over-budget' || args[i] === '--graph' || args[i] === '--output' || args[i] === '--snapshot' || args[i] === '--compare-snapshot' || args[i] === '--mode' || args[i] === '--caller-depth' || args[i] === '--git-range') {
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
