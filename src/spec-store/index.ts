/**
 * spec-store 模块统一导出入口
 *
 * 封装 SpecStore 类和 SpecSourceKind 类型，
 * 为所有消费方提供统一的 spec 集合查询接口。
 */
export { SpecStore, type IndexableModuleSpec, type SpecStoreOptions } from './spec-store.js';
export { getDefaultSourceKind, type SpecSourceKind } from './spec-identity.js';
