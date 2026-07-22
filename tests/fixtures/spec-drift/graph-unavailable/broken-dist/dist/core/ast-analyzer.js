// 【故意语法非法 —— 请勿"修好"它】
// 本文件是 spec-drift 的 graph-unavailable 场景 fixture：
// loadDistModule() 先 existsSync 判存在，再 await import()；只有"文件存在但导入抛错"
// 才会走到 catch 返回 dist-load-failed。若把语法改合法，用例会退化成 no-dist 的重复覆盖。
// 语法错误口径与 tests/unit/spec-drift-dist-loader.test.ts 的 broken-syntax.js 保持一致。
export const = ;;;
