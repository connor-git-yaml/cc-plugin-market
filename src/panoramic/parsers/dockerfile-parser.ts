/**
 * DockerfileParser — Dockerfile 文件解析器
 *
 * 解析策略：
 * 1. 预处理——多行拼接：行尾 \ 续行符时将下一行拼接
 * 2. 过滤注释行（# 开头）和空行
 * 3. FROM 前 ARG 处理：第一个 FROM 之前的 ARG 作为全局 ARG，不归属 stage
 * 4. 多阶段检测：每个 FROM 开启新 stage
 * 5. 指令解析：匹配 /^(\w+)\s+(.*)/ 提取 type（大写化）和 args
 *
 * 容错降级：解析失败返回 { stages: [] }
 */
import { AbstractArtifactParser } from './abstract-artifact-parser.js';
import type { DockerfileInfo, DockerfileStage, DockerfileInstruction } from './types.js';

/** 指令匹配正则 */
const INSTRUCTION_RE = /^(\w+)\s+(.*)/;

/** FROM 指令匹配正则（含可选 AS alias） */
const FROM_RE = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/i;

/**
 * Dockerfile 文件解析器
 * 实现 ArtifactParser<DockerfileInfo> 接口
 */
export class DockerfileParser extends AbstractArtifactParser<DockerfileInfo> {
  readonly id = 'dockerfile' as const;
  readonly name = 'Dockerfile Parser' as const;
  readonly filePatterns = ['**/Dockerfile', '**/Dockerfile.*'] as const;

  /**
   * 从 Dockerfile 内容解析为结构化数据
   */
  protected doParse(content: string, _filePath: string): DockerfileInfo {
    // 空内容直接返回降级结果
    if (!content.trim()) {
      return this.createFallback();
    }

    try {
      // 步骤 1: 多行拼接
      const rawLines = content.split('\n');
      const joinedLines = this.joinMultilineInstructions(rawLines);

      // 步骤 2: 过滤注释和空行
      const effectiveLines = joinedLines.filter((line) => {
        const trimmed = line.trim();
        return trimmed !== '' && !trimmed.startsWith('#');
      });

      // 步骤 3 & 4: 逐行解析，处理 FROM 和其他指令
      const stages: DockerfileStage[] = [];
      let currentStage: DockerfileStage | null = null;

      for (const line of effectiveLines) {
        const trimmed = line.trim();

        // 检测 FROM 指令
        const fromMatch = FROM_RE.exec(trimmed);
        if (fromMatch) {
          // 开启新 stage
          currentStage = {
            baseImage: fromMatch[1]!,
            alias: fromMatch[2] || undefined,
            instructions: [],
          };
          stages.push(currentStage);
          continue;
        }

        // FROM 之前的指令（全局 ARG 等）不归属任何 stage
        if (!currentStage) continue;

        // 解析指令
        const instruction = this.parseInstruction(trimmed);
        if (instruction) {
          currentStage.instructions.push(instruction);
        }
      }

      return { stages };
    } catch {
      return this.createFallback();
    }
  }

  /**
   * 降级结果
   */
  protected createFallback(): DockerfileInfo {
    return { stages: [] };
  }

  /**
   * 多行拼接预处理
   * 遍历行，行尾 \ 时拼接下一行（去除 \ 本身和前后多余空格）
   */
  private joinMultilineInstructions(lines: string[]): string[] {
    const result: string[] = [];
    let buffer = '';

    for (const line of lines) {
      const trimmedRight = line.trimEnd();

      if (trimmedRight.endsWith('\\')) {
        // 行尾续行符：去除 \ 并追加到 buffer
        buffer += trimmedRight.slice(0, -1).trimEnd() + ' ';
      } else {
        // 无续行符：将 buffer + 当前行合并
        if (buffer) {
          result.push(buffer + trimmedRight.trimStart());
          buffer = '';
        } else {
          result.push(line);
        }
      }
    }

    // 处理尾部可能残留的 buffer
    if (buffer) {
      result.push(buffer.trimEnd());
    }

    return result;
  }

  /**
   * 解析单条指令
   * 匹配 /^(\w+)\s+(.*)/ 提取 type（大写化）和 args
   */
  private parseInstruction(line: string): DockerfileInstruction | null {
    const match = INSTRUCTION_RE.exec(line);
    if (!match) return null;

    return {
      type: match[1]!.toUpperCase(),
      args: match[2]!.trim(),
    };
  }
}
