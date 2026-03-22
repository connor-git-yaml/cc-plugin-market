/**
 * GeneratorRegistry — 全景文档化 Generator 注册中心（单例）
 *
 * 职责：
 * - 维护 Generator id 到 DocumentGenerator 实例的映射
 * - 提供按 id 查询、全量列出、按 ProjectContext 异步过滤的能力
 * - 检测 id 冲突（两阶段验证：格式校验 + 重复检测）
 * - 管理 Generator 的启用/禁用状态
 *
 * 设计决策：
 * - 继承 AbstractRegistry<DocumentGenerator, GeneratorEntry> 复用通用逻辑
 * - 单例模式参考 LanguageAdapterRegistry，保证全局唯一性
 * - 启用/禁用状态由 Registry 拥有（独立 Map），不修改外部 Generator 实例
 * - filterByContext 使用 Promise.resolve() 统一包装同步/异步 isApplicable
 * - Promise.allSettled() 实现并发执行和错误隔离
 *
 * 生命周期：进程级单例，CLI 和 MCP 入口各自在启动时通过 bootstrapGenerators() 完成注册。
 */

import type { z } from 'zod';
import type { DocumentGenerator, ProjectContext } from './interfaces.js';
import { GeneratorMetadataSchema } from './interfaces.js';
import { AbstractRegistry } from './abstract-registry.js';
import { MockReadmeGenerator } from './mock-readme-generator.js';
import { ConfigReferenceGenerator } from './config-reference-generator.js';
import { DataModelGenerator } from './data-model-generator.js';
import { WorkspaceIndexGenerator } from './workspace-index-generator.js';
import { CrossPackageAnalyzer } from './cross-package-analyzer.js';
import { ApiSurfaceGenerator } from './api-surface-generator.js';
import { InterfaceSurfaceGenerator } from './interface-surface-generator.js';
import { RuntimeTopologyGenerator } from './runtime-topology-generator.js';
import { EventSurfaceGenerator } from './event-surface-generator.js';
import { TroubleshootingGenerator } from './troubleshooting-generator.js';
import { ArchitectureOverviewGenerator } from './architecture-overview-generator.js';
import { ArchitectureIRGenerator } from './architecture-ir-generator.js';
import { PatternHintsGenerator } from './pattern-hints-generator.js';

// ============================================================
// GeneratorEntry 接口
// ============================================================

/**
 * list() 方法返回的只读数据视图
 * 包含 Generator 实例引用和当前启用/禁用状态
 */
export interface GeneratorEntry {
  /** Generator 实例引用（只读视图） */
  readonly generator: DocumentGenerator<any, any>;
  /** 当前启用/禁用状态 */
  readonly enabled: boolean;
}

// ============================================================
// GeneratorRegistry 类
// ============================================================

/**
 * Generator 的中心化注册中心
 * 维护 id 到 DocumentGenerator 实例的映射以及每个 Generator 的启用/禁用状态。
 * 进程级单例，全局唯一。
 */
export class GeneratorRegistry extends AbstractRegistry<DocumentGenerator<any, any>, GeneratorEntry> {
  /** 单例实例 */
  private static instance: GeneratorRegistry | null = null;

  private constructor() {
    super();
  }

  /**
   * 获取或创建 Registry 单例
   */
  static getInstance(): GeneratorRegistry {
    if (!GeneratorRegistry.instance) {
      GeneratorRegistry.instance = new GeneratorRegistry();
    }
    return GeneratorRegistry.instance;
  }

  /**
   * 重置单例（仅限测试使用）
   * 重置后下次 getInstance() 返回新的空白实例。
   */
  static resetInstance(): void {
    GeneratorRegistry.instance = null;
  }

  // ============================================================
  // AbstractRegistry 抽象方法实现
  // ============================================================

  protected getMetadataSchema(): z.ZodSchema {
    return GeneratorMetadataSchema;
  }

