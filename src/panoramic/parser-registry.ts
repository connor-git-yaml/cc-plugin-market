/**
 * ArtifactParserRegistry — 非代码制品解析器注册中心（单例）
 *
 * 职责：
 * - 维护 Parser id 到 ArtifactParser 实例的映射
 * - 提供按 id 查询、全量列出、按文件路径匹配的能力
 * - 检测 id 冲突（两阶段验证：格式校验 + 重复检测）
 * - 管理 Parser 的启用/禁用状态
 *
 * 设计决策：
 * - 单例模式镜像 GeneratorRegistry，保证全局唯一性
 * - 启用/禁用状态由 Registry 拥有（独立 Map），不修改外部 Parser 实例
 * - getByFilePattern 使用简单的扩展名/文件名匹配（无外部依赖）
 *
 * 生命周期：进程级单例，CLI 和 MCP 入口各自在启动时通过 bootstrapParsers() 完成注册。
 */

import type { ArtifactParser } from './interfaces.js';
import { ArtifactParserMetadataSchema } from './interfaces.js';
import { SkillMdParser } from './parsers/skill-md-parser.js';
import { BehaviorYamlParser } from './parsers/behavior-yaml-parser.js';
import { DockerfileParser } from './parsers/dockerfile-parser.js';
import { YamlConfigParser } from './parsers/yaml-config-parser.js';
import { EnvConfigParser } from './parsers/env-config-parser.js';
import { TomlConfigParser } from './parsers/toml-config-parser.js';
import * as path from 'node:path';

// ============================================================
// ParserEntry 接口
// ============================================================

/**
 * list() 方法返回的只读数据视图
 * 包含 Parser 实例引用和当前启用/禁用状态
 */
export interface ParserEntry {
  /** Parser 实例引用（只读视图） */
  readonly parser: ArtifactParser<any>;
  /** 当前启用/禁用状态 */
  readonly enabled: boolean;
}

// ============================================================
// ArtifactParserRegistry 类
// ============================================================

/**
 * Parser 的中心化注册中心
 * 维护 id 到 ArtifactParser 实例的映射以及每个 Parser 的启用/禁用状态。
 * 进程级单例，全局唯一。
 */
export class ArtifactParserRegistry {
  /** 单例实例 */
  private static instance: ArtifactParserRegistry | null = null;

  /** id -> Parser 实例映射 */
  private parsers: Map<string, ArtifactParser<any>>;

  /** id -> 启用/禁用状态映射 */
  private enabledState: Map<string, boolean>;

  /** 按注册顺序维护的有序列表 */
  private parserOrder: ArtifactParser<any>[];

  private constructor() {
    this.parsers = new Map();
    this.enabledState = new Map();
    this.parserOrder = [];
  }

  /**
   * 获取或创建 Registry 单例
   */
  static getInstance(): ArtifactParserRegistry {
    if (!ArtifactParserRegistry.instance) {
      ArtifactParserRegistry.instance = new ArtifactParserRegistry();
    }
    return ArtifactParserRegistry.instance;
  }

  /**
   * 重置单例（仅限测试使用）
   * 重置后下次 getInstance() 返回新的空白实例。
   */
  static resetInstance(): void {
    ArtifactParserRegistry.instance = null;
  }

  /**
   * 注册 ArtifactParser 实例
   *
   * 两阶段验证：
   * 1. Phase A — 使用 ArtifactParserMetadataSchema 验证 id/name/filePatterns 格式
   * 2. Phase B — 检查 id 冲突，已存在时抛出错误
   * 任一阶段失败均不修改内部状态。
   *
   * @param parser - ArtifactParser 实例
   * @throws Error id 格式不符合 kebab-case 或已存在冲突时
   */
  register(parser: ArtifactParser<any>): void {
    // Phase A: 使用 Zod Schema 验证元数据格式
    const parseResult = ArtifactParserMetadataSchema.safeParse({
      id: parser.id,
      name: parser.name,
      filePatterns: [...parser.filePatterns],
    });

    if (!parseResult.success) {
      throw new Error(
        `Parser id 格式错误: '${parser.id}' 不符合 kebab-case 格式（要求匹配 /^[a-z][a-z0-9-]*$/）`,
      );
    }

    // Phase B: 检查 id 冲突
    const existing = this.parsers.get(parser.id);
    if (existing) {
      throw new Error(
        `Parser id 冲突: '${parser.id}'（name: '${existing.name}'）已注册，` +
        `无法再注册 '${parser.id}'（name: '${parser.name}'）`,
      );
    }

    // 提交：同时写入三个数据结构
    this.parsers.set(parser.id, parser);
    this.enabledState.set(parser.id, true);
    this.parserOrder.push(parser);
  }

