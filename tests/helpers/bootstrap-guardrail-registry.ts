/**
 * F249 T039：护栏用 `LanguageAdapterRegistry` 生命周期 helper（plan 决策 8 / R4 防守项 5）。
 *
 * 为什么需要显式管理：`LanguageAdapterRegistry` 是**进程级单例**，而
 * `buildModuleGraphForProject` 的行为依赖它——registry 含 ts-js adapter 时走 `#7`
 * （adapter.extensions）路径，registry 为空时走 `#8`（`MODULE_DERIVATION_SCAN_SURFACE`
 * fallback）路径。若不显式钉死状态，护栏产物取决于"同一 worker 里此前哪个测试文件先跑过"，
 * 双轨对比就变成了对测试执行顺序的对比。
 *
 * 为什么护栏测试与再生脚本共用本文件：两侧对"registry 应处于什么状态"的理解必须逐字一致，
 * 否则 pinned 资产由 A 状态生成、护栏在 B 状态比对，产出的红是伪红（或更糟：产出永久假绿）。
 *
 * 为什么 `afterEach` 是 reset-to-empty 而非"重新标准 bootstrap"：对齐本仓既有惯例
 * （`tests/unit/batch-orchestrator.test.ts:71`）——由下一个用例的 `beforeEach` 负责建立它需要的
 * 状态，收尾只负责清空，不预先猜测下一个用例的需求。
 */
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';

/**
 * 主用例前置：清空 registry 后**只**注册 ts-js adapter（覆盖 `#7` 路径）。
 *
 * 为什么只注册 ts-js 而不 `bootstrapAdapters()` 全量注册：`buildModuleGraphForProject` 只查
 * `id === 'ts-js'` 的 adapter，其余 adapter 对 b-track 无影响；最小注册面让"哪个 adapter 影响了
 * 产物"这一问题在护栏失败时可直接回答。a-track（`buildAstGraphOnly`）的三个采集器均**不经
 * registry**（python/tsjs 走 source-discovery，java/go 走 generic collector 自带分析器），
 * 因此 registry 状态对 a-track 产物无影响。
 */
export function bootstrapGuardrailRegistryMain(): void {
  LanguageAdapterRegistry.resetInstance();
  LanguageAdapterRegistry.getInstance().register(new TsJsLanguageAdapter());
}

/**
 * fallback 用例前置：清空 registry 且**不注册任何 adapter**（覆盖 `#8` 空 registry fallback 路径）。
 *
 * 与 `resetGuardrailRegistry()` 的实现相同但语义不同——本函数表达"这个用例故意要空 registry"，
 * 收尾函数表达"清理现场"。保留两个名字是为了让用例读起来能区分意图，而非省一行代码。
 */
export function bootstrapGuardrailRegistryFallback(): void {
  LanguageAdapterRegistry.resetInstance();
}

/**
 * 收尾：把 registry 重置为空（reset-to-empty）。
 *
 * 主用例与 fallback 用例的 `afterEach` 均调用本函数；再生脚本在 `try/finally` 的 `finally`
 * 里同样调用，避免脚本被其他脚本 `import` 复用时泄漏进程级单例状态。
 */
export function resetGuardrailRegistry(): void {
  LanguageAdapterRegistry.resetInstance();
}
