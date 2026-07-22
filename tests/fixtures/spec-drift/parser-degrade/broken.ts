// check fixture：语法错误文件。
// 触发的目标状态：parser-degrade。
// ⚠️ ts-morph 采用错误恢复策略——本文件能成功创建 SourceFile 且不抛异常，
//    只是 getSyntacticDiagnostics 非空，因此判据 MUST 是「语法诊断非空」
//    而非「analyzeFiles 抛异常」（plan §9.1 步骤 4，C-4）。
export const brokenSymbol = ;
