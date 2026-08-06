## P1

变异逐条注入 → 跑目标测试 → 记录变红用例完整名称与断言失败输出 → **撤销变异**（末尾已复核 diff 无残留）。
全程只跑 P1 范围测试文件；每次只注入一个变异，不叠加。

### M1 — `queryCheckIgnore` 的 `status === 1` 改为 `status !== 0`

变红用例：`src/panoramic/graph/quality/ignore-oracle.test.ts > createIgnoreOracle：三态收敛（F258） > R1-4: 离盘 symlink 穿越路径 ⇒ undeterminable ⇒ 消费方按 not-ignored 处理 + 计数出声`

```
 FAIL  |unit| src/panoramic/graph/quality/ignore-oracle.test.ts > createIgnoreOracle：三态收敛（F258） > R1-4: 离盘 symlink 穿越路径 ⇒ undeterminable ⇒ 消费方按 not-ignored 处理 + 计数出声
AssertionError: expected +0 to be 1 // Object.is equality

- Expected
+ Received

- 1
```

含义：exit 128 被吞成 not-ignored ⇒ `drainUndeterminable().count` 归零 ⇒ 第三态整个消失、退化回二态。

### M2 — L1/L2 判定顺序对调（先查 dirPrefix 再判存在性）

变红用例：`tests/unit/gitignore-oracle.test.ts > createGitignoreOracle：三态 verdict（F258） > R1-3: 离盘路径不消费 dirPrefixes——over-collapse 的 generated/ 不得把 notes.ts 判成 ignored`

```
 FAIL  |unit| tests/unit/gitignore-oracle.test.ts > createGitignoreOracle：三态 verdict（F258） > R1-3: 离盘路径不消费 dirPrefixes——over-collapse 的 generated/ 不得把 notes.ts 判成 ignored
AssertionError: expected 'ignored' to be 'not-ignored' // Object.is equality

Expected: "not-ignored"
Received: "ignored"

 ❯ tests/unit/gitignore-oracle.test.ts:183:50
```

含义：复刻 fix-report R3 的反向分叉——`--directory` 的 over-collapse 前缀把本不该忽略的离盘节点从质量门视野里静默剔除。

### M3 — oracle 对 `undeterminable` 返回 `true`（破坏两消费方同向）

变红用例：`src/panoramic/graph/quality/ignore-oracle.test.ts > createIgnoreOracle：三态收敛（F258） > R1-4: 离盘 symlink 穿越路径 ⇒ undeterminable ⇒ 消费方按 not-ignored 处理 + 计数出声`

```
 FAIL  |unit| src/panoramic/graph/quality/ignore-oracle.test.ts > createIgnoreOracle：三态收敛（F258） > R1-4: 离盘 symlink 穿越路径 ⇒ undeterminable ⇒ 消费方按 not-ignored 处理 + 计数出声
AssertionError: expected [ 'link_to_ign/ghost.ts::Sym' ] to deeply equal []

- Expected
+ Received

- []
```

含义：把"判不了"当违规 ⇒ 任何存在离盘不可判节点的仓库把环境噪声变成红门，且与采集面反向。

### M9 — `probePresence` 的 errno 三分改为「任何 `lstat` 失败都当 `off-disk`」

变红用例：`tests/unit/gitignore-oracle.test.ts > createGitignoreOracle：三态 verdict（F258） > R1-7a: EACCES（父目录 chmod 000）⇒ undeterminable，不得当离盘、不得落 L2`

```
 FAIL  |unit| tests/unit/gitignore-oracle.test.ts > createGitignoreOracle：三态 verdict（F258） > R1-7a: EACCES（父目录 chmod 000）⇒ undeterminable，不得当离盘、不得落 L2
AssertionError: expected 'ignored' to be 'undeterminable' // Object.is equality

Expected: "undeterminable"
Received: "ignored"
```

含义：这条变红同时**证明了断言的判别力**——EACCES 路径一旦被当离盘转去 L2，`git check-ignore` 会答 IGNORED（它只匹配规则、不 stat）。即 `undeterminable` 与 `ignored` 是可区分的两个值，断言 `undeterminable` 因此等价于断言"没有落 L2"。

### M10 — 删除 `graph-quality-core.mjs` 的 `ignore-undeterminable` check