  /**
   * 按 id 查询单个已注册的 Parser 实例
   *
   * @param id - Parser 唯一标识符
   * @returns 匹配的 Parser 实例，未命中返回 undefined
   */
  get(id: string): ArtifactParser<any> | undefined {
    return this.parsers.get(id);
  }

  /**
   * 全量列出所有已注册 Parser 及其启用/禁用状态
   * 返回新数组（防御性拷贝），按注册顺序排列
   *
   * @returns ParserEntry 数组
   */
  list(): ParserEntry[] {
    return this.parserOrder.map((parser) => ({
      parser,
      enabled: this.enabledState.get(parser.id) ?? true,
    }));
  }

  /**
   * 根据文件路径匹配适用的 Parser 列表
   *
   * 匹配策略（简单扩展名/文件名匹配，不引入外部 glob 依赖）：
   * - pattern 以 ** / 开头时：取 pattern 中最后一个 / 后的部分作为文件名匹配模式
   * - 支持 *.ext 格式：匹配文件扩展名
   * - 支持 .ext.* 格式：匹配以 .ext 开头的文件名（如 .env.local）
   * - 支持精确文件名匹配（如 Dockerfile）
   * - 支持 Filename.* 格式：匹配文件名前缀（如 Dockerfile.prod）
   *
   * 仅返回已启用的 Parser。
   *
   * @param filePath - 文件路径（绝对或相对）
   * @returns 适用的 Parser 列表
   */
  getByFilePattern(filePath: string): ArtifactParser<any>[] {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const result: ArtifactParser<any>[] = [];

    for (const parser of this.parserOrder) {
      if (this.enabledState.get(parser.id) === false) {
        continue;
      }

      for (const pattern of parser.filePatterns) {
        if (this.matchPattern(fileName, ext, pattern)) {
          result.push(parser);
          break; // 每个 Parser 最多匹配一次
        }
      }
    }

    return result;
  }

  /**
   * 切换 Parser 的启用/禁用状态
   *
   * @param id - Parser 唯一标识符
   * @param enabled - 目标状态（true: 启用, false: 禁用）
   * @throws Error 指定 id 不存在时
   */
  setEnabled(id: string, enabled: boolean): void {
    if (!this.parsers.has(id)) {
      throw new Error(`Parser '${id}' not found in registry`);
    }
    this.enabledState.set(id, enabled);
  }

  /**
   * 检查 Registry 是否为空（无任何已注册 Parser）
   * 用于区分"未初始化"和"无适用 Parser"两种状态。
   */
  isEmpty(): boolean {
    return this.parserOrder.length === 0;
  }

  /**
   * 简单的文件模式匹配
   * 不引入 minimatch 等外部依赖，使用扩展名和文件名匹配
   */
  private matchPattern(fileName: string, ext: string, pattern: string): boolean {
    // 移除 glob 前缀 **/ 或 **/
    const cleanPattern = pattern.replace(/^\*\*\//, '');

    // 精确匹配（如 SKILL.md, Dockerfile）
    if (!cleanPattern.includes('*')) {
      return fileName === cleanPattern;
    }

    // *.ext 格式（如 *.yaml, *.yml, *.toml）
    if (cleanPattern.startsWith('*.')) {
      const patternExt = cleanPattern.slice(1); // 包含 .
      return ext === patternExt;
    }

    // 文件名.* 格式（如 Dockerfile.*, .env.*）
    if (cleanPattern.endsWith('.*')) {
      const prefix = cleanPattern.slice(0, -2); // 去除 .*
      return fileName.startsWith(prefix + '.') || fileName === prefix;
    }

    // 其他模式降级为包含匹配
    return false;
  }
}

// ============================================================
// bootstrapParsers 幂等初始化函数
// ============================================================

/**
 * 启动 Parser 注册
 * 在 CLI/MCP 入口最早时机调用，完成所有内置 Parser 的注册。
 * 幂等：如果 Registry 已有 Parser 注册则跳过。
 */
export function bootstrapParsers(): void {
  const registry = ArtifactParserRegistry.getInstance();

  // 幂等检查：非空则直接返回
  if (!registry.isEmpty()) {
    return;
  }

  // 原有 3 个 Parser
  registry.register(new SkillMdParser());
  registry.register(new BehaviorYamlParser());
  registry.register(new DockerfileParser());

  // 新增 3 个配置 Parser
  registry.register(new YamlConfigParser());
  registry.register(new EnvConfigParser());
  registry.register(new TomlConfigParser());
}
