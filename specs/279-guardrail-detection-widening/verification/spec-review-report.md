# F279 Spec 合规审查报告

> **落盘说明**：本报告由 `spec-driver:spec-review` 子代理产出。该子代理的工具配置**不含 Write/Edit**
> （只有 Read/Grep/Glob + 两个 MCP），无法自行写入 `verification/`，报告只能以 chat 回复交付。
> 本文件由主编排器转录落盘，内容忠于子代理原始结论，**未做实质改写**；主编排器的补充裁决
> 单列在文末「主编排器裁决」一节，与子代理结论明确区分。
> 该工具缺口已作为 dogfooding 反馈落账。

**审查范围**：`spec.md`（17 FR / 6 SC）× 实际代码（`scripts/regen-collector-fingerprint-fixtures.ts` +
两个测试文件）× `implement-notes.md` 声称证据。

**子代理自述的核验口径限制**：其环境未提供 Bash，无法自行重跑 `npx vitest` / `npm run build` /
`git diff` 做一手复核。凡标注"基于转述"的条目，可信来源层级低于一手复现。

---

## 逐条 FR 裁定

| FR | 裁定 | 证据锚 |
|---|---|---|
| FR-001 检测 `node.kind` | **达成** | `scripts/regen-collector-fingerprint-fixtures.ts:431-435`；测试 `:592-615` |
| FR-002 检测 `node.label` | **达成** | 同上 `:436-440`；测试 `:617-633` |
| FR-003 kind/label 诊断含 id+字段名 | **达成**（优于字面要求，含新旧值） | 实测文案 `节点 kind 不一致（重建 "component" vs pinned "module"）: <id>` |
| FR-004 metadata 递归 key 路径 | **达成** | `isRecursableMetadataValue:286-289` 显式排除数组；`collectMetadataKeyPaths:306-320` 先记 key 自身路径再递归；边界用例 `:814-849` |
| FR-005 metadata 诊断含递归路径 | **达成** | `:778-780`、`:794-796` |
| FR-006 只比 key 不比 value | **达成** | 全程未比较 metadata 叶子值 |
| FR-007 检测 `graph.graph` + `directed`/`multigraph` | **达成** | `compareGraphMetadata:522-550`，两侧 key 并集减 denylist |
| FR-008 graph.graph 诊断含字段名+新旧值 | **达成** | `graph.graph.nodeCount 不一致（重建 999 vs pinned 22）`；`directed 不一致（重建 true vs pinned false）` |
| FR-009 `builder` 排除且给理由 | **达成** | `:496` + 注释 `:485-489`（引 F261 D1）；负控测试 `:932-948` |
| **FR-010 排除面约束** | **⚠️ 部分达成（文本冲突）** | 见下方 WARNING 1 |
| FR-011 不引入顺序敏感性 | **达成，但范围需显式裁定** | 见下方 INFO 1 |
| FR-012 既有检测力不回退 | **无法独立判定（转述）** | 代码走查未见既有三维度被删/弱化，倾向支持 |
| FR-013 三处断言迁移 | **达成** | (a) 单测 `:387` 含三路径；(b) 集成 `:372` 含三路径（方向相反同口径）；(c) `:396` 逐字未动，已直接 Read 核实 |
| FR-014 活性证明 | **无法独立判定（转述）** | notes §3 证据链完整（含前后 sha256），未亲自复现 |
| FR-015 复用 F278 基础设施（SHOULD） | **达成** | 就地泛化，未新增平行维度 |
| FR-016 禁改 pinned 资产 | **达成（转述+结构推断）** | 后置 `git diff --exit-code` 本身即防护机制 |
| FR-017 禁改 `BEHAVIOR_VERSION` | **无法独立判定（转述）**，倾向可信 | 该文件不在 tasks 的允许改动清单内 |

**合计**：达成 11 / 部分达成 1 / 达成但需显式裁定 1 / 无法独立判定 4。

---

## WARNING 1 — FR-010 与 `fingerprint` 排除的文本冲突（子代理原始结论）

FR-010 原文要求"不得排除任何**随采集行为变化**的字段"。而 `graph.graph.fingerprint`
**按定义就是采集行为的哈希**，是所有候选字段里与"采集行为"关联最直接的一个；
spec 的 US3 场景描述（`spec.md:57`）也**只写了 `builder 除外`**，从未预告第二个排除项。

plan 以"避免与 `fingerprintUnchanged` 形成双真源"为由排除它，是**可辩护的工程判断**，
但它是在**违反 FR-010 字面约束**的前提下做出的，而非在约束框架内做出的。

**关键指控**：`implement-notes.md §5` 按"逐条核对：无偏差"结案，是一次**未被察觉的 over-claim**——
"与 plan 裁决无偏差"是真的，但它没有回答"**plan 裁决是否忠于 spec**"。

子代理给出的两条处置路线：
- (a) 承认这是对 FR-010 的**必要例外**，回写 spec 把 `fingerprint` 纳入排除白名单并给出理由；
- (b) 坚持 FR-010 不容例外 ⇒ 把 fingerprint 纳入比较，但改用 `fingerprintsEqual` 的
  canonical 化比较（而非裸值比较）来消解双真源分歧。

---

## WARNING 2 — SC-006 "零错误" 对本卡是结构性空网

