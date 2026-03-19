/**
 * AbstractRegistry<TItem, TEntry> — Registry 泛型基类
 *
 * 抽取 GeneratorRegistry 和 ArtifactParserRegistry 的共同逻辑：
 * - items Map：id -> TItem 映射
 * - enabledState Map：id -> boolean 启用/禁用状态
 * - itemOrder 数组：按注册顺序维护的有序列表
 * - 两阶段验证 register()：格式校验 + 冲突检测
 * - get() / list() / setEnabled() / isEmpty() 通用方法
 *
 * 子类职责：
 * - 各自管理 static instance 单例
 * - 提供 getMetadataSchema()、extractMetadata()、buildEntry() 抽象实现
 * - 扩展领域特有的查询方法（如 filterByContext、getByFilePattern）
 */
import type { z } from 'zod';

/**
 * Registry 泛型基类
 *
 * @typeParam TItem - 注册项的类型（如 DocumentGenerator、ArtifactParser）
 * @typeParam TEntry - list() 返回的只读数据视图类型（如 GeneratorEntry、ParserEntry）
 */
export abstract class AbstractRegistry<TItem, TEntry> {
  /** id -> 注册项实例映射 */
  protected items: Map<string, TItem> = new Map();

  /** id -> 启用/禁用状态映射 */
  protected enabledState: Map<string, boolean> = new Map();

  /** 按注册顺序维护的有序列表 */
  protected itemOrder: TItem[] = [];

  /**
   * 子类实现：返回用于验证注册项元数据的 Zod Schema
   */
  protected abstract getMetadataSchema(): z.ZodSchema;

  /**
   * 子类实现：从注册项中提取元数据供验证和冲突检测
   * 返回的对象至少包含 id 和 name 字段
   */
  protected abstract extractMetadata(item: TItem): { id: string; name: string; [key: string]: unknown };

  /**
   * 子类实现：根据注册项和启用状态构建 list() 返回的 Entry 对象
   */
  protected abstract buildEntry(item: TItem, enabled: boolean): TEntry;

  /**
   * 注册项实例
   *
   * 两阶段验证：
   * 1. Phase A — 使用 Zod Schema 验证元数据格式
   * 2. Phase B — 检查 id 冲突，已存在时抛出错误
   * 任一阶段失败均不修改内部状态。
   *
   * @param item - 注册项实例
   * @throws Error id 格式不符合 kebab-case 或已存在冲突时
   */
  register(item: TItem): void {
    const metadata = this.extractMetadata(item);
    const schema = this.getMetadataSchema();

    // Phase A: 使用 Zod Schema 验证元数据格式
    const parseResult = schema.safeParse(metadata);
    if (!parseResult.success) {
      throw new Error(
        `id 格式错误: '${metadata.id}' 不符合 kebab-case 格式（要求匹配 /^[a-z][a-z0-9-]*$/）`,
      );
    }

    // Phase B: 检查 id 冲突
    const existing = this.items.get(metadata.id);
    if (existing) {
      const existingMeta = this.extractMetadata(existing);
      throw new Error(
        `id 冲突: '${metadata.id}'（name: '${existingMeta.name}'）已注册，` +
        `无法再注册 '${metadata.id}'（name: '${metadata.name}'）`,
      );
    }

    // 提交：同时写入三个数据结构
    this.items.set(metadata.id, item);
    this.enabledState.set(metadata.id, true);
    this.itemOrder.push(item);
  }

  /**
   * 按 id 查询单个已注册的实例
   *
   * @param id - 唯一标识符
   * @returns 匹配的实例，未命中返回 undefined
   */
  get(id: string): TItem | undefined {
    return this.items.get(id);
  }

  /**
   * 全量列出所有已注册项及其启用/禁用状态
   * 返回新数组（防御性拷贝），按注册顺序排列
   *
   * @returns TEntry 数组
   */
  list(): TEntry[] {
    return this.itemOrder.map((item) => {
      const metadata = this.extractMetadata(item);
      const enabled = this.enabledState.get(metadata.id) ?? true;
      return this.buildEntry(item, enabled);
    });
  }

  /**
   * 切换注册项的启用/禁用状态
   *
   * @param id - 唯一标识符
   * @param enabled - 目标状态（true: 启用, false: 禁用）
   * @throws Error 指定 id 不存在时
   */
  setEnabled(id: string, enabled: boolean): void {
    if (!this.items.has(id)) {
      throw new Error(`'${id}' not found in registry`);
    }
    this.enabledState.set(id, enabled);
  }

  /**
   * 检查 Registry 是否为空（无任何已注册项）
   * 用于区分"未初始化"和"无适用项"两种状态。
   */
  isEmpty(): boolean {
    return this.itemOrder.length === 0;
  }
}
