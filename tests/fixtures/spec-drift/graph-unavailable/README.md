# graph-unavailable fixture

两个子场景，均触发 report 级 `graph-unavailable`（machineCode `DRIFT_GRAPH_UNAVAILABLE`，`degraded: true`）：

| 子目录 | 触发路径 | loader reason |
|--------|---------|---------------|
| `no-dist/` | 作为 `distRoot` 传入时不含 `dist/` 目录 | `dist-missing` |
| `broken-dist/` | `dist/core/ast-analyzer.js` 存在但语法非法，`await import()` 抛错 | `dist-load-failed` |
