/**
 * 多格式输出工具函数
 *
 * 根据 OutputFormat 决定写出哪些文件格式：
 * - 'markdown': 仅写 .md
 * - 'json': 仅写 .json（JSON.stringify 结构化数据）
 * - 'all': 写 .md + .json + 条件 .mmd（如有 Mermaid 源码）
 *
 * 输出目录自动创建（mkdirSync recursive）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OutputFormat } from '../interfaces.js';

/**
 * 多格式输出选项
 */
export interface WriteMultiFormatOptions {
  /** 输出目录绝对路径 */
  outputDir: string;
  /** 基础文件名（不含扩展名，如 'data-model'） */
  baseName: string;
  /** 输出格式控制 */
  outputFormat: OutputFormat;
  /** render() 返回的 Markdown 字符串 */
  markdown: string;
  /** generate() 返回的 TOutput 结构化数据 */
  structuredData: unknown;
  /** 可选的 Mermaid 图源码 */
  mermaidSource?: string;
  /** 可选的额外文件（仅在 all 模式写出） */
  extraFiles?: AdditionalOutputFile[];
}

export interface AdditionalOutputFile {
  /** 自定义文件名（优先级高于 extension） */
  fileName?: string;
  /** 基于 baseName 的扩展名，如 dsl -> {baseName}.dsl */
  extension?: string;
  /** 文件内容 */
  content: string;
}

/**
 * 根据 outputFormat 写出多格式文件
 *
 * 处理逻辑：
 * 1. 'markdown' → 仅写 {baseName}.md
 * 2. 'json' → 仅写 {baseName}.json（JSON.stringify(structuredData, null, 2)）
 * 3. 'all' → 写 .md + .json；若 mermaidSource 非空且非空字符串，还写 {baseName}.mmd
 * 4. 创建输出目录（mkdirSync recursive）
 * 5. 返回实际写出的文件路径列表
 *
 * @param options - 多格式输出选项
 * @returns 实际写出的文件绝对路径列表
 */
export function writeMultiFormat(options: WriteMultiFormatOptions): string[] {
  const {
    outputDir,
    baseName,
    outputFormat,
    markdown,
    structuredData,
    mermaidSource,
    extraFiles = [],
  } = options;
  const writtenFiles: string[] = [];

  // 确保输出目录存在
  fs.mkdirSync(outputDir, { recursive: true });

  // Markdown 文件路径
  const mdPath = path.join(outputDir, `${baseName}.md`);
  // JSON 文件路径
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  // Mermaid 文件路径
  const mmdPath = path.join(outputDir, `${baseName}.mmd`);

  if (outputFormat === 'markdown') {
    // 仅写 .md
    fs.writeFileSync(mdPath, markdown, 'utf-8');
    writtenFiles.push(mdPath);
  } else if (outputFormat === 'json') {
    // 仅写 .json
    fs.writeFileSync(jsonPath, JSON.stringify(structuredData, null, 2), 'utf-8');
    writtenFiles.push(jsonPath);
  } else if (outputFormat === 'all') {
    // 写 .md
    fs.writeFileSync(mdPath, markdown, 'utf-8');
    writtenFiles.push(mdPath);

    // 写 .json
    fs.writeFileSync(jsonPath, JSON.stringify(structuredData, null, 2), 'utf-8');
    writtenFiles.push(jsonPath);

    // 写 .mmd（条件：mermaidSource 存在且非空字符串）
    if (mermaidSource && mermaidSource.trim().length > 0) {
      fs.writeFileSync(mmdPath, mermaidSource, 'utf-8');
      writtenFiles.push(mmdPath);
    }

    for (const extraFile of extraFiles) {
      if (extraFile.content.trim().length === 0) {
        continue;
      }

      const targetFileName = extraFile.fileName
        ?? (extraFile.extension ? `${baseName}.${extraFile.extension}` : undefined);
      if (!targetFileName) {
        continue;
      }

      const targetPath = path.join(outputDir, targetFileName);
      fs.writeFileSync(targetPath, extraFile.content, 'utf-8');
      writtenFiles.push(targetPath);
    }
  }

  return writtenFiles;
}
