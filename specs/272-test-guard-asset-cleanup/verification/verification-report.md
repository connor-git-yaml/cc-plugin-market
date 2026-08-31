# F272 验收报告

- **基线 commit**：`f7a65aa9`
- **分支**：`claude/test-guard-asset-cleanup-6b29b3`
- **模式**：spec-driver story（5 阶段）
- **审查档位**：守护资产类 → **异构对抗 ×2 切入角**（Codex 配额暂停期替代档位）
- **日期**：2026-08-31

---

## 1. 门禁结果（编排器亲自执行，不采信子代理报告）

| 命令 | 结果 |
|---|---|
| `npm run build` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| `npx vitest run` | **exit 0** · `Test Files 540 passed \| 4 skipped (544)` · `Tests 7896 passed \| 15 skipped \| 12 todo (7923)` · **0 failed / 0 unhandled error** · 64.62s |
| `npm run repo:check` | **status=pass**（零 warning / 零 error） |
| `npm run test:plugins` | `tests 1585 / pass 1583 / fail 0 / skipped 2` |
| `npm run release:check` | exit 0（`publish-gap indeterminate` 是 npm registry 缺 `gitHead` 的既存限制，非本卡引入） |

### 与改动前基线对照（`baseline-before.md`）

| 指标 | 改动前 | 改动后 | 说明 |
|---|---|---|---|
| Test Files | 2 failed \| 536 passed \| 4 skipped (542) | **0 failed** \| 540 passed \| 4 skipped (544) | +2 文件 = 两道新守卫 |
| Tests | 2 failed \| 7892 passed \| 18 skipped \| **21 todo** | 0 failed \| 7896 passed \| 15 skipped \| **12 todo** | todo 换算见 §4 |
| Unhandled Errors | **1**（birpc 60s 超时） | **0** | |
| Duration | 407.91s | 64.62s | |

### ⚠️ 一次满载假红及其判定过程（如实记录）

在**有子代理并发 + 本机反复休眠**的环境下跑过两次全量，分别得到 `7 failed` 与 `9 failed`，
耗时 828s / 更长（对照干净跑批 64.6s，**13× 拖慢**），并伴随 5-6 个
`[vitest-worker]: Timeout calling "onTaskUpdate"`——即 F235/F269 已登记的 birpc 假红签名。

按满载 flake 判定协议逐条核对：

| 判据 | 结果 |
|---|---|
| 隔离重跑全绿 | ✅ 9 个失败文件隔离下 **362 用例全通过**（100/100 + 262/262） |
| 与本卡改动零交集 | ✅ **9 个失败文件无一在本卡写入面内** |
| 干净环境复跑 | ✅ 停掉全部子代理后 `vitest exit=0`，0 failed |

⇒ 判定为满载假红，**非回归**。上表的 `0 failed` 取自干净环境跑批。

### 改动前基线里的 2 个失败：新发现的负载敏感 flaky

`tests/unit/graph-bootstrap-status.test.ts` 与 `tests/unit/sync-worktree-local-state.test.ts`
在**零改动的基线 commit** 上满载即红、隔离全绿，且**不在**仓库预存 flaky 清单
（`watch-command` / `batch-orchestrator-incremental` / `community-analysis` perf / `cli-e2e --version`）内。
本卡不修（不属七项），已登记并另开跟进卡。

---

## 2. 七项处置结果

