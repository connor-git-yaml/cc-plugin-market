# F284 · 采集面 SSoT 扩到忽略目录（per-pipeline `ignoreDirs`，守卫双向）+ F249 护栏补边属性 / 节点顶层 / hyperedges 三面

> 模式：spec-driver-fix（主线程实施 + 异构对抗复审 ≥2 角 + verify 子代理）。类别：图解析类（验收必带外部语料 A/B）+ 守护资产（护栏比较器）——
> Codex 配额暂停期走异构对抗档位，commit 标注「Codex 审查暂停，异构档位缺席」。来源：M10 §12.1 R2 / W-5、§12.3 W-2（F279 Out of Scope #1–#3）。

## 1. 问题与证据

| 组 | 现状（改动前，9362f1a8） | 证据 |
|---|---|---|
| (a) 忽略目录字面量 12 处、守卫单向 | `source-discovery.ts` 的 `TSJS/PY_SKELETON_IGNORE_DIRS`（:238/:398）、`ignore-oracle.ts` 的两份"字面量镜像"（:107/:114）+ union（:69）、java/go/python/ts-js 四个适配器的 `defaultIgnoreDirs`、`file-scanner.ts` 的 `UNIVERSAL_IGNORE_DIRS`、`python-adapter.ts::scanPyFiles` 手拼 `ignoreNames`。`ignore-oracle.test.ts` 只断言 `producer ⊆ oracle`——生产者删掉一个目录名时 oracle 仍判它 ignored（fail-open） | §12.1 R2；oracle 注释还写着"镜像 batch-orchestrator.ts"（常量早已搬到 source-discovery） |
| (b) F249 护栏三面零覆盖 | `compareGraphOnlyStructure` 的 `edgeKey` 只取 `source|relation|target`；节点只比 kind/label/metadata 三 facet；图顶层只比 `directed`/`multigraph`。F279 两路对抗在真实 pinned 资产上实证：14 条边 `confidence`/`confidenceScore`/`directional`/`evidenceText` 全改、三元组不动 ⇒ 再生脚本判"无需更新"exit 0 | F279 spec Out of Scope #1–#3；§12.3 W-2（F272 pinned 深比较 4 红 / F220 charter 8 红而护栏 52/52 绿） |

## 2. 修复

### (a) `CollectorPipelineSurface.ignoreDirs`（零行为变化）
- `src/collector-surface.ts`：接口加 `ignoreDirs: ReadonlySet<string>`；六面各自声明（字面量**逐字**搬自原生产者）；另导出 `PYTHON_ADAPTER_DECLARED_IGNORE_DIRS`、`TSJS_ADAPTER_DECLARED_IGNORE_DIRS`（只经 registry 聚合进 file-scanner / debt-scanner 的适配器声明集）；`mergeSurfaces` 的 `ignoreDirs` 取并集（= generic collector 对适配器集取并集的既有行为）。
- 消费方改引用（=== 同一对象）：`source-discovery.ts` 两常量只保留导出名（F220 导出面钉住）；`ignore-oracle.ts` 两份镜像 → 引用，`GRAPH_COLLECTOR_IGNORE_DIRS` → `TSJS ∪ PY` 派生，`javaIgnoreDirs()/goIgnoreDirs()` → 引用面（不再实例化适配器）；四个适配器 `defaultIgnoreDirs` → 引用；`python-adapter.ts::scanPyFiles` → `PYTHON_SYMBOL_SCAN_SURFACE.ignoreDirs`；`file-scanner.ts` `UNIVERSAL_IGNORE_DIRS` → `MODULE_DERIVATION_SCAN_SURFACE.ignoreDirs`；generic collector / file-scanner 构造 surface 字面量处补 `ignoreDirs`。
- 守卫双向：`ignore-oracle.test.ts` 的两条 `⊆` 改为 `=== 引用同一性` + `union 双向相等`；新增 `tests/unit/collector-surface-ignore-dirs.test.ts`（六面非空 / mergeSurfaces 并集 / 六处消费方 `===` 同一性 / 八个集合内容逐项钉死 / 七个消费方文件源码层零第二份字面量）。
- **不进指纹分量**：`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES.ignore-dirs-pruning` 仍是手工 bump 责任；把 ignoreDirs 并进 `collectorFingerprint` 是格式变更（formatVersion / 两份 pinned 资产 / charter 快照全动），另立 M11 卡。本卡集合逐字不变 ⇒ **不 bump** `BEHAVIOR_VERSION`（F252「不 bump 裁决制品化」先例；外部语料 A/B 见 §3）。

