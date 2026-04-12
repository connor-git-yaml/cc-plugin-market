/**
 * 文件监听核心模块
 * 封装 chokidar v4.x，提供 debounce、.gitignore 过滤和变更分类能力
 */

import { readFileSync, existsSync, watch as fsWatch } from 'node:fs';
import { resolve, extname, normalize, sep } from 'node:path';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 变更文件分类 */
export type ChangeCategory = 'code' | 'docs' | 'config';

/** 单个文件变更事件 */
export interface FileChangeEvent {
  /** 变更文件的绝对路径 */
  path: string;
  /** 文件类型分类 */
  category: ChangeCategory;
}

/** FileWatcher 初始化选项 */
export interface WatchOptions {
  /** 监听的项目根目录 */
  projectRoot: string;
  /** debounce 时长（毫秒），默认 3000 */
  debounceMs?: number;
  /** 是否打印详细日志 */
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// 扩展名分类映射
// ---------------------------------------------------------------------------

/** 代码文件扩展名集合 */
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.rb', '.php', '.c', '.cpp', '.h', '.cs',
]);

/** 文档文件扩展名集合 */
const DOC_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.rst', '.adoc',
]);

/** 配置文件扩展名集合 */
const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.env',
  '.ini', '.xml', '.lock',
]);

/** 内置默认忽略规则 */
const DEFAULT_IGNORED = ['.git', 'node_modules', 'dist', 'specs', '_meta'];

/** 控制台输出分类标签 */
export const CATEGORY_LABEL: Record<ChangeCategory, string> = {
  code: '[代码变更]',
  docs: '[文档变更]',
  config: '[配置变更]',
};

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 按文件扩展名判断变更分类
 */
export function classifyChange(filePath: string): ChangeCategory {
  const ext = extname(filePath).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (DOC_EXTENSIONS.has(ext)) return 'docs';
  if (CONFIG_EXTENSIONS.has(ext)) return 'config';
  // 默认归为代码变更
  return 'code';
}

/**
 * 读取并解析 .gitignore 文件，合并内置默认忽略规则
 * @param projectRoot 项目根目录
 * @returns 忽略规则字符串数组（用于 chokidar ignored 选项）
 */
