# F271 对抗审查档案（Codex 审查暂停，异构档位）

**档位**：Codex 配额耗尽期（CLAUDE.local.md 暂停节）。图产物面 + MCP 返回面按门禁类升档：**2 个独立异构切入角**，均为独立子代理、不给实现思路、只给"证伪"任务。另有主线程自审一轮（发现 R1 三处慢路径 hint 残留与 R2 目录参数示例失真，先行修复）。

## 角1：图产物正确性与污染面（实跑驱动 npx tsx 全链路复现）

| 档 | 发现 | 裁决 | 处置 |
|---|---|---|---|
| CRITICAL C1 | 同名符号撞 id first-wins → lineRange 指向被遮蔽的**死定义**（Python 双 def 实证：extraction 侧持 {4,5} 真身、unified 侧持 {1,2} 死代码、合流 unified 胜）；graph-builder 新注释「两侧同源等值」被实证证伪 | **修** | 同名条目 lineRange 取 **span 并集**（min/max），不动 F214 节点身份合同；合流两侧不等取并集；改写被证伪注释（修复轮 F1） |
| CRITICAL C2 | TS overload：first-wins 只留第一条签名行 (1,1)，函数体 (3,5) 丢失——FR-007"按 symbol 看定义"在 overload 导出上系统性缺函数体 | **修** | 同 F1（并集恰好覆盖实现体） |
| WARNING W1 | 消费端静默降级：member/旧图无 lineRange 时 view_file 返回整文件且零 warning | **修** | `lineRange-unavailable` warning（修复轮 F4a） |
| WARNING W2 | 图后文件变短：越界区间被 sliceLines 钳制后静默返回错误内容 | **修** | `lineRange-clamped` warning（F4b） |
| WARNING W3 | tree-sitter regex fallback 产恒 1 行假 span，无 provenance 标记 | **修** | 生产端按 `[REGEX] ` signature 前缀诚实缺席（F2） |
| INFO I1/I3 | 校验只查 typeof number（0/负/非整/start>end 放行）；两生产端防御不对称 | **修** | 统一 helper：isInteger ∧ ≥1 ∧ start≤end（F3） |
| INFO I2 | 增量 snapshot 新旧节点字段混合 | 记录不修 | snapshot 消费面（expandCallers/detect_changes）不读该字段；若未来 snapshot→graph 通道出现再显性化 |
| INFO I4 | 双路各自重读盘的运行中修改竞态 | 记录不修 | 窗口极小；并集修法后分歧不再静默 |

未构造出反例面（如实）：确定性（双跑 sha 相等 + normalizeGraphForWrite/stripVolatileFields 均不触 lineRange）；撞名以外的行号语义（装饰器/多行箭头/default/re-export/pyi/java/go 实测正确）；消费端崩溃（clamp 全吸收）。

## 角2：MCP 返回面 / 语义准确性 / 合同破坏面

| 档 | 发现 | 裁决 | 处置 |
|---|---|---|---|
| CRITICAL C1 | 本卡新写的 hyperedges「三前置、缺一即空」文案自身被代码证伪：README/module specs/project-context 都算文档源（`source-discovery.ts:108-122`，新项目首次 batch 即可产）；且有第四道闸 budget gate（`batch-orchestrator.ts:1322-1324`）与 LLM 提取成功与否 → 充要断言为假 | **修** | 改"启用条件清单 + 非充分"措辞，三处同步（describeEmptyHyperedges / 工具 description / plugins README）（修复轮 F6） |
| WARNING W1 | prepare 裸 catch 把 EACCES/ELOOP/ENAMETOOLONG 一律谎报 `file-not-found`——旧行为含糊但不撒谎，新行为精确且错误 | **修** | 仅 ENOENT/ENOTDIR 返 file-not-found，其余 rethrow 走脱敏兜底（F5） |
| WARNING W2 | Exit Codes 表两处失真：「never calls process.exit directly」被 watch/mcp-server/hook-installer 证伪；code-1 漏了 diff 漂移 / direction-audit 回归的"检查未通过"语义 | **修** | 文档修正（F7） |
| WARNING W3 | 护栏 `--init` 再生绕过判据且无留痕；存量图静默缺 lineRange 无任何提示 | **修（最小）** | collector-fingerprint.ts 不-bump 决定留痕注释 + fixture README 补记 + cli-reference 旧图重建提示（F8）；与角1 W1 的 `lineRange-unavailable` warning 呼应。护栏比较器 metadata 盲区本身 → dogfooding 账本候选（不在本卡修） |
| WARNING W4 | `scripts/sync-worktree-local-state.sh:693` 死胡同指引残留 | **修** | F7 |
| INFO 1 | prepare 前置校验 TOCTOU：竞态下仍落 internal-error | 记录不修 | 兜底行为正确；文档不写"保证" |
| INFO 2 | basename 边角（POSIX 收反斜杠路径回显整串）；前置校验构成存在性 oracle | 记录不修 | 本地 stdio 场景风险极低；prepare 历史上本无根边界，非新增面（spec Out of Scope 已单列 path-outside-root 议题） |
| INFO 3 | getCommunity 文案在"跑过 community 后重建抹掉 metadata"场景措辞不精确；graph-query.ts:73 docstring 旧文案残留 | docstring **修**（F7）；文案措辞保留 | 操作指引仍正确；重建即需重跑 community 是既有事实 |
| INFO 4 | `docs/scaffold-kb-guide.md:17`、`docs/repository-architecture.md:64` 仍写 17 tools | **修** | F7。telemetry.ts 注释与 F177 describe 标题为历史 feature 标题，保留（记录在案） |
| INFO 5 | plugins README 认证说明漏 panoramic-query（其 natural-language 无认证直接 throw） | **修** | F7 |
| INFO 6 | charter 快照用受控 -u 与"外科替换"协议偏离 | 已留痕 | implement-notes 有全量 diff 审计补偿记录（104 行=26 纯 lineRange 块，零删除） |
| INFO 7 | 用户可见行为变化未记 CHANGELOG/版本 | CHANGELOG **修**（F9）；版本 bump 留给 release 流程 | 与 G0-1 纪律对齐；版本号由 release-contract 流程统一管理，在 push 报告中列为后续步骤 |

