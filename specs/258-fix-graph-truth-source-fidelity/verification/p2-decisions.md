# P2 阶段决策与实测记录（缺陷 3 消费侧口径 + 附带项 6.2）

范围：`plugins/spec-driver/scripts/{graph-consumption-cli.mjs, lib/graph-consumption-decision.mjs}`
及其测试 + 跨语言合同测试 `tests/unit/graph-scope-extensions-contract.test.ts`。
**未触碰** `src/**`、`scripts/lib/graph-quality-core.mjs`（P1 范围）、`runGit` / base-ref 相关代码（P3 范围）。

---

## T036 `[CLEANUP]` 两遍法判定（D8：必须基于 `git diff --stat` 实数，不接受"预计"）

### 第一遍实数

```
$ git diff --numstat plugins/spec-driver/scripts/graph-consumption-cli.mjs
130     38      plugins/spec-driver/scripts/graph-consumption-cli.mjs

$ git diff --stat plugins/spec-driver/scripts/graph-consumption-cli.mjs
 plugins/spec-driver/scripts/graph-consumption-cli.mjs | 168 ++++++++++++++++-----
 1 file changed, 130 insertions(+), 38 deletions(-)

$ wc -l plugins/spec-driver/scripts/graph-consumption-cli.mjs
     876   （基线 784）
```

**净增 = 130 − 38 = +92 行。**

### 判定

规则：`LOC > 500 且实测净增 > 50 行` ⇒ 触发。
784 > 500 ✅，92 > 50 ✅ ⇒ **判定：触发 `[CLEANUP]`（T037 条件成立）**。

### 第二遍（搬运）**未执行**，理由如下（不是"跳过规则"，是执行前提不成立，须由编排器裁决）

1. **本 agent 被禁止任何 git 写操作**。plan §1 的两遍法明确要求：`git checkout -- <file>` 撤销草稿 →
   **先落一个纯搬运 commit**（零行为变化，搬运后先跑全绿）→ 再在搬运后的结构上重放功能改动。
   没有 commit 能力时把搬运和功能改动混在同一份工作树 diff 里，恰好毁掉两遍法唯一的收益
   （review 能干净区分"搬运 diff"与"行为 diff"），等于既付了成本又没拿到收益。
2. **搬运边界与 P3 范围硬冲突**。plan §1 写死的搬运清单是
   `runGit` / `collectChangeSet` / `collectGraphAvailability` / `deriveScopeSurfacesFromFingerprint` /
   `collectCoverageScope`。其中 `runGit` 与 `collectChangeSet` 正是 P3（缺陷 2：结构化返回 + base-ref
   预检 + exit 3）要重写的两个函数，且本 agent 收到的范围约束明确写着「不要顺手动 `runGit` 或
   base-ref 相关代码」。在 P3 之前把它们搬进新文件，会让 P3 的改动落在一个刚被搬走的文件上，
   制造一次本可避免的冲突。
3. **P3 还会继续改这个文件**（`AUDIT_SCHEMA_VERSION` bump、abort 出口、观测字段），届时净增行数会
   再变，搬运时机放在 P3 之后一次做完，比在 P2/P3 中间做一次更省一次重放。

**建议裁决（交编排器）**：把 T037 的纯搬运挪到 **P3 收口之后**执行一次（届时用 P2+P3 合并后的实数
重判，且搬运清单里的 `runGit`/`collectChangeSet` 已是最终形态）。**不建议**在 P2 内做，也**不建议**
为规避触发而压缩本次改动——净增 92 行里没有可删的无关内容（新增 entry 级校验、三值 source 解析、
逐管线合并、stderr warn、类型闸门，以及本仓要求的 why 型注释）。

---

## T042 / D4：畸形指纹 stderr warn —— **做到了**（未降级）

plan §5.5 / §3.5a 要求：若 stderr warn 不可行，必须把该出口如实降级为"事后取数字段"并从 R5 交付物
中移除。**实测可行，无需降级**：CLI 的结构化输出走 stdout（调用方用 `$( )` 捕获），warn 走 stderr，
两条通道互不干扰；文件内早有同形先例（`--tasks-file` 读取失败、审计写失败均走 stderr warn）。

实跑证据（临时 fixture 仓，`pyWalk` entry 故意缺 `matchSemantics`）：

```
$ node graph-consumption-cli.mjs decide --project-root <fixture> --refresh-policy declined \
      --spectra-bin /nonexistent-spectra
# stdout（JSON）
scopeExtensionsSource = static-fallback-malformed-fingerprint
# stderr
[warning] 图自述 collector fingerprint 不被认识，本次覆盖面整体回落静态面
（scopeExtensionsSource=static-fallback-malformed-fingerprint）：pyWalk.matchSemantics 缺失或未知
（实得 undefined，只认 case-sensitive | case-insensitive）
```