子代理直接 Read `tsconfig.json` 与 `package.json` 核实：`lint`/`build` 套壳同一份
`include: ["src/**/*.ts"]` + `exclude` 含 `"tests"` 的配置，本卡三个改动文件**全部不在网内**。
⇒ SC-006 里"`npm run lint` 与 `npm run build` 零错误"对本卡改动**跑通不代表类型正确**。

`implement-notes.md §4` 已如实标注该盲区并补跑 ad-hoc 检查（0 error）。
**诚实口径建议**：验收结论不应写"零错误"，而应写"仓库既有 lint/build 门禁对本卡改动结构性零覆盖；
已用一次性 ad-hoc tsc 补充验证（0 error），该检查非仓库常设门禁"。

---

## INFO

1. **FR-011 范围须显式裁定**：spec 正文（`:74`、`FR-011:94`）字面把范围限定为
   "仅反转 `nodes[]`/`links[]`"。而 `compareGraphMetadata` 对 `sources`/`skippedSources`
   采用 `JSON.stringify` **整体顺序敏感**比较（`:518-520` 注释显式承认）——这是本卡**新增**的
   顺序敏感行为。按 spec 字面不构成 FR-011 违反，但**须在交付说明里显式记录**，
   否则未来有人默认"顺序不敏感是全局不变量"会被这条行为反证。
2. FR-012/014/016/017 四条的"达成"基于转述而非一手复现，建议由有 Bash 权限的一方独立复核。

## 过度实现检测

未发现 spec 未定义却实现的公共 API / 配置项 / 用户可见行为。改动集中在单文件的 module-private
符号扩展，"不新增导出面"已被 notes §1 的换版实验反向验证。

## 分级汇总（子代理）

**CRITICAL 0 / WARNING 2 / INFO 2**

---

# 主编排器裁决（与上方子代理结论区分）

## 对 WARNING 1 的处置：采纳路线 (a)——把 `fingerprint` 从排除表拿掉

**子代理的指控成立**：`implement-notes.md §5` 只核对了"实现 vs plan"，没核对"plan vs spec"，
这正是 F270 记录过的 over-claim 结构性根源。该批评被接受。

### ⚠️ 本节初稿的裁决被推翻，留痕如下

主编排器初稿曾主张"保留排除、回写 spec 记录例外"，论据是
**"fingerprint 漂移信号并未失守，它有两条独立通道"**。
**该论据随后被异构对抗审查（切入角 1）证伪，主编排器已亲自复核确认证伪成立**：

- `fingerprintUnchanged = fingerprintsEqual(pinned.fingerprint, currentFingerprint)`
  （`scripts/regen-collector-fingerprint-fixtures.ts:1005` + `:935`）——两个操作数分别是
  **pinned 资产记录值**与 **`computeCollectorFingerprint()` 现算值**，**都不是重建产物**。
- `grep -n "rebuilt\.graph"` 实测：`runRegen` 对 `rebuilt.graph` 只有两处读取——
  `:1006` 传给比较器（当时 fingerprint 被 denylist 排除）与 `:1055` 序列化写盘。
  ⇒ **重建产物的 `graph.graph.fingerprint` 全程无人读。**
- 护栏单测对**重建侧**只断言 `isValidCollectorFingerprint` 与
  `behaviorVersion === BEHAVIOR_VERSION`（`:142`/`:144`）；唯一的等值断言 `:153`
  用的是 **pinned** 侧快照。

⇒ 所谓"两条通道"守的都是 **pinned 侧**；**重建侧 stamp 一条通道都没有**。
初稿把两个不同的比较（`pinned vs current` 与 `rebuilt vs pinned`）当成了同一事实。

**实际后果（fail-open 链）**：重建侧坏 stamp 会被写进 pinned 资产；此后
`fingerprintUnchanged` 恒为 false ⇒ `shouldRejectRegen = contentMismatch ∧ fingerprintUnchanged`
恒为 false ⇒ **整条护栏的拒绝语义永久失效**。

**路线 (b)「用 canonical 比较」的顾虑同样被证否**：`toSurfaceEntry`
（`src/panoramic/graph/collector-fingerprint.ts:175-180`）对 `extensions` 做 `[...].sort()`，
注释明写是为跨环境 byte-identical 要求 ⇒ 两侧同源同序，裸值比较不会与 canonical 比较分歧。

### 最终处置

**把 `fingerprint` 从 `GRAPH_GRAPH_EXCLUDED_FIELDS` 拿掉，排除表回到只有 `builder` 一条**
（与 `compareGraphDeep` 的 `DEEP_COMPARE_EXCLUDED_PATHS` 逐字一致）。这同时：
- 关闭上述 fail-open 链；
- 让 FR-010 **字面与立法意图同时满足**，spec 无需为此破例；
- 新增两条变异用例钉死（只改 fingerprint / 只削 `extensionSurface` 而不动 `behaviorVersion`），
  并已用"把 fingerprint 加回排除表"的变异体实测二者转 FAIL，证明用例承重。

## 对 WARNING 2 / INFO 1 的处置

- WARNING 2：采纳。SC-006 口径按建议改写，交付报告同步采用诚实口径。
- INFO 1：采纳。`sources`/`skippedSources` 的顺序敏感性作为**本卡新增行为**显式登记。
- INFO 2：主编排器已用 Bash 一手复现 FR-012/014/016/017 全部四条（见 `implement-notes.md`
  §1/§3/§6 的实跑输出与 sha256 对照），该条已闭合。