变红用例（2 条）：`tests/unit/graph-quality-core.test.ts > F258：ignore-undeterminable warn check > 存在不可判节点 ⇒ 出现 ignore-undeterminable warn check（且 detail 透传文案）`

```
 FAIL  |unit| tests/unit/graph-quality-core.test.ts > F258：ignore-undeterminable warn check > 存在不可判节点 ⇒ 出现 ignore-undeterminable warn check（且 detail 透传文案）
AssertionError: expected undefined to be defined
 ❯ tests/unit/graph-quality-core.test.ts:356:19
    354|
    355|     const check = result.checks.find((c) => c.id === 'ignore-undetermi…
    356|     expect(check).toBeDefined();
```

含义：D4「没人读 = 没修」的机械保障——诊断出口一旦失去 `repo:check` 侧消费者即变红。

### 撤销复核

```
$ git diff --stat src/utils/gitignore-oracle.ts src/panoramic/graph/quality/ignore-oracle.ts scripts/lib/graph-quality-core.mjs
 scripts/lib/graph-quality-core.mjs           | 33 +++++++++++++++
 src/panoramic/graph/quality/ignore-oracle.ts | 61 +++++++++++++++++++++-------
$ grep -c "M2 变异" src/utils/gitignore-oracle.ts   →  0（无残留变异标记）
```

（`src/utils/gitignore-oracle.ts` 未出现在 diff --stat 中，因它是本 fix 新增的 untracked 文件；内容已按 `go.orig.ts` 逐字节还原。）

---

## P2

变异逐条注入 → 跑目标测试 → 记录变红用例完整名称与断言失败输出 → **撤销变异**（撤销后与实现前副本
`diff` 逐字节对照，无输出即还原）。每次只注入一个变异，不叠加；全程只跑 P2 范围测试文件。

### M6 — `surfaceMatchesFileMjs` 的第三出口 `return null` 改回 `else` 兜底到 case-insensitive

注入位置：`plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs::surfaceMatchesFileMjs`
（删掉 `case-insensitive` 的显式分支与末尾 `return null`，改成"非 case-sensitive 一律走 extname 查表"，
即照抄 TS 侧 `if/else` 形态）。

命令：`node --test plugins/spec-driver/tests/graph-consumption-decision.test.mjs`
结果：`ℹ pass 47 / ℹ fail 2`

变红用例 ①：`F258 缺陷 3：逐管线 matchSemantics 同解判定 > surfaceMatchesFileMjs：未知/缺失 matchSemantics ⇒ 显式第三出口 null（**不得** else 兜底到 case-insensitive）`

```
✖ surfaceMatchesFileMjs：未知/缺失 matchSemantics ⇒ 显式第三出口 null（**不得** else 兜底到 case-insensitive） (0.417667ms)
  AssertionError [ERR_ASSERTION]: matchSemantics="case-folded" 必须判不可判，而不是静默按大小写不敏感处理

  true !== null

      at TestContext.<anonymous> (.../plugins/spec-driver/tests/graph-consumption-decision.test.mjs:643:14)
```

变红用例 ②：`F258 缺陷 3：逐管线 matchSemantics 同解判定 > annotateImpactCaveat：surface 语义不可判时按"不在面内"收口（=== true 才注解）`

```
✖ annotateImpactCaveat：surface 语义不可判时按"不在面内"收口（=== true 才注解） (0.192583ms)
  AssertionError [ERR_ASSERTION]: null 不得被当作真值
  + actual - expected

  + [
  +   'coverage-gap-known-extraction-limit'
  + ]
  - []
```

**与 plan §10.2 预期的偏差（如实登记，非守护缺口）**：plan 写「M6 ⇒ R3-3 变红」，实测 **R3-3 未变红**
（同一变异下 `node --test .../graph-consumption-cli.test.mjs` 仍 `pass 90 / fail 0`）。原因是两者由
**不同防线**守护，形成纵深：

- R3-3（畸形指纹整体回落 + `static-fallback-malformed-fingerprint` + stderr warn）的防线是
  `deriveScopeSurfacesFromFingerprint` 的 **entry 级 `matchSemantics` 严格校验**（plan §5.4）——
  畸形指纹在进入匹配器之前就被整体拒了，所以匹配器怎么变都影响不到它；
- 匹配器的 `null` 第三出口（plan §5.2）守的是**另一半**：调用方传进来的自定义面 / 未来出现第三种
  语义时，不得静默按 case-insensitive 处理。

