// check fixture：纯 re-export 形态。
// 触发的目标状态：fingerprint-unavailable（reason=reexport-unsupported）。
// F221（spec 生成器识别 re-export）之后，analyzeFiles 会把本文件的导出如实返回为
// `{ name: 'reexportedSymbol', kind: 're-export' }`，符号存在性判定通过（不再落 orphaned），
// 于是 locateExportedNodes 在生产链路上真实可达并返回 reexport-unsupported。
// 本 fixture 守护：该形态 MUST 落 fingerprint-unavailable，绝不产出跨文件错误归属的指纹。
export { reexportedSymbol } from './other.js';