两个消费点都接了 warn：`runDecide` 与 `runAnnotateCaveat`（后者按注解时点独立重推导，见 F254 (e)）。
测试侧由 `Part 2c … R3-3` 与既有 `(d) fingerprint 结构畸形` 两处 `assert.match(result.stderr, …)` 钉住。

---

## T043 同形核查：其余取值型 flag 是否也有 `Number(true)` 类闸门缺口

逐个核对 `runDecide` / `runAnnotateCaveat` 对 `parseFlags` 产物的消费方式：

| flag | 消费方式 | 结论 |
|---|---|---|
| `--project-root` | `typeof … === 'string'` | 安全 |
| `--phase` | `typeof … === 'string'`（否则用 sentinel） | 安全 |
| `--base-ref` / `--base-ref-from-trace` | `typeof … === 'string'` | 安全 |
| `--spectra-bin` | `typeof … === 'string'` | 安全 |
| `--tasks-file` | `typeof … === 'string'` | 安全 |
| `--target` | `typeof … === 'string'` | 安全 |
| `--format` | `flags.format === 'text'` 全等比较，`true` 落 json | 安全 |
| `--refresh-policy` | `REFRESH_POLICIES.has(...)`，`true` 不在集合内 ⇒ exit 2 | 安全 |
| `--impact-status` | `IMPACT_STATUSES.has(...)`，同上 | 安全 |
| `--decision` / `--impact-result` | `readJsonArgument` 首行 `typeof value !== 'string'` ⇒ null | 安全 |
| `--refresh-deadline-ms` | **原为 `Number(flags[...])`，`Number(true) === 1` 静默通过** | **唯一例外，本次已修** |

**结论：无第二处例外**，不需要按 plan §6.2 "记进 fix-report 而不是顺手改"的分支处理。

---

## §12 item 6 落定：本仓是否存在 `.PY` / `.PYI` 存量

**不依赖该事实**。缺陷 3 的全部红用例（R3-1/R3-1b/R3-1c/R3-2/R3-2b/R3-3/R3-4 与 6.2 三条）一律在
临时 fixture git 仓内构造 `.PY` / `.PYI` / `Foo.JAVA` 变更集，与本仓存量无关，因此该项对 P2 的验收
不构成前提。

---

## 红用例落点与 tasks.md 的偏差（如实登记）

tasks.md T039 把 R3-3 归在 `graph-consumption-decision.test.mjs`，但 R3-3 断言的是
`scopeExtensionsSource` 三值 + stderr warn ——这两者都是 **CLI 进程级**的可观测量，decision 模块是
纯函数、既不读图也不写 stderr。因此实际落点为：

| 用例 | 实际落点 | 理由 |
|---|---|---|
| R3-1 / R3-1b / R3-1c / R3-4 | `graph-consumption-cli.test.mjs`（Part 2c） | 判的是 `inputs.coverageScope`，需真实 git fixture + 图产物 |
| R3-2 / R3-2b | `graph-consumption-cli.test.mjs`（annotate-caveat 子命令） | plan §10.1 的 R3-2 描述的就是 CLI 形态 |
| R3-2 / R3-4 的纯函数版 | `graph-consumption-decision.test.mjs` | 直接打 `annotateImpactCaveat`，与 CLI 版互为纵深 |
| R3-3 | `graph-consumption-cli.test.mjs` | 见上（三值 + stderr 是进程级可观测量） |
| 6.2 三条 | `graph-consumption-cli.test.mjs` | 参数解析属 CLI |
| 匹配器 `null` 第三出口 | `graph-consumption-decision.test.mjs` | 纯函数契约 |

**TDD 条款未被削弱**：以上每条都先跑出红、且确认失败原因正确（见交付报告的先红证据），再写实现。

---

## 变更的对外契约（供 P3 / 收官核对）

1. `graph-consumption-decision.mjs` 删除 `GRAPH_SCOPE_EXTENSIONS`（**不留兼容别名**），新增
   `GRAPH_SCOPE_SURFACES` 与 `surfaceMatchesFileMjs`；`annotateImpactCaveat` 第 4 参语义由
   "扁平扩展名数组"改为"逐管线 surface 数组"。
2. `scopeExtensionsSource` 由二值扩为三值，新增 `static-fallback-malformed-fingerprint`。
   ⚠️ **既有行为变化**：所有"有 fingerprint 但畸形"的形态（原测试 (d) 的 9 例）从 `static-fallback`
   改为新取值，并附带一条 stderr warn。
3. `--refresh-deadline-ms` 缺值形态由"静默 1 ms"改为 **exit 2**。
4. `AUDIT_SCHEMA_VERSION` **保持 3 未 bump**——按 plan §7 / tasks T061，bump 是 P3 的事，
   P2 不动它（避免与 P3 的审计断言互相踩）。新取值与新 warn 的 schema 影响由 P3 一并 bump 覆盖。
