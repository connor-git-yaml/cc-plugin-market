// check fixture：纯 re-export 形态。
// 触发的目标状态：fingerprint-unavailable（reason=reexport-unsupported）。
// ⚠️ C1 阶段尚未引入 locateExportedNodes（plan 把它列在 T032/C3），
//    本 fixture 为 C3 预备；C1 侧只保证不产生错误归属的指纹。
export { reexportedSymbol } from './other.js';
