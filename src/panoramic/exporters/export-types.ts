/**
 * 多格式导出相关类型定义
 * 供 obsidian-exporter.ts 和 html-exporter.ts 共同使用
 * 无运行时依赖，纯类型文件
 */

/** 支持的导出格式 */
export type ExportFormat = 'obsidian' | 'html';

/** 导出配置 */
export interface ExportConfig {
  /** 导出格式 */
  format: ExportFormat;
  /** 输出目录（绝对路径或相对于 cwd 的路径） */
  outputDir: string;
}

/** 导出结果 */
export interface ExportResult {
  /** 生成的文件路径列表（绝对路径） */
  files: string[];
  /** 生成文件总数 */
  fileCount: number;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

/** Obsidian 页面内容表示（内存中间状态，尚未写盘） */
export interface ObsidianPage {
  /** 相对于 outputDir 的文件路径（如 "communities/community-0.md"） */
  relativePath: string;
  /** 文件内容（Markdown 字符串） */
  content: string;
}