两条防线各自有测试变红，只是不是同一条测试。若要让 R3-3 对 M6 敏感，必须先拆掉 §5.4 的 entry 校验
——那是把纵深防御压成单点，**不做**。

### M7 — `GRAPH_SCOPE_SURFACES` 某条的 `matchSemantics` 改成另一值

注入位置：同文件 `GRAPH_SCOPE_SURFACES` 的 `pyWalk` 条目，`case-sensitive` → `case-insensitive`。

命令：`npx vitest run tests/unit/graph-scope-extensions-contract.test.ts`
结果：`Test Files 1 failed (1) / Tests 2 failed | 7 passed (9)`

变红用例 ①：`F258 跨语言合同：plugins 侧逐管线 fallback 面 ↔ SSoT 采集面 > 每个 id 的 extensions 与 matchSemantics 两侧逐字相等（扁平并集锚不住语义维）`

```
AssertionError: pyWalk 的匹配语义两侧不一致: expected 'case-insensitive' to be 'case-sensitive' // Object.is equality
Expected: "case-sensitive"
Received: "case-insensitive"
 ❯ tests/unit/graph-scope-extensions-contract.test.ts:98:62
      98|       expect(mjsSurface!.matchSemantics, `${id} 的匹配语义两侧不一致`).toBe(entr…
```

变红用例 ②：`F258 跨语言合同：plugins 侧逐管线 fallback 面 ↔ SSoT 采集面 > 同解真值表：逐管线 × 9 个判别性文件名，两侧匹配器逐条同解`

```
AssertionError: pyWalk 对 "foo.PY" 两侧判定不一致（mjs 返回 null 说明它认不出该 matchSemantics）: expected true to be false // Object.is equality
- Expected
+ Received
- false
+ true
 ❯ tests/unit/graph-scope-extensions-contract.test.ts:134:11
```

即 plan §5.6 要求的两条（逐管线逐字段锚定 + 同解真值表）**各自独立**抓到了该变异——扁平并集锚不住的
语义维，现在有两道断言按住。

### M8 — 删除 `--refresh-deadline-ms` 的类型闸门

注入位置：`plugins/spec-driver/scripts/graph-consumption-cli.mjs::runDecide`，整段删除
`typeof flags['refresh-deadline-ms'] !== 'string'` 的用法错误分支（回到 `Number(true) === 1` 静默通过）。

命令：`node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs`
结果：`ℹ pass 88 / ℹ fail 2`

变红用例 ①：``Part 2c / F258 附带项 6.2：--refresh-deadline-ms 的类型闸门 > `--refresh-deadline-ms --format json`（下一个 token 是另一个 flag）→ 用法错误 exit 2，不得静默压成 1ms``

```
✖ `--refresh-deadline-ms --format json`（下一个 token 是另一个 flag）→ 用法错误 exit 2，不得静默压成 1ms (262.953792ms)
  AssertionError [ERR_ASSERTION]: stdout={
    "schemaVersion": 3,
    "decisionId": "26023bb6-5869-45b8-96ea-7c4347101fad",
    ...
    actual: 0,
    expected: 2,
    operator: 'strictEqual',
```

变红用例 ②：``Part 2c / F258 附带项 6.2：--refresh-deadline-ms 的类型闸门 > `--refresh-deadline-ms` 作为末尾 token（缺省下一个 token）→ 同样 exit 2``

```
  AssertionError [ERR_ASSERTION]: ...
    actual: 0,
    expected: 2,
    operator: 'strictEqual',
```

两条失败点相同：变异后 CLI 照常 exit 0，并输出一份**重建预算已被静默压成 1 ms** 的决策
（表现为"刷新老是超时"而不是"参数写错了"）。

### 撤销复核

```
$ diff /tmp/decision.orig.mjs plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs   # 无输出
$ diff /tmp/cli.orig.mjs      plugins/spec-driver/scripts/graph-consumption-cli.mjs            # 无输出
$ node --test plugins/spec-driver/tests/graph-consumption-decision.test.mjs   # ℹ pass 49 / ℹ fail 0
$ node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs        # ℹ pass 90 / ℹ fail 0
```

---

## P3

范围：`plugins/spec-driver/scripts/graph-consumption-cli.mjs`（abort 出口）与
`plugins/spec-driver/scripts/lib/git-change-classifier.mjs`（required ok 位）。