| 项 | 处置 | 关键证据 |
|---|---|---|
| ① qa 陈旧副本 | 删 8 文件 + 移植 2 条 + 删 1 条恒真 it + **新增零执行守卫** | `tests/panoramic/qa` 84 用例全绿；全仓零执行测试文件差集 = 白名单 |
| ② Layer B self-dogfood 块 | 删块 + 外科式删 2 条孤儿快照（10→8） | `graph-mcp-snapshot.test.ts` 由 `11 passed \| 2 skipped` 变 `11 passed \| 0 skipped` |
| ③ typecheck:tests 接 CI | 新增 `Type Check Tests` 步骤（**修复轮移到 `Release Check` 之后**） | 三份类型资产变异均能翻红；F170c 补上 TS18003 存在性守卫 |
| ④ pinned graph 陈旧 | 四份全部重生成 + `expectedEdgeCount: 11→14` + **新增陈旧守卫（全字段深比较）** | 属性污染（不动 id/边三元组）现在会红并定位到字段路径 |
| ⑤ regen 丢弃 differences | 放行分支打印 + 新增双变量场景端到端用例 | 删掉打印后新用例翻红 |
| ⑥ it.todo | 10 删 + docblock / 10 保留改写理由 / 1 转普通注释 | 全仓 todo 21 → 12（含 ⑦-B1 转入 2 条） |
| ⑦ 虚化断言 | B 类 35 条坐标全处置 / **A 类 64 条清单入库移交** | `inventory-item7.md` 带精确坐标与处置建议 |

### 三项裁决（卡面要求"给裁决理由"）

- **①：删 + 移植，不是修**。裁决被**两次实证翻转**——卡面说"死代码、10/10 失败"，第一轮复核证伪
  （qa 是活代码、79 用例 69 绿）；第二轮复核发现 `tests/panoramic/qa/` 有**在跑的同名副本**
  （8 文件 83 用例全绿，git 历史显示它才是收过 post-review 修复的那份）。src 侧的 3 条独有用例里，
  2 条移植（其中「包含 technical debt」经变异测试证明**不可替代**——删掉实现的 `technical\s*debt`
  分支后 `tests/` 侧 6 条全绿、只有它会红），1 条不移植（`llm-caller` 那条名实不符，注释自认验不了）
- **②：删，不重建**。重建需把 6.5 MB / 7708 节点的 self-dogfood 图冻结入库，与本卡 ④ 实证的
  "pinned 图会静默陈旧"直接冲突；改用 live 图则无先例（实证无任何 vitest 测试消费本仓自身
  `specs/_meta/graph.json`）且 snapshot 会每 commit churn。其覆盖面已由 Layer B MVP、
  lang-matrix 四语言真实图、micrograd 真实 Python 图等价覆盖
- **⑥：按"断言对象是不是 LLM 语义产出"三分**，不是一刀切。10 条断言 ADR 内容/hyperedge 计数
  （LLM 产出，mock 后恒真）→ 永久删 + docblock 记录；10 条断言纯函数 banner / 日志 / 截断 /
  prompt 入参（不依赖 LLM 输出）→ 保留并改写为真实阻塞理由 + 移交；1 条 `it.todo` 误用
  （承载豁免记录）→ 改普通注释

---

## 3. 变异验证（守护力证明，卡面硬约束）

三道新守卫 + ⑤ + ⑦ B 类各子类均做过变异验证。编排器**亲自复验**的四处：

| 守卫 | 变异体 | 结果 |
|---|---|---|
| ④ pinned 陈旧（深比较） | go pinned 改 `nodes[0].kind` + `graph.fingerprint.behaviorVersion`，**不动 id 与边三元组** | 红，且差异明细精确到 `graph.fingerprint.behaviorVersion: 值不一致（重建 3 vs pinned 999）` / `nodes[0].kind: …` |
| ① 零执行守卫 | 造 `src/panoramic/qa/zzz-orphan-probe.test.ts` | 红且点名该路径 |
| ① 零执行守卫（反向） | 造 `.claude/worktrees/zzz-probe-wt/tests/unit/probe.test.ts`（被 gitignore） | **绿**（不误报） |
| ① 零执行守卫（幽灵文件） | 当前工作区有 8 个未 stage 的删除 | **绿**（`git ls-files` 会列出它们，靠磁盘存在性过滤兜住） |
| ③ F170c 存在性 | 移走 `feature-170c-enrichment-optional.test-d.ts` | 报 `TS18003`（修复前此场景**静默 exit 0**） |

---

## 4. 数字换算（本卡的数量口径已被改错三次，此处为最终重算）

### todo 计数