export function loadIgnorePatterns(projectRoot: string): string[] {
  const gitignorePath = resolve(projectRoot, '.gitignore');
  const patterns = [...DEFAULT_IGNORED];

  if (existsSync(gitignorePath)) {
    const lines = readFileSync(gitignorePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // 跳过注释行和空行
      if (!trimmed || trimmed.startsWith('#')) continue;
      patterns.push(trimmed);
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// FileWatcher 类
// ---------------------------------------------------------------------------

/** 文件变更回调签名 */
type OnChangeCallback = (files: FileChangeEvent[]) => void;

/**
 * 文件监听器
 * 优先使用 chokidar v4.x；初始化失败时降级到 fs.watch 递归轮询（5 秒间隔）
 */
export class FileWatcher {
  private readonly projectRoot: string;
  private readonly debounceMs: number;
  private readonly verbose: boolean;
  private readonly ignoredPatterns: string[];

  // debounce 计时器
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // 待处理的变更文件集
  private pendingChanges: Set<string> = new Set();
  // 变更回调
  private onChange: OnChangeCallback;

  // chokidar watcher 或 fs.FSWatcher 实例（类型宽松以兼容两种后端）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private watcher: any = null;

  constructor(options: WatchOptions, onChange: OnChangeCallback) {
    this.projectRoot = options.projectRoot;
    this.debounceMs = options.debounceMs ?? 3000;
    this.verbose = options.verbose ?? false;
    this.ignoredPatterns = loadIgnorePatterns(options.projectRoot);
    this.onChange = onChange;
  }

  /**
   * 启动文件监听
   * 优先尝试 chokidar，失败时降级到 fs.watch
   */
  async start(): Promise<void> {
    try {
      await this.startChokidar();
    } catch (err) {
      console.warn('[watch] chokidar 初始化失败，降级到原生 fs.watch（轮询间隔 5 秒）');
      if (this.verbose) {
        console.warn('[watch] 降级原因:', err instanceof Error ? err.message : String(err));
      }
      this.startFsWatch();
    }
  }

  /**
   * 停止文件监听，清理计时器和 watcher
   */
  async stop(): Promise<void> {
    // 清理 debounce 计时器，避免泄漏
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChanges.clear();

    if (this.watcher) {
      // chokidar watcher 有 close() 方法（返回 Promise）
      // fs.FSWatcher 有 close() 方法（同步）
      try {
        const result = this.watcher.close();
        if (result instanceof Promise) {
          await result;
        }
      } catch {
        // 关闭时忽略错误
      }
      this.watcher = null;
    }
  }

  // ---------------------------------------------------------------------------
  // 私有方法
  // ---------------------------------------------------------------------------

  /**
   * 尝试使用 chokidar v4.x 启动监听
   * chokidar v4.x 是 ESM-only，必须用动态 import()
   */
  private async startChokidar(): Promise<void> {
    // 动态导入 chokidar（ESM-only 包，必须用 dynamic import）
    const chokidar = await import('chokidar');
    const watchFn = chokidar.watch ?? chokidar.default?.watch;

    if (typeof watchFn !== 'function') {
      throw new Error('chokidar.watch 不是函数，包版本可能不兼容');
    }

    this.watcher = watchFn(this.projectRoot, {
      ignored: this.ignoredPatterns,
      ignoreInitial: true,      // 启动时不触发已有文件的 add 事件
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    // 挂载文件变更事件（add/change/unlink）
    this.watcher.on('add', (filePath: string) => this.handleRawChange(filePath));
    this.watcher.on('change', (filePath: string) => this.handleRawChange(filePath));
    this.watcher.on('unlink', (filePath: string) => this.handleRawChange(filePath));

    // Task 2：挂载 error 事件处理器，防止未捕获异常导致进程 crash
    this.watcher.on('error', (err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[watch] 文件监听器错误: ${errMsg}`);
      if (this.verbose) {
        console.error(err);
      }
    });

    if (this.verbose) {
      console.log(`[watch] chokidar 启动，监听目录: ${this.projectRoot}`);
      console.log(`[watch] 忽略规则: ${this.ignoredPatterns.join(', ')}`);
    }

    // Task 3：等待 chokidar 完成初始目录扫描后再 resolve，保证 ready 后才打印"已就绪"
    await new Promise<void>((resolve) => {
      this.watcher.once('ready', resolve);
    });
  }

  /**
   * 降级到 fs.watch 递归模式
   * 用于 chokidar 初始化失败的情况
   */
  private startFsWatch(): void {
    // fs.watch 的 recursive 选项在 Node.js 20+ 全平台支持
    this.watcher = fsWatch(
      this.projectRoot,
      { recursive: true },
      (_eventType: string, filename: string | null) => {
        if (!filename) return;
        const fullPath = resolve(this.projectRoot, filename);
        // 简单过滤：检查路径是否包含忽略规则中的路径片段
        const normalizedFull = normalize(fullPath);
        const pathParts = normalizedFull.split(sep);
        const shouldIgnore = this.ignoredPatterns.some((pattern) => {
          // 去除尾部路径分隔符，取基础名称做路径分段匹配，避免 false-positive
          const patternBase = pattern.replace(/[/\\]+$/, '');
          return pathParts.includes(patternBase);
        });
        if (shouldIgnore) return;
        this.handleRawChange(fullPath);
      },
    );

    if (this.verbose) {
      console.log(`[watch] fs.watch 降级模式启动，监听目录: ${this.projectRoot}`);
    }
  }

  /**
   * 处理原始文件变更事件
   * 将文件加入 pendingChanges，并重置 debounce 计时器
   */
  private handleRawChange(filePath: string): void {
    this.pendingChanges.add(filePath);

    if (this.verbose) {
      console.log(`[watch] 检测到变更: ${filePath}`);
    }

    // 重置 debounce 计时器
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      // 快照当前变更集，清空内部状态
      const snapshot = new Set(this.pendingChanges);
      this.pendingChanges.clear();
      this.debounceTimer = null;

      // 构建 FileChangeEvent 数组并触发回调
      const events: FileChangeEvent[] = Array.from(snapshot).map((p) => ({
        path: p,
        category: classifyChange(p),
      }));

      this.onChange(events);
    }, this.debounceMs);
  }
}