### M4 — abort 分支改为 `return 0`

注入位置：`abortUnresolvableBaseRef` 末尾 `return 3;` → `return 0;  // [M4 MUTATION]`。

变红用例（8 条，`node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs`
由 `ℹ pass 103 / fail 0` 变为 `ℹ pass 95 / fail 8`）：

1. ``Part 2d / F258 缺陷 2：base-ref 不可解析必须显式报错，绝不静默给结论 > R2-1 --base-ref 指向不可达 sha → exit 3 + error:base-ref-unresolvable + decide-aborted 审计事件``
2. ``… > R2-2 --advisory 下同样 exit 3（两种合同一视同仁，不给 advisory 开软路）``
3. ``… > T054 三种异常 ref 形态（`-` 开头 / 含空格 / 悬空 sha）一律非零 → 全部收口到 exit 3``
4. ``… > R2-5① abort 路径不发生任何刷新（支撑"abort 不消耗刷新预算"的散文口径）``
5. ``… > R2-5② 恢复口径可用：同一仓改传可达 --base-ref 重跑 → 正常 exit 0 出决策（abort 不是死路）``
6. ``… > R2-5③ abort payload 是封闭键集，且**不含** degradedReason / fallbackHint``
7. ``… > --dry-run 下 abort 仍 exit 3，但保持零副作用（不写审计）``
8. ``… > gitStderr 截断至 512 字符（abort payload 不做无界回显）``

R2-1 的断言失败输出前 5 行：

```
✖ R2-1 --base-ref 指向不可达 sha → exit 3 + error:base-ref-unresolvable + decide-aborted 审计事件 (93.426125ms)
  AssertionError [ERR_ASSERTION]: 期望退出码 3，实得 0；stdout={
    "schemaVersion": 4,
    "error": "base-ref-unresolvable",
    "ts": "2026-08-06T12:37:37.533Z",
```

⚠️ 这条变异恰好演示了缺陷的真实危险形态：**payload 内容完全正确**（`error` / `baseRefResolution` /
`hint` 一应俱全），只有退出码变成 0。调用方 `DECISION=$(...)` 只看退出码时，一个如实标注了
"锚点不可达"的 JSON 会被当成一次成功决策——所以退出码断言必须独立存在，不能靠"字段如实"兜底。

### M5 — `classifyChangeSet` 的 ok 位改为默认 `true`

注入位置：把 required + throw 的校验循环替换为
`{ ...input, nameStatusOk: input?.nameStatusOk ?? true, porcelainOk: input?.porcelainOk ?? true }`。

变红用例（3 条，`node --test plugins/spec-driver/tests/git-change-classifier.test.mjs`
由 `ℹ pass 27 / fail 0` 变为 `ℹ pass 24 / fail 3`）：

1. ``F258 R2-4 输入可信度必须由调用方显式声明（required ok 位，缺省即 throw） > 缺两个 ok 位 → throw TypeError（不接受"缺省即可信"）``
2. ``… > 只缺其中一个 ok 位 → 同样 throw（两位都是 required）``
3. ``… > ok 位非 boolean（含 truthy 的 1 / "true"）→ throw，不做隐式转换``

断言失败输出前 5 行：

```
✖ 缺两个 ok 位 → throw TypeError（不接受"缺省即可信"） (0.232083ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception (TypeError).
      at TestContext.<anonymous> (file:///…/plugins/spec-driver/tests/git-change-classifier.test.mjs:217:12)
      at Test.runInAsyncScope (node:async_hooks:228:14)
      at Test.run (node:internal/test_runner/test:1118:25)
```

注意 `nameStatusOk:false → unknown` 两条**未**变红：变异只放宽了"缺省"，显式传 `false` 仍生效。
这正说明 required 与 fail-loud 是两条独立守护，需要分别有用例——只测前者会漏掉后者。

### 撤销复核

```
$ grep -c "M4 MUTATION" plugins/spec-driver/scripts/graph-consumption-cli.mjs        # 0
$ grep -c "M5 MUTATION" plugins/spec-driver/scripts/lib/git-change-classifier.mjs    # 0
$ node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs               # ℹ pass 103 / ℹ fail 0
$ node --test plugins/spec-driver/tests/git-change-classifier.test.mjs               # ℹ pass 27  / ℹ fail 0
```

---