  protected extractMetadata(item: DocumentGenerator<any, any>): { id: string; name: string; description: string } {
    return {
      id: item.id,
      name: item.name,
      description: item.description,
    };
  }

  protected buildEntry(item: DocumentGenerator<any, any>, enabled: boolean): GeneratorEntry {
    return { generator: item, enabled };
  }

  // ============================================================
  // 重写方法（保持向后兼容的错误消息）
  // ============================================================

  /**
   * 切换 Generator 的启用/禁用状态
   * 重写基类方法以保持向后兼容的错误消息前缀
   */
  setEnabled(id: string, enabled: boolean): void {
    if (!this.items.has(id)) {
      throw new Error(`Generator '${id}' not found in registry`);
    }
    this.enabledState.set(id, enabled);
  }

  // ============================================================
  // 领域特有方法
  // ============================================================

  /**
   * 按项目上下文过滤适用的 Generator
   *
   * 处理逻辑：
   * 1. 跳过已禁用的 Generator
   * 2. 使用 Promise.resolve() 统一包装同步/异步 isApplicable 返回值
   * 3. 使用 Promise.allSettled() 并发执行所有 isApplicable 调用
   * 4. rejected 的 Promise 记录 console.warn 并跳过
   * 5. 收集 fulfilled 且值为 true 的 Generator，按注册顺序返回
   *
   * @param context - 项目上下文
   * @returns 适用且启用的 Generator 列表
   */
  async filterByContext(context: ProjectContext): Promise<DocumentGenerator<any, any>[]> {
    // 收集启用的 Generator 及其 isApplicable Promise
    const enabledGenerators: DocumentGenerator<any, any>[] = [];
    const applicableChecks: Promise<boolean>[] = [];

    for (const generator of this.itemOrder) {
      if (this.enabledState.get(generator.id) === false) {
        continue;
      }
      enabledGenerators.push(generator);
      // 使用 Promise 工厂包装，捕获同步 throw 和异步 rejection
      applicableChecks.push(
        new Promise<boolean>((resolve, reject) => {
          try {
            const result = generator.isApplicable(context);
            Promise.resolve(result).then(resolve, reject);
          } catch (err) {
            reject(err);
          }
        }),
      );
    }

    // 并发执行所有 isApplicable 检查
    const results = await Promise.allSettled(applicableChecks);

    // 收集结果
    const applicable: DocumentGenerator<any, any>[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const generator = enabledGenerators[i]!;
      if (result.status === 'rejected') {
        console.warn(
          `Generator '${generator.id}' 的 isApplicable() 抛出异常，已跳过:`,
          result.reason,
        );
        continue;
      }
      if (result.value === true) {
        applicable.push(generator);
      }
    }

    return applicable;
  }
}

// ============================================================
// bootstrapGenerators 幂等初始化函数
// ============================================================

/**
 * 启动 Generator 注册
 * 在 CLI/MCP 入口最早时机调用，完成所有内置 Generator 的注册。
 * 幂等：如果 Registry 已有 Generator 注册则跳过。
 */
export function bootstrapGenerators(): void {
  const registry = GeneratorRegistry.getInstance();

  // 幂等检查：非空则直接返回
  if (!registry.isEmpty()) {
    return;
  }

  registry.register(new MockReadmeGenerator());
  registry.register(new ConfigReferenceGenerator());
  registry.register(new DataModelGenerator());
  registry.register(new WorkspaceIndexGenerator());
  registry.register(new CrossPackageAnalyzer());
  registry.register(new ApiSurfaceGenerator());
  registry.register(new InterfaceSurfaceGenerator());
  registry.register(new RuntimeTopologyGenerator());
  registry.register(new ArchitectureOverviewGenerator());
  registry.register(new ArchitectureIRGenerator());
  registry.register(new PatternHintsGenerator());
  registry.register(new EventSurfaceGenerator());
  registry.register(new TroubleshootingGenerator());
}