### (b) F249 护栏三面（`scripts/regen-collector-fingerprint-fixtures.ts::compareGraphOnlyStructure`）
- **边属性（值级）**：按 `edgeKey` 分组，比较组内"除三元组外全部属性"的稳定序列化 multiset；单边对单边时逐字段富诊断（`边属性不一致（confidence: 重建 "INFERRED" vs pinned "EXTRACTED"；evidenceText: …）: key`）。为什么边比值而 metadata 只比 key：边属性面是有限标量枚举 / 确定性派生分，没有 metadata 的浮点噪声与开放 schema；F279 实证的失效形态正是"值全改、三元组不动"。
- **节点顶层 key 集合**：按 id 分组比较顶层 key 名集合（`节点顶层 key 集合不一致（重建新增 [weight] / 重建缺失 []）: id`），只比 key 不比值（facet 的值级 / key 级各归各维度）。
- **图顶层 key 集合 + hyperedges**：顶层 key 排序比较；`hyperedges` 任一侧存在即按稳定序列化 multiset 比较条数与内容。
- 稳定序列化：对象按 key 排序递归、数组保序——只重排一条边对象的 key 顺序（值不变）判一致（重构不报成漂移，专门用例钉住）。
- JSDoc「覆盖面的诚实边界」改写：三面已补，仍零覆盖的是 metadata 叶子类型档 / 数组内嵌套 key 改名 / metadata 值级（F279 移交、本卡未授权）。
- 两份 pinned 资产**未动**：新维度上重建产物与 pinned 逐项相等（护栏测试 `严格相等` 用例含新维度全绿），无需再生。

## 3. 红先行 / A/B

- (a) 单向守卫的失效方向：改动前把 `PY_SKELETON_IGNORE_DIRS` 删一项 → `⊆` 断言仍绿（oracle 超集），改后 `union 双向相等` 红。
- (b) 护栏四条新变异用例（边属性改值 / 节点加顶层字段 / 图加 hyperedges / 边 key 重排应绿）在改动前：前三条**绿=漏检**（F279 实证形态），改后报不一致；第四条两版皆绿。
- **外部语料 A/B（图解析类验收）**：master 9362f1a8 的 dist vs 本卡 dist，对 GORM @688e8ea0 / HikariCP @ea81bfb5 / micrograd 各跑 `batch --mode graph-only`，去掉 `generatedAt`/`builder`/`sourceCommit`/`collectorFingerprint` 后节点 / 边归一化比对——结果见 `verification/`（主线程实跑）。

## 4. 影响范围与边界