```
21（基线，.test.ts/.test.mjs 内的 it.todo 调用点，与基线跑批的 "21 todo" 逐字吻合）
− 10（⑥：结构性不可填充，删除 + docblock 记录）
−  1（⑥：误用，改普通注释）
+  2（⑦-B1：占位断言 expect(true).toBe(true) 转为诚实的 it.todo）
= 12（全仓 vitest 报告值，已实测）
```
其中 **⑥ 名下保留 10 条**（graph-html 4 + include-docs 3 + empty-project 3）。

### ⑦ B 类条目

```
35（坐标条目，单位 = 一行「文件:行号」或一个行区间，非断言语句行数）
=  32（批 C-⑦ 处置）
+   1（批 A 顺带处置：tests/panoramic/qa/index.test.ts）
+   2（随 ① 删除 src/panoramic/qa/__tests__/ 自动消失）
```

### `tests/panoramic/qa/` 用例数

```
83（改动前）+ 2（移植）− 1（删除的恒真 durationMs 独立 it）= 84（已实测）
```

---

## 5. 异构对抗审查结论（守护资产类档位）

> **Codex 审查暂停（配额耗尽），异构档位缺席** —— 按 `CLAUDE.local.md` 暂停期约定，
> 改用独立 `general-purpose` 子代理异构对抗，2 个切入角，**不给实现思路、只给证伪任务**。

| 切入角 | 结论 |
|---|---|
| **守护力虚化面** | **3 CRITICAL + 5 WARNING**（全部已修，见下） |
| **误删在用资产面** | **0 CRITICAL** —— "未发现覆盖损失"；但抓到 **2 处论据错误**（结论对、理由错），已修正 |

### CRITICAL（全部已修 + 编排器复验）

1. **pinned 陈旧守卫只比 id 与边三元组**，`kind`/`metadata`/`confidence`/`fingerprint.behaviorVersion`/
   `extensionSurface` 全不比——而 F249 collector 指纹恰是该资产陈旧的核心信号。
   → 改为**全字段深比较，排除 `graph.builder`**（它跟踪宿主 commit/dist，F261 D1「builder 戳只可见不判定」）。
   连带发现 **java/go/python 三份 pinned 在元数据层面同样陈旧**（缺 `fingerprint`/`builder`），一并重生成
2. **零执行守卫扫描进 `.claude/worktrees/`**（`.gitignore:75` 已登记）——主仓现有 **4 个 worktree、2194 个
   `.test.ts`**，本卡合并后主仓跑守卫会报 2194 条假阳性，且诊断说"未被 include 收集"与事实相反。
   → 磁盘侧改用 `git ls-files`（tracked ∪ untracked-not-ignored）**+ 磁盘存在性过滤**（编排器追加发现：
   `git ls-files` 会列出已删未 stage 的幽灵文件）
3. **F170c 类型资产可被无声删除**：`tests/type-tests/tsconfig.json` 的 include 含
   `../../src/mcp/lib/response-helpers.ts`，保证 program 永不为空 ⇒ TS18003 永不触发（f220/f222 有此守卫，唯独 170c 没有）。
   → 删掉该冗余 include（`.test-d.ts` 本就 import 它，tsc 会顺着拉进来）

### WARNING（全部已修）

- `Type Check Tests` 排在 `Build` 之前会连坐 skip 掉 Test/Repo Check/Release Check，
  违反同一份 ci.yml 里 F265 写明的"先拿测试结论"原则 → **移到 `Release Check` 之后**，用同一条 `if:`
- `.spec.ts` 完全在守卫视野外（仓库规则明文认可该后缀，vitest include 与守卫两侧同时漏 ⇒ 差集恒空）→ 纳入扫描
- **「分类完整性」断言是自指恒真**：`FIXTURE_SOURCE_CLASSIFICATION` 从不被 `describe.each` 消费，
  注释宣称的强制机制是虚构的 → 改为**从磁盘枚举 pinned 资产并断言每份都有分类声明**
  （本卡新守卫里出现了本卡正在治的病，已修）