## 审查修复轮

范围：三份独立审查（Spec 合规 / 代码质量 / 两个异构对抗）打出的必修项 M-1..M-7。
方法同前：逐条注入 → 跑目标测试 → 记录变红用例与断言输出 → **撤销变异**（末尾逐字节还原复核）。
每次只注入一个变异，不叠加。

### MR-1 — `degraded` 恒 `false`（回到"L0 整体降级不进诊断结构"）

注入位置：`src/utils/gitignore-oracle.ts::createGitignoreOracle`，把
`const degraded = index === null && hasGitDirUpward(walkBase);` 改为 `false`（stderr 那句 warn 保留，
以证明**只有 stderr 出声是不够的**——机读通道断了，门禁照样变绿）。

命令：`npx vitest run tests/unit/gitignore-oracle.test.ts tests/unit/graph-quality-core.test.ts src/batch/generic-language-skeleton-collector.test.ts`
结果：`Tests 3 failed | 62 passed (65)`

变红用例（3 条，三层各一条，正是"三态 oracle 整体降级"这条链的三个消费点）：

1. `tests/unit/gitignore-oracle.test.ts > createGitignoreOracle：三态 verdict（F258） > M-1: git 仓内预取失败 ⇒ degraded=true（count 恒 0 不构成"无不可判路径"的证据）`
2. `tests/unit/graph-quality-core.test.ts > F258：ignore-undeterminable warn check > M-1: 忽略清单预取失败（三态 oracle 整体降级）⇒ 仍报 warn，且 evidence 标出降级`
3. `src/batch/generic-language-skeleton-collector.test.ts > … > M-1: 忽略清单预取失败 ⇒ 采集面出声报告降级（不因 count===0 而静默）`

含义：这正是审查实证的那条 fail-open 面——`git ls-files` 一失败，oracle 退成二态、`undeterminable`
结构性不可能产出、`drain()` 恒 `{count:0}`，于是 `repo:check` 的 `ignore-undeterminable` 反而报 **pass**
（标题还写着"无不可判路径（三态 oracle）"）。**打坏 git 就能让门变绿**。

### MR-2 — 出声判据改回 `count > 0`

注入位置：`src/cli/commands/graph-quality.ts::shouldVoiceUndeterminable`，
`return summary.count > 0 || summary.degraded || summary.budgetExhausted;` → `return summary.count > 0;`。

命令：`npx vitest run tests/unit/graph-quality-core.test.ts`
结果：`Tests 3 failed | 25 passed (28)`

变红用例：

1. `… > M-1/M-2: shouldVoiceUndeterminable × describeUndeterminable 的三形态 > budget-only（count===0 且 budgetExhausted）⇒ 仍出声，文案指名 l2-budget-exhausted`
2. `… > M-1/M-2: … > degraded ⇒ 出声，且文案必须否定"0 个不可判 = 没问题"这条读法`
3. `… > M-1: 忽略清单预取失败（三态 oracle 整体降级）⇒ 仍报 warn，且 evidence 标出降级`

含义：`count` / `budgetExhausted` / `degraded` 是**三件事**，`count > 0` 一条判据同时吞掉后两个出口。
`budgetExhausted` 那条（具名出口 `l2-budget-exhausted`）在 E2E 里要真把 L2 预算跑穿才能构造，
成本过高——这正是它此前完全没有断言按住的原因，故本轮把判据与文案两个纯函数导出直测。

### MR-3 — L3 改回消费 `dirPrefixes`（`prefetchFileLookup` → `prefetchLookup`）

注入位置：`src/utils/gitignore-oracle.ts::computeVerdict` 的 `presence === 'undeterminable'` 分支。

命令：`npx vitest run tests/unit/gitignore-oracle.test.ts`
结果：`Tests 1 failed | 23 passed (24)`

变红用例：`tests/unit/gitignore-oracle.test.ts > … > M-3: L3（errno 不可判）只信 files 的逐条肯定答复，不消费 --directory 折叠前缀`

```
AssertionError: expected 'ignored' to be 'undeterminable' // Object.is equality
```