- 行为面：零变化（集合逐字相同；A/B 逐字节相同为证）。守卫面：oracle 由 `⊆` 收紧为相等；护栏由 4 维扩到 7 维。
- **登记的残留（如实，对抗复审 W1 更正方向）**：`ignore-oracle.ts` 的 `GENERIC_UNIVERSAL_IGNORE_DIRS = {node_modules, .git}` 只是 oracle 对 java/go **文件级**判定的补集。首稿写「generic walk 不按名剪 `node_modules`、oracle 多判 ignored」是**错的**：walk 对目录调 oracle、目录路径无扩展名走 union 兜底，因此 `node_modules/ dist/ coverage/ tmp/ __pycache__/ venv/ .cache/ .tox/`（GRAPH_COLLECTOR_IGNORE_DIRS 成员）都会被剪；真实不对称是 oracle 对 `.java/.go` 文件级集合（适配器集 ∪ {node_modules,.git}）**窄于** walk——漏判 ignored 方向。要闭合须派生为 `JAVA ∪ GRAPH_COLLECTOR_IGNORE_DIRS`，属行为变更 ⇒ 本卡不动，行为哨兵测试逐名钉住现状（含 `node_modules/x.java ⇒ true`），M11 立卡时按此方向。
- **oracle 对 `.py` 无 #11 分派（既有，对抗复审 W3）**：`.py` 只分派到 #2 集合，#11 `scanPyFiles` 独采的 `build/ coverage/ out/ target/` 下 .py 节点被判 ignored（合法采集判成忽略 = 假警报，实测把 `graph-quality` 压到 pass-with-warnings；f286 旧 dist 同结果）。差集两向已在 `collector-surface.ts` 登记；修法（按节点来源分派或取 #2∩#11）是行为变更 ⇒ M11 立卡。
- **范围外同名表（对抗复审 I5，登记不改）**：`source-discovery.ts` 的 `MD_SCAN_DIR_BLACKLIST`（设计文档扫描）与 `debt-scanner/index.ts` 的 registry ∪ 5 字面量——不是图采集管线，与 watcher / cache-key / generators 同列「各自产品面」。
- 各 walk 的"点前缀目录一律剪枝"是共享规则，不在 `ignoreDirs` 内（接口注释登记）。
- 不做：ignoreDirs 进指纹分量；metadata 值级 / 叶子类型档 / 数组内 key 改名（F279 移交面 #4–#6）；file-scanner 之外的非采集面字面量（watcher / cache-key / generators / product-ux-docs 是各自产品面，不是图采集管线）。

## 4.1 验证证明力（对抗复审 W4 如实改写）

- 外部语料 A/B 对本改动**几乎空转**：三个外部语料里命中忽略名、非 gitignore、含相关扩展名的目录只有 micrograd `test/`；self-dogfood 跟踪树只有 `vendor / build / dist / tests` 四个名字有样本——66 个条目可被观察 ≤ 6 个；`#7/#8` file-scanner 集怎么改 graph.json 都不变（TS 模块节点来自 #1 walk）。A/B 仍是「图解析类改动必带外部语料 A/B」的合规动作与 A 侧 dist 身份记录（9362f1a8 / sourceDirty:false），**不是**逐名等价的证据。
- 逐名等价的主证据改为 `tests/unit/collector-surface-ignore-dirs-behavior.test.ts`：对 6 个消费方，把事实源出现过的全部目录名 + 5 个对照名各放探针文件，正反两向逐名断言有效剪枝集——这就是复审建议的「敏感合成语料重算器」，入库为测试而非 dump。
- APFS 大小写不敏感：`Tmp/ NODE_MODULES/` 形态本机不可观察（Linux 上不剪是既有行为，非本卡引入）。

## 5. 审查档位

图解析类 + 守护资产：主线程自审 + **异构对抗复审 ≥2 角**（SSoT 接线等价性 & oracle 方向 / 护栏比较器绕过与误报）+ verify 子代理；Codex 配额暂停期，commit 标注「Codex 审查暂停，异构档位缺席」。

## 6. 工具使用反馈（Dogfooding）

- Spectra MCP：未用——12 处字面量靠 `rg 'node_modules'` 普查更直接；impact 对常量引用面无增益。
- Spec Driver：主线程按 fix 骨架推进（用户要求本 session 内直接执行），未调用编排器 SKILL。无实质工具反馈，不落账。

## 7. 对抗复审处置（护栏比较器 = 守护类常设档位：两路异构；Codex 审查暂停、异构档位缺席）

### 7.1 SSoT 等价性与 oracle 方向（0C / 4W / 7I）