- Python 断言硬编码 `os.homedir()` 与实现支持的 `SPECTRA_BASELINE_HOME` 覆盖矛盾（实测会假红）→ 改同源计算
- 守卫标题声称防"存在但从不执行"，实际只防"不在 include 里"（整文件 `describe.skip` 不在覆盖面）→ **诚实收窄声称**
- unverifiable 分支静默通过（编排器自行发现）→ 加 `console.warn` 输出具体缺失路径
- 3 条 empty-project `it.todo` 被误归入"永久不做"（它们断言的是**缺席**，不依赖 LLM 语义）→ 恢复 + 改正理由
- `buildModuleGraph` 删除依据"tsc 保证"是错的（它在接口里是**可选成员** `buildModuleGraph?(`，
  变异实测 tsc 放行）→ 改正为"靠 `156-w1.2-v2.test.ts:122/:177` 的真实调用覆盖"
- `durationMs` 改法丢了负值检测（`Number.isFinite` 抓 NaN，`>= 0` 抓时钟回拨负值）→ 补回

### spec 合规审查

发现 1 处 **over-claim**：spec.md 四处声称"`durationMs` 断言修回 `> 0`"，而实现按
`verified-facts.md` 的更正裁决**整条删除**（字面执行会造确定性红）。另有 SC-001 用例数
`85 → 84`、tasks.md checkbox 滞后。**全部已修**。

---

## 6. 三次"拒绝执行字面指令"（值得留档的过程事实）

本卡的任务描述有三处若按字面执行会引入**确定性红测试**，均被实施子代理实测拦下并上交裁决：

1. `tests/panoramic/qa/index.test.ts` 的 `durationMs`：全 mock 管线下 `Date.now()-t0` 确定性返回 0（连续 5 次全 0ms）
2. `tests/panoramic/html-exporter.test.ts` 的 `durationMs`：小型 fixture 下 10 次采样 ≥8 次命中 0ms
3. `tests/self-hosting/self-host.test.ts` 的 `exports.length`：实测 341 个 `src/` 文件中 **16 个 exports 为空**
   （`cli/index.ts` 等侧效入口），注释里"src/ 中的文件都是模块"与事实不符

三处最终分别处置为：删除整条恒真 it / 类型 + 有限性 + 非负三断言 / `Array.isArray` 类型不变量。

---

## 7. CI run 回填（✅ 已完成，原 PENDING 节）

真实 CI run：https://github.com/connor-git-yaml/cc-plugin-market/actions/runs/33363928380
（commit `125bfdb3` push master 触发，**conclusion: success**，12 步骤全 success）。
逐项证据见 [`ci-pending.md`](./ci-pending.md)，三项观测全部符合预期：

- `Type Check Tests` 已执行、success、~10s，位置在 `Release Check` 之后（`if:` 条件生效）
- 零执行守卫在干净 checkout 通过（1 test, 717ms）
- pinned 陈旧守卫通过（6 tests, 3097ms），且 CI 日志**如实可见** Python 项的
  `[pinned-staleness] Python 未核验（诚实缺席，非静默跳过）: 外部源 clone 不存在:
  /home/runner/.spectra-baselines/micrograd（…）` —— 诚实缺席设计按预期生效

**附**：本卡的 pinned 陈旧守卫在并行卡 F271 的交付中**首次实战拦截**——抓到 F271 重建
dist 后 4 份 pinned graph 的陈旧漂移，F271 按 SOP 再生后通过。守卫上线当天即产生真实拦截。

## 8. 已知边界（诚实登记，非缺陷）

- 零执行守卫只覆盖 **vitest 域**（`.test.ts` / `.spec.ts`）；`plugins/**/*.test.mjs`（约 162 用例，
  独立 runner）不在覆盖面内
- 零执行守卫只防"不在任何 vitest project 的 include 范围内"；**整文件 `describe.skip` / `it.skip` 形态不在覆盖面**
- pinned 陈旧守卫的 Python 项在无外部 clone 的环境（含 CI）报 `unverifiable:external-source` 并通过——
  这是设计的诚实缺席，代价是 CI 上 Python 那份从不被真实核验
- `vitest.config.ts` 的 `coverage.include: ['src/**/*.ts']` 会把 `src/` 下的测试文件算作覆盖目标
  （① 删除后该面自然缩小，但配置本身的问题仍在，不在七项内，未动）
