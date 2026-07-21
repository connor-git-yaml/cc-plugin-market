# Trace — F219 Spec Drift Production

[init] baseline=f7bd643 origin/master confirmed; feature 219 free; research_mode=skip (F189 prior-art substrate); node_modules healthy (zod/vitest via repo root)

[GATE_DESIGN] hard gate — user 拍板 3 clarifications:
  CL-1 lock 格式/位置 = JSON in .specify/ (零新依赖, 复用 JSON 栈)
  CL-2 建锚 UX = 独立引用清单文件 (F189 现状, M9-C 首发范围; spec 内标记扫描留 M10)
  CL-3 注释/JSDoc = 全不计入 (贴近 Fiberplane; normalized AST 只看结构+token, 忽略全部注释/JSDoc)
  → 三处 [NEEDS CLARIFICATION] 全部收敛; 更新 spec 定稿

[specify] spec.md v1 written (13 FR / 7 SC / 4 US)
[codex-review:spec] 4 CRITICAL + 9 WARNING (task-mruoyv6i-max3mi, session 019f84df)
  C1 状态机/退出码/repo:check 映射未闭合 → 加唯一状态矩阵
  C2 C2 接线可能静默 no-op + --strict 未贯通 (analyzeFiles async 漏 await)
  C3 check 未定义只读/不重绑 + graph 新鲜度 → 加 graph-stale + 精确 symbolId 查找
  C4 C3 canonical serialization 未定义 + Class.method 回退整 Class span 反例 SC-002
  W1 anchorId 稳定主键 / W2 fingerprintVersion / W3 文档侧存活 / W5 图 schema 逃生口冲突
  W6 零LLM/F217/12族具体检查点 / W7 SC-007 diff 基线不可靠 / W9 CLI 发布合同
  W4(JSDoc 条件句) + W8(TOML 依赖) 已被 gate 决策解决
[specify:revise] 已 SendMessage 回 specify 子代理收口全部 → 等待定稿

[specify:v2] spec 定稿 — 16 FR / 8 SC / 11 态状态矩阵 / 4 CRITICAL + 7 有效 WARNING 全收口
[fact-check] validateRepository(projectRoot) async 签名确认可扩展 {strict}; ts-js-adapter 独有 ExportSymbol span 确认 (MemberInfo 无 span → FR-009d 拒绝 member 成立)