| # | 档 | 发现 | 处置 |
|---|---|---|---|
| W1 | WARNING | §4 残留登记方向写反（walk 经 oracle union 兜底剪目录；oracle 文件级窄于 walk = 漏判） | **已修**：§4 改写；oracle / 单测注释改写；behavior 测试钉 `node_modules/x.java ⇒ true` |
| W2 | WARNING | 三道守卫对派生表形态零守护（scanPyFiles 多剪 src / javaIgnoreDirs 丢通用集 / file-scanner 派生过滤 / TSJS 派生加 lib 四变异全绿） | **已修**：新增行为哨兵测试（6 消费方 × 事实源全部名字 + 5 对照名，正反两向逐名） |
| W3 | WARNING | oracle `.py` 无 #11 分派（既有假警报面） | **登记**：差集两向补全 + oracle JSDoc + §4 移交 M11（修法是行为变更） |
| W4 | WARNING | A/B 证明力低（可观察 ≤ 6/66；#7/#8 不进 graph.json；A 侧 dist 身份未记） | **已修**：§4.1 与 external-corpus-ab.md 如实改写；主证据换成行为哨兵测试 |
| I1 | INFO | 注释漂移 ×6（oracle / source-discovery / python-adapter / language-adapter） | **已修** |
| I2 | INFO | scanPyFiles 不再读 `defaultIgnoreDirs` 实例覆盖通道 | **已登记**（JSDoc；仓内无覆盖者） |
| I3 | INFO | typecheck:tests 本地红 58 | 既有（F280 遗留，master 1112e18a 已修；rebase 后复跑） |
| I4 | INFO | mergeSurfaces 对缺 ignoreDirs 手工 surface 抛错不指向字段 | **登记**（fail-loud 方向对；手工 surface 未流入） |
| I5 | INFO | 范围外同名表 | **已登记**（§4） |
| I6 | INFO | 双向相等测试对 SSoT 侧删项恒真 | **已修**：标题如实（内容钉死用例兜底） |
| I7 | INFO | oracle 去 `new Adapter()` 无副作用 | 无动作 |

### 7.2 护栏比较器绕过与假红（0C / 6W / 7I）

| # | 档 | 发现 | 处置 |
|---|---|---|---|
| W-1 | WARNING | 值级主张零守护：key-only / 剥 confidenceScore 变异全绿（用例 1 顺手改了 key 集合） | **已修**：confidenceScore 单值用例（key 集合不动）+ 全部用例断完整行 |
| W-2 | WARNING | 新维度拒绝路径只打通用 bump 文案；`printMetadataDimensionGuidance` 只认 `metadata ` 前缀 | **已修**：前缀表扩到五维；集成测试 (f) 边属性漂移钉脚本级 exit code + 指引 |
| W-3 | WARNING | pinned 资产 README 仍称三面零覆盖 | **已修** |
| W-4 | WARNING | 节点顶层 / 图顶层两维只比 key 不比值 = 潜伏绕过未登记 | **已登记**（JSDoc + README 诚实边界；今天两面空集不可达） |
| W-5 | WARNING | hyperedges：非数组折成 [] 判绿 / 等计数异内容说不出原因 / 非确定性生产者结构性恒红 | **已修 a/b**（`<non-array:type>` 形态签名 + multiset 差集与首条差异 + 两用例）；**c 登记**为诚实边界 |
| W-6 | WARNING | 四用例回退 F278 A3「断完整行」纪律，方向反转 / 单向失守不可见 | **已修**：完整行 + 节点 / 图顶层各一条反向用例 |
| I-1 | INFO | JSDoc 孤儿化（`compareGraphOnlyStructure` 不挂文档） | **已修**：七维编号 + 入口注释 |
| I-2 | INFO | 计数不等的组双重报告 | **已修**：跳过 |
| I-3 / I-4 / I-5 | INFO | `edgeKey` 碰撞面（F249 既有）/ 内存态 undefined own key / stableStringify 真值表 | **登记**（JSON 操作数不可达） |
| I-6 | INFO | 脚本级测试未扩 | **已修**（集成 (f)） |
| I-7 | INFO | A/B 脚本删的是 `meta.collectorFingerprint` 而字段是 `fingerprint` | **已修**（本卡指纹未变，A/B 结论不受影响） |
