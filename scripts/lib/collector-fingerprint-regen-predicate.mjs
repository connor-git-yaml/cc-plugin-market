/**
 * F249 T041：再生脚本的**二元拒绝判据**纯函数（FR-005(e) / plan R4 防守项 9）。
 *
 * 为什么单独成模块而不内联进再生脚本：这条判据是整个护栏机制的核心安全语义
 * （"忘了 bump behaviorVersion 就不许更新 pinned 资产"）。内联在 200+ 行的脚本里，
 * 唯一的验证手段就只剩"跑整个脚本看退出码"，2×2 真值表无法逐格断言。抽成零依赖纯函数
 * 后，判据本身可被 2×2 穷举，脚本级测试只需再验"判据结论确实被脚本执行"。
 *
 * 为什么是 `.mjs` 而不是 `.ts`：与 `scripts/lib/` 下既有 helper（`graph-quality-core.mjs` 等）
 * 保持一致，可被 node 直接加载而不经 tsx/构建，判据不因构建产物陈旧而失真。
 */

/**
 * 是否拒绝本次再生（二元判据，无第三个维度）。
 *
 * ```
 * contentMismatch ∧ fingerprintUnchanged  → true （拒绝：重建内容变了但指纹没变 = 指纹不可见的行为漂移）
 * !contentMismatch                        → false（放行：内容一致，本次再生是 no-op）
 * !fingerprintUnchanged                   → false（放行：指纹已变，行为变更已被显式声明）
 * ```
 *
 * **`fixtureInputHash` 刻意不是本函数的入参**（Q1 处置）：它是纯诊断字段，只用于拒绝后的
 * 错误文案分流。把它接进判据会重新引入被 plan R2 否决的三元判据——"fixture 单独扩充自动放行"
 * 恰恰是本护栏要拦的场景之一（fixture 是护栏验证的行为契约基线，其变更同样需要 bump 留痕）。
 *
 * @param {{ contentMismatch: boolean, fingerprintUnchanged: boolean }} input
 *   `contentMismatch`：本轨重建产物与 pinned 期望是否不一致；
 *   `fingerprintUnchanged`：当前 `computeCollectorFingerprint()` 是否与 pinned 记录指纹相等。
 * @returns {boolean} `true` 表示 MUST 拒绝（非零退出、两份资产均不落盘）。
 */
export function shouldRejectRegen({ contentMismatch, fingerprintUnchanged }) {
  return contentMismatch && fingerprintUnchanged;
}
