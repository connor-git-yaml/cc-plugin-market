/**
 * F246 — 仓库根薄壳：入口守卫 helper 的 re-export。
 *
 * 只准 re-export，禁止复制实现（F241 T027a 教训：两处各写一份 `path.resolve` 比对的历史结果，
 * 是同一个符号链接 bug 在两边并存）。canonical 实现在 plugins 侧，方向只允许
 * 由仓库根 `scripts/` 指向 `plugins/<plugin>/scripts/`，禁止反向
 * （插件分发后脱离仓库根，反向 import 在生产环境路径不存在）。
 */
export { isInvokedDirectly } from '../../plugins/spec-driver/scripts/lib/is-invoked-directly.mjs';
