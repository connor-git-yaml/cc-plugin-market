# Codex 对抗审查 — 实现代码（implement phase）

日期：2026-06-14 | 3 CRITICAL + 8 WARNING + 5 INFO。主线裁决（影响判分公正/正确性的修，纯报告/极罕见的记录）：

| 编号 | 结论 | 裁决 | 处置 |
|------|------|------|------|
| C1 | 候选 model_patch apply 失败被判 error/fixture（应 fail/candidate）| 接受 | classify-oracle 行 5 加 `report==null` 门：harness 出 report 时信 report（patchApplied=false→resolved=false→行10 fail/candidate）|
| C2 | mcp-pull `.mcp.json` 等 scaffolding 混进候选 patch | 接受 | runner 候选 diff 加 pathspec exclude（.mcp.json / specs/_meta / *.log）|
| C3 | oracleSpecHash 未覆盖 swebench-dataset-build（W1 校验逻辑）| 接受 | SEMANTIC_MODULES 加 swebench-dataset-build.mjs + swebench_fetch_rows.py |
| W1 | per-instance report 覆盖 top-level 判定 | 接受 | top-level 有结果时 instEntry 不翻 resolved（只补 null）|
| W2 | 缺 tests_status 把 pass/fail 洗成 error（noTestsCollected 误触）| 接受 | noTestsCollected 加 `resolved===false` 门（resolved 时测试必跑过）|
| W3 | buildLocalDataset throw 逃出 OracleResult 合同 | 接受 | runSwebenchInstance try/catch dataset build → error/infra 结果 + stderr |
| W4 | 非 0 harness exit 时忽略已有 report | 接受 | 行 9-11 去掉 `harnessExitCode===0` 硬要求（行 1-8 已捕获 error code）|
| W5 | ENOBUFS（maxBuffer 溢出）未单独归因 | 接受 | runHarnessOnce 检测 ENOBUFS → 标记，分类归 error/infra |
| W6 | 极简 YAML `null`/`~` 解析成字符串 | 接受 | mini YAML parser 识别 null/~ → null |
| W7 | full 聚合 expectedRunCount 固定 *3 无视 manifest.repeat | 接受（报告口径）| expectedRunCount 用 effectiveRepeats |
| W8 | swebenchVersion null → hash 漂移/假放行 | 接受 | swebenchOracle 时 venv 版本读不到 hard-fail；路径锚 PROJECT_ROOT |
| I1-I5 | 正向确认（scaffolding 顺序/ranking 口径/registry 单源/throw 安全/docker 不静默 pass）| — | 无需动作 |
