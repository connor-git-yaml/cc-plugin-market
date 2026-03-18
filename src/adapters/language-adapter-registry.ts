/**
 * 语言适配器注册中心（单例）
 *
 * 职责：
 * - 维护文件扩展名到 LanguageAdapter 的映射（Map<string, LanguageAdapter>）
 * - 提供按文件路径查找适配器的能力（O(1) 查找）
 * - 聚合所有已注册适配器的元信息（支持的扩展名、忽略目录）
 * - 检测扩展名冲突（同一扩展名不允许被多个适配器注册）
 *
 * 生命周期：进程级单例，CLI 和 MCP 入口各自在启动时完成注册。
 */
import * as path from 'node:path';
import type { LanguageAdapter } from './language-adapter.js';

export class LanguageAdapterRegistry {
  /** 单例实例 */
  private static instance: LanguageAdapterRegistry | null = null;

  /** 扩展名 → 适配器映射（key 为小写扩展名，如 '.ts'） */
  private extensionMap: Map<string, LanguageAdapter>;

  /** 已注册适配器有序列表 */
  private adapterList: LanguageAdapter[];

  private constructor() {
    this.extensionMap = new Map();
    this.adapterList = [];
  }

  /**
   * 获取或创建 Registry 单例
   */
  static getInstance(): LanguageAdapterRegistry {
    if (!LanguageAdapterRegistry.instance) {
      LanguageAdapterRegistry.instance = new LanguageAdapterRegistry();
    }
    return LanguageAdapterRegistry.instance;
  }

  /**
   * 重置单例（仅限测试使用）
   * 重置后下次 getInstance() 返回新的空白实例。
   */
  static resetInstance(): void {
    LanguageAdapterRegistry.instance = null;
  }

  /**
   * 注册语言适配器
   *
   * 将适配器声明的所有扩展名映射到该实例。
   * 如果某个扩展名已被另一个适配器注册，抛出 Error。
   *
   * @param adapter - LanguageAdapter 实例
   * @throws Error 扩展名冲突时
   */
  register(adapter: LanguageAdapter): void {
    // 先检查所有扩展名是否冲突，避免部分注册
    for (const ext of adapter.extensions) {
      const normalizedExt = ext.toLowerCase();
      const existing = this.extensionMap.get(normalizedExt);
      if (existing) {
        throw new Error(
          `扩展名冲突: '${normalizedExt}' 已被适配器 '${existing.id}' 注册，` +
          `无法再注册到 '${adapter.id}'`,
        );
      }
    }

    // 无冲突，执行注册
    for (const ext of adapter.extensions) {
      const normalizedExt = ext.toLowerCase();
      this.extensionMap.set(normalizedExt, adapter);
    }
    this.adapterList.push(adapter);
  }

  /**
   * 根据文件路径查找对应的语言适配器
   *
   * 提取文件扩展名（path.extname），转为小写后在 Map 中查找。
   *
   * @param filePath - 文件路径（绝对或相对均可）
   * @returns 匹配的适配器实例，无匹配时返回 null
   */
  getAdapter(filePath: string): LanguageAdapter | null {
    const ext = path.extname(filePath).toLowerCase();
    return this.extensionMap.get(ext) ?? null;
  }

  /**
   * 获取当前所有已注册的文件扩展名
   */
  getSupportedExtensions(): Set<string> {
    return new Set(this.extensionMap.keys());
  }

  /**
   * 聚合所有已注册适配器的默认忽略目录
   */
  getDefaultIgnoreDirs(): Set<string> {
    const dirs = new Set<string>();
    for (const adapter of this.adapterList) {
      for (const dir of adapter.defaultIgnoreDirs) {
        dirs.add(dir);
      }
    }
    return dirs;
  }

  /**
   * 检查 Registry 是否为空（无任何已注册适配器）
   * 用于区分"Registry 未初始化"和"文件类型不支持"两种错误场景。
   */
  isEmpty(): boolean {
    return this.adapterList.length === 0;
  }

  /**
   * 获取所有已注册适配器列表（按注册顺序）
   */
  getAllAdapters(): readonly LanguageAdapter[] {
    return [...this.adapterList];
  }
}
