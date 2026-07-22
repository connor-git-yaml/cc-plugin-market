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

[graph] graph-only 重建 fresh (5928 节点, 3.5s) — 消 F217 freshness warning + 供 plan 子代理 MCP 查询
[plan] plan.md 583 行 — 7 文件架构(cli+6 lib)/动态 import dist 先例/自建 ts-morph Project 两阶段 C3/lock schema 顶层 schemaVersion/退出码表/12 节测试策略
  SPEC-CONFLICT×1: schemaVersion 顶层单字段裁决 (合理)
  graph-stale: 保留状态+合成 fixture、无端到端触发 (spec 条件从句不成立, 非违反)
  主线程 fact-check: ts-morph ^24.0.0 in deps ✓ / verify-feature-151 dist import 先例 ✓
[codex-review:plan] 后台运行中 — 重点: C3 序列化反例 / locateExportedNode declarations[0] 兜底 / dist 缺失→graph-unavailable 语义

[codex-review:plan] 7 CRITICAL + 6 WARNING (task-mrurv1p0-tyg90n, session 019f8529, 含实测 ts-morph@24 探针)
  C-1 link 无 graph 数据源 → 裁决: ref 强制 file-qualified (relPath::symbolName), 裸名→unresolved; link/check 对称现场解析
  C-2 序列化确定漏报: ±a/++a--a/a++a-- 同序列(operator 不在 forEachChild), const/let 同序列(flags 在父节点), overload 未聚合 → plan 补显式规则+强制 fixture
  C-3 declarations[0] 静默兜底算错 node → exportName+startLine+sourceFile 三元精确匹配, 0/多匹配→fingerprint-unavailable; re-export 显式拒绝
  C-4 parser-degrade 不可达(ts-morph 错误恢复不抛异常) → 用 syntactic diagnostics 判定; unsupported-language 按扩展名(startLine 必填,tree-sitter 也填,原判据错误)
  C-5 report 级 graph-unavailable 被 validateSpecDrift 静默丢失 → 先处理 report 级再遍历 anchors
  C-6 npm files 不含新 CLI → 裁决: drift:* 定位仓内工具(与 repo:check 同级既有模式), 不扩 files, plan 记录决策
  C-7 spec 自相矛盾: fingerprintVersion 归属 → 裁决: fingerprint-unavailable (US2-AC5/lock-corrupt next-step 删除该触发)
  W-1 graph-unavailable 语义 → "分析环境不可用", next-step 改 npm run build; W-2 JSDoc skip 死代码+字面值 getText 误报 → 断言无 JSDoc token+literal value 归一
  W-3 strict 子 check 硬编码 warn → strict 时 fail; W-4 退出码表漏 graph-unavailable; W-5 测试矩阵 11 态 table-driven+边界; W-6 schemaVersion 顶层归位
[spec:fix] 7 处外科修订派发 specify 子代理 (首次 sync 调用 API error 死亡, 无部分写入; 后台重试中)

[spec:fix] 7 处外科修订完成并验证 (9+/9- 行, US2-AC5/矩阵110-111-115/FR-001/FR-003/FR-011/FR-015/US1示例)
[plan:revise] 修订派发 plan 子代理 (自包含 13 项裁决清单 C-1~C-7 + W-1~W-6); 完成后跑 codex 复审 round-2, 通过后 spec 修订+plan 一并 commit
[plan:revise] 第 1 次(后台)与第 2 次(SendMessage 复活)均死于 API connection closed, plan.md 无部分写入; 第 3 次换全新代理自包含清单重派 — 符合 feedback_resumed_subagent_api_error_recovery 处置

[codex-review:plan] round-1 → 7 CRITICAL + 6 WARNING (task-mrurv1p0-tyg90n, session 019f8529)
  C-1 link 缺 graph 数据面 / C-2 序列化实测漏报(+a,-a;++a,--a;a++,a--;const,let)+overload
  C-3 declarations[0] 静默兜底 / C-4 parser-degrade 不可达+语言判据错 / C-5 report 级状态丢失
  C-6 发布包不含 CLI / C-7 fingerprintVersion 归属冲突
  W-1 dist 加载失败面 / W-2 JSDoc 死代码+格式误报 / W-3 strict 子check矛盾
  W-4 退出码漏 graph-unavailable / W-5 测试矩阵缺口 / W-6 字段校验只查四项
[plan:revise] inline 降级执行(3xTask 均 API 断连失败, 已留证)
  11 项修复 / C-6 部分驳回(核实 repo:check 同形态, FR-014 只要 npm run 入口)
  C-7+W-6 经 spec 侧修订消解
  plan 583->841 行; 新增 6.4 最小graph / 10.4 分发定位 / 修订记录表
[spec:surgical] 7 处外科修订(US2-AC5/状态矩阵2行/FR-003/FR-015/FR-001 file-qualified ref/US1)

[baseline:pre-implement] 建立 implement 前基线（commit d453f3f）
  npm run build: PASS (exit 0, dist 就位 — drift 动态 import 前置条件满足)
  npx vitest run: 5396 passed / 460 files passed / 1 failed
    ^ 唯一失败 tests/integration/graph-quality-adversarial.test.ts
      根因: runCLI 满载下子进程被饿死 → stdout 空 → JSON.parse 抛 SyntaxError
      隔离复跑 19/19 PASS (4.3s) → 定性为负载型 flaky, 非回归
      (与已知 cli-e2e --version 满载 flaky 同一模式)
  repo:check: PASS (pre-commit 钩子跑过, 含 F217 六指标逐项 pass — SC-007b 基线)
  => 任何 implement 后的新失败均可归因, 基线干净