未构造出反例面（如实）：退出码 2→1 无下游依赖旧值；hyperedges message 字段无严格 shape 消费方；README 参数名/18 工具/12 免认证核实为真（prepare 纯 AST 核实）；graph-quality 例外表与代码逐行一致；lineRange key 形状与消费端匹配。

## Delta 再审结论（F244 纪律，第三轮独立证伪，已执行）

独立子代理对 F1-F9 修复 diff 证伪，3 个构造攻击脚本实跑 + 148/1452 项测试全绿。**0 CRITICAL / 2 WARNING / 6 INFO**：

| 档 | 发现 | 裁决 | 处置 |
|---|---|---|---|
| W1 | 合流分支 merged=undefined 时 spread 保留 extraction 侧畸形原值（"不写新 key"≠"剥旧 key"）——`start:0` 可穿 typeof 闸、被 clamp 后伪装"图陈旧"误诊；收口点自己漏。仓内生产端已过闸不可达，但 `ExtractionResult.metadata` 是公开扩展面 | **修** | graph-builder 合流分支显式 delete + 补"extraction 侧畸形 + 合流"测试格（此前恰好没测这一格） |
| W2 | python-adapter 同名符号 metadata 从 last-wins 翻转为 first-wins——图可见行为变化，护栏语料无同文件同名样本零覆盖；"剥 lineRange 深等"审计证明不了折叠面等价 | **修（留痕）** | fixture README 再生记录补显式承认段；方向由 T-overload 探针钉死（双向 fail-loud，恰-1 断言同时防折叠失效/过头） |
| I1 | 带点 export 名（`export { x as "a.b" }`）可让 member 节点获得 lineRange，违反 FR-002 字面不变量——现有 parser 只产标识符名，仓内不可达；id 撞车是 F214 遗留 | 记录不修 | 未来解析器扩展字符串导出名时须回看；不在表面清扫范围 |
| I2 | 巨型并集 span 触发 payload-too-large 时 hint 对 symbolId-only 调用方是错误指引 | **修** | hint 补"改用显式 startLine/endLine 分段"一句 |
| I3 | getCommunity 存在性判据 `!== undefined` 与命中判据/getNode 的 string 口径不对称（`community: 0` 会误导"检查 ID"） | **修** | 镜像为 `typeof === 'string'` |
| I4 | ENOENT/ENOTDIR 白名单：ENOTDIR 语义准确；EINVAL/ELOOP 落 internal-error 是保守方向（含糊但不撒谎），非缺陷 | 记录不修 | 与注释自述一致 |
| I5 | 两个 warning 未构造出误报（clamp 无 defaultWindow 干扰、fuzzy 路径同 nodeToRange 无漏报，双向集成测试钉死） | 无需处置 | — |
| I6 | T-overload 探针可判别全部四种退化；残余盲区（顺序依赖实现在升序输入下与真并集等价）在可达输入上行为一致 | 记录 | 可接受 |

事实核对全部为真（"必要非充分"三条件逐条对上源码、唯一生产者、18 工具计数、exit 2→1 无消费方依赖、边 multiset 真等价而非护栏瞎——python 重复 contains 边在旧链路本就被 upsertEdge 折叠）。**Delta 再审对上一轮任务卡的一处前提亦做了纠正**：「护栏 pinned 资产没再生」与磁盘态不符（已 `--init` 再生并有 README 记录）。

W1/I2/I3 微修后复测：定向 120/120 绿，byte-stable 双跑 sha 相等（`0d27ed2e…07c76`，计数 7721/13145/2869 不变）。

> 质量审查（Phase 5b）唯一 WARNING「delta 再审未见执行痕迹」以本节为闭环证据。