含义：`col/` 因内含条目全被忽略而被 `--directory` 折叠，但 `git check-ignore col` 答 exit 1
（**未**被规则命中）。变异后 `col/<300 字符>/keep.ts`（ENAMETOOLONG ⇒ L3）命中折叠前缀被判 `ignored`
——比 `undeterminable` **更错**（与 git 的权威答案方向相反），且计数为 0 ⇒ 静默。
`M-3b`（EACCES 的 `weird/secret.log` 仍判 `ignored`）在该变异下**不变红**，正说明两条断言各守一侧：
一条防"不该查前缀却查了"，一条防"该查精确条目却不查了"。

### MR-4 — 删除入口越界守卫 `isOutsideWalkBase`

注入位置：`src/utils/gitignore-oracle.ts::computeVerdict` 开头。

命令：`npx vitest run tests/unit/gitignore-oracle.test.ts`
结果：`Tests 1 failed | 23 passed (24)`

变红用例：`… > M-4: 在盘的仓外绝对路径 / .. 越界 ⇒ undeterminable 且计数出声（与 KL-2 承诺一致）`

```
AssertionError: expected 'not-ignored' to be 'undeterminable' // Object.is equality
```

含义：修复前只有**离盘**形态才走 L2 得 exit 128；同一形态**在盘**时被 L1 截住 ⇒ 查表 MISS ⇒
静默 `not-ignored`。即 KL-2 白纸黑字承诺的"计数出声"在半数形态上根本没发生——
**文档承诺了运行时没做的事**，下一轮审查者会按 KL 表放过它。

### MR-5 — entry 级 key 集合由"精确等值"放宽为"已知 key 全在即可"

注入位置：`plugins/spec-driver/scripts/lib/graph-consumption-inputs.mjs::deriveScopeSurfacesFromFingerprint`。

命令：`npm run test:plugins`
结果：`ℹ pass 1527 / ℹ fail 1`

变红用例：`Part 2b / F254 覆盖面优先取图自述的 collector fingerprint > (d) fingerprint 结构畸形 → 整体回落，绝不产出部分并集（F258：取值与"图本就没有指纹"可区分且出声）`
（其中 `[entry 多出未知 key（收窄字段漏 bump formatVersion 的形态）]` 这一 case 失败）

含义：顶层 key 早已精确等值，entry 内多出的未知 key 却被静默照单全收——同一失真下沉一层，
且这一层的漂移方向**不安全**：未来 entry 新增**收窄**字段（如 `excludePatterns`）而忘了 bump
`formatVersion` 时，只读两维会算出偏**宽**的面 ⇒ 本该判范围外的改动拿到全信 impact。

### MR-6 — `graph-quality-core.mjs` 的 `oracleDegraded` 恒 `false`

注入位置：`scripts/lib/graph-quality-core.mjs` 的 `ignore-undeterminable` check。

命令：`npx vitest run tests/unit/graph-quality-core.test.ts`
结果：`Tests 1 failed | 27 passed (28)`

变红用例：`… > M-1: 忽略清单预取失败（三态 oracle 整体降级）⇒ 仍报 warn，且 evidence 标出降级`

```
AssertionError: expected false to be true // Object.is equality
```

含义：与 MR-2 互补——MR-2 杀的是"出不出声"，MR-6 杀的是"出声了但**降级原因没进结构化 evidence**"。
只有人读文案带降级、机读字段不带，下游按 evidence 消费的工具（CI 聚合 / 状态面板）仍然拿不到原因。

### 撤销复核

逐字节比对实现前副本（`$SP/orig/`），五个被注入文件全部无差异：

```
OK 逐字节还原: src/utils/gitignore-oracle.ts
OK 逐字节还原: src/cli/commands/graph-quality.ts
OK 逐字节还原: src/batch/generic-language-skeleton-collector.ts
OK 逐字节还原: scripts/lib/graph-quality-core.mjs
OK 逐字节还原: plugins/spec-driver/scripts/lib/graph-consumption-inputs.mjs

$ grep -rn "MR-[0-9] MUTATION" src/ scripts/ plugins/ | wc -l   →  0
```

### 未做变异测试的必修项（如实登记）

- **M-5**（porcelain 失败的后果如实登记）：纯文档裁决，**不改行为**，因此没有可注入的行为变异。
  其被裁决保留的行为由新增用例 `graph-consumption-cli.test.mjs > … > M-5: porcelain 读失败的下游后果`
  正向钉住（unknown ⇒ consume-degraded ⇒ allowed+stale 也不刷图）。
- **M-7**（撤 over-claim 注释）：纯注释改动，无行为面，不适用变异测试。