[tasks] tasks.md 39 任务 (T001-T039) / 5 阶段+Polish / TDD 红绿配对
  C-2 四组防回归 fixture / 11 态矩阵 / npm run e2e / 零LLM两层 / 防静默no-op 全落任务

[codex-review:plan] round-2 (task-mrvrvmwa-vfe5tq, session 019f88c4)
  判定 9 CLOSED / 4 PARTIALLY-CLOSED / 0 NOT-CLOSED
  实测确认已闭合: C-2 四组哈希两两不等 / C-3 无残留兜底 / W-2 JSDoc 结论成立 / C-6 驳回理由事实成立
  新发现并已修:
    N-1 CRITICAL using 误序列化为 var (flags: using=4 落 var 分支同序列; await using=65542 含 Const bit 误标 const)
        -> declarationKeyword() 判定序 AwaitUsing->Using->Const->Let->var, AwaitUsing 全等比较
    N-2 BigInt 分隔符仍误报 stale (1000n vs 1_000n) -> 补 BigIntLiteral 归一
    N-3 .mts/.cts 漏列 (adapter 实为八种扩展) -> 支持集合对齐
    N-4 lock 示例用裸 ref 违反 FR-001 -> 改 file-qualified
    C-4 残留: getPreEmitDiagnostics 无法区分语法/类型错误(1109 与 2322 同为 Error)
        -> 改用 program.getSyntacticDiagnostics()
    W-1 残留: 我写的缓解"drift 位于既有 build 校验之后"是事实错误(validateRepository 无 build 步骤)
        -> 删除虚构缓解, dist 陈旧改判"已知未缓解"残留风险
    W-5 残留: SC-008 写入面/SC-007(d) 全量门禁无可执行落点 -> 落成 T036(a)(b)
    N-5 措辞: "完整 GraphJSON" -> "满足 query helper 的最小只读视图"
  独立复核: 本主线程自跑 ts-morph 探针确认 N-1 flags 与 N-3 扩展名属实, 未盲信

[GATE_TASKS] user 拍板: 三阶段一次做完(C1->C2->C3), 中间不交付不设门, 最后统一 verify + push report
  编排策略: 拆三次子代理委派(每阶段一次)以规避单代理超载 API 断连; 不改变用户选择的交付节奏
  graph freshness warn = 自身提交推进 HEAD 所致(specs/_meta/graph.json 未入库),
    留 T036 用 spectra batch --mode graph-only 重建; 入库的 F215 钉库 fixture 不得重生成
[implement:C1] 启动 T001-T020

[implement:C1] T001-T020 完成 (95 passed/3 todo, 全量 5490 passed/2 known-flaky, build 绿, SC-008 空)
  7 处 plan 偏差已回灌: matchKind 实测只 exact 可达(我 plan 原断言三值可产生=错误,已更正)
  distRoot 与 projectRoot 必须正交 / 依赖图补 resolve->fingerprint / manifest 仅 JSON
[codex-review:C1] 2 CRITICAL + 9 WARNING (task-mrvwq9dd-sw00yy)
  C1 manifest 校验不足: 数值 ref 抛未捕获异常 exit1(违反 exit2+JSON 合同);
     数值 id/对象 docPath/负 line 被写入 lock -> 工具自产 corrupt lock
  C2 refresh 对所有非 ok 态保留旧基线(FR-002 只许 ambiguous/unresolved),
     产生新失败 ref+旧 symbolId 混合记录 -> check 看旧 symbolId 可能报 fresh 掩盖失败;
     且 --refresh 可创建不存在的 id
  W1 report degraded 硬编码 false / 空 lock summary {} 
  W2 防重绑测试抓不住 fuzzy 回归  W3 11 态测试宽泛自证非逐列合同
  W4 原子写测试证明不了用 rename  W5 lock 不校验 id 唯一性与正整数 line
  W6 endLine 越过 EOF 不返 null(1..999 与 1..2 同哈希)  W7 路径穿越: ../ 可逃出 projectRoot
  W8 CLI 直执行判断 Windows 不成立  W9 CLI 参数校验松(--format xml 被接受等)

[fix:C1] Codex 11 项处置完成 (2 CRITICAL + 9 WARNING)
  源码: manifest 严格校验+写盘前 schema 自检 / refresh 仅 ambiguous|unresolved 保留且拒不存在 id
        + 保留写回完整旧记录 / 新建 spec-drift-paths.mjs containment 挡穿越(两处调用点)
        / endLine 越界返 null / line 正整数 + id 全局唯一 / 统一 buildReport 聚合 degraded
        / CLI 最外层兜底 exit2 不吐栈 / pathToFileURL 跨平台入口 / 参数严格校验
  测试(三条"抓不住回归"): W-2 静态依赖边界(含对照组证明有区分力)
        W-3 11态x7列字面值 toEqual 钉死 + 3 条派生不变量
        W-4 spy writeFileSync/renameSync 断言顺序与目标从未被直写 + EXDEV 残留 tmp 被判 corrupt
  测试数: 95 -> 168 passed | 3 todo
  主线程独立复核: 真实逃逸探针 ../outside.ts::secret -> fingerprint-unavailable(修复前为 fresh/exit0)
  代理反驳 1 条并给依据: W-9 "--id 非 refresh 模式禁用" 未必是真缺陷(选择性建锚是合法用法),
    已按指令实现并同步改 USAGE 保持文档行为一致; 放宽只需改 parseArgs 一行条件
  全量: 5563 passed / 2 failed(均已知负载 flaky: community-analysis perf, graph-quality-cli
        stdout 截断; 隔离复跑 21 passed 双绿) / build exit 0
