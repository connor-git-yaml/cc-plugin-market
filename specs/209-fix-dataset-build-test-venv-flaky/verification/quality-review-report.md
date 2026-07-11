# 代码质量审查报告 — F209 dataset-build 单测 venv 环境耦合 flaky 修复

## 审查范围

- `tests/unit/feature-187-dataset-build.test.ts` L105-121（本次唯一改动文件，`git diff` 已核对）
- 对照 `scripts/lib/swebench-dataset-build.mjs`（CLI argv 解析 L112-147、`fetchOfficialRows` L55-64、`buildLocalDataset` L70-110）
- 对照 `.github/workflows/*.yml`（CI 平台确认）
- fix-report.md / plan.md（对照声称是否与实测一致）

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | N/A | 纯测试文件改动，不涉及生产代码/分层结构 |
| 设计模式合理性 | GOOD | 沿用既有 `--venv` CLI 参数（F187 原生能力），零新抽象，符合"不加未要求功能"约定 |
| 安全性 | N/A | 无外部输入、无 SQL/XSS/反序列化风险；测试内路径拼接均基于 `mkdtempSync` 生成的安全路径 |
| 性能 | GOOD | 用例耗时从 ~4.1s 降至 ms 级，符合修复目标（已通过对照 CLI 源码逻辑证实链路正确，未额外引入性能负担） |
| 可读性 | GOOD | 注释准确描述"显式注入不存在路径"这一新语义，去除了旧的环境假设表述 |
| 可维护性 | GOOD | 改动聚焦单一用例，未影响其余 7 个用例；变量命名 `venvPath` 清晰达意 |

## 对抗性核查逐项结论

1. **`path.join(dir, 'nonexistent-venv')` 是否保证任何机器/并行度下必然不存在？**
   证伪未成立。`dir` 由 `fs.mkdtempSync` 在每次用例执行时生成全局唯一临时目录，`nonexistent-venv` 是该唯一目录下从未被创建的子路径，不与同用例内 `v`（fixture 文件）、`out.json`（写出路径）冲突（三者均为不同文件名/未创建的子路径，无同名碰撞）。跨用例：其余 3 个 CLI 用例各自 `mkdtempSync` 独立目录，不共享。风险仅剩"理论上并发进程抢先在该路径创建同名目录"，概率可忽略，plan.md 已如实标注为"潜在低概率残留风险"，未夸大也未回避，属实事求是披露。

2. **spawnSync ENOENT → status=null → CLI throw → exit 非 0 链路是否有平台差异？**
   已读 `fetchOfficialRows`（L56-64）：`py = path.join(venvPath, 'bin', 'python')`，`venvPath` 不存在 → `spawnSync(py, ...)` 触发 ENOENT，Node 语义上此时 `res.status` 为 `null`（非 0），进入 `res.status !== 0` 分支 `throw new Error(...)`。该 throw 在 CLI 顶层（`import.meta.url === file://...` 分支，L142 `buildLocalDataset` 调用处）未被 try/catch 包裹，导致 uncaught exception，Node 默认以 exit code 1 终止进程并把错误堆栈打到 stderr。此链路在 Linux/macOS 一致；Windows 下 `bin/python` 应为 `Scripts/python.exe`，但本仓库 CI（`.github/workflows/ci.yml` 等 4 个 workflow）均 `runs-on: ubuntu-latest`，无 Windows CI 场景，此路径差异不影响当前项目的确定性目标，且该差异是 `fetchOfficialRows` 既有生产逻辑（F187 原生，非本次改动引入），不在本次修复范围内。判定：证伪未成立，链路符合预期，Windows 差异为既有生产代码遗留问题非本次改动引入。

3. **`--venv` 参数是否可能被静默忽略/解析错位导致 `res.status === 0`？**
   对照 CLI argv 解析（L118-121）：`for` 循环逐 token 匹配 `--fixture`/`--out`/`--venv`，`--venv` 分支 `venvPath = argv[++i]` 正确消费下一 token 并覆盖默认值 `'scripts/.swebench-venv'`（L117）。该 `venvPath` 原样透传进 `buildLocalDataset({ ..., venvPath, ... })`（L142）→ `fetchRows({ datasetName, instanceIds, venvPath })`（L78）→ `fetchOfficialRows` 内 `path.join(venvPath, 'bin', 'python')`（L57）。参数链路无解析错位、无被吞掉的风险，`res.status` 不可能因参数解析问题回到 0。唯一能让该用例 `status === 0` 的路径是 `nonexistent-venv` 恰好真实存在且其下 `bin/python` 可执行并返回 status 0——已在核查点 1 判定为概率可忽略事件。判定：证伪未成立。

4. **注释是否准确、无残留旧语义？**
   L108-110 新注释已完全替换旧的"无 venv → fetch 阶段失败"环境假设表述，改为"显式注入不存在的 `--venv` 路径…避免依赖本机是否存在 `scripts/.swebench-venv` 这一环境状态"，并在行内保留 `// fetch 失败（venv 不存在）` 的准确措辞（原为"（无 venv）"，语义已同步更新为主动构造而非环境天然缺失）。符合仓库中文注释约定，无夸大或误导表述。

5. **测试独立性/临时目录清理**
   本用例的 `mkdtempSync` 目录未显式清理（同文件其余 3 个 CLI 用例——L89/L98/L106 原有——均同样不清理），属于该测试文件的既定模式，本次改动未新增或改变该行为，不构成新增问题。各用例间不共享可变状态（各自独立 `mkdtempSync`），符合仓库 `tests.md` "避免测试间共享可变状态"规范。

6. **是否有更简洁等价写法被放弃 / 过度改动**
   改动范围精确匹配 fix-report.md 声明的"1 个测试文件 2 行"变更意图（实际因格式化 diff 稍多，但语义变更点仅为新增 1 个局部变量 + spawnSync 追加 1 个参数对 + 2 处注释文案），未触及生产源码，未引入新依赖或新抽象，符合"最小必要修复"原则。方案 B/C 在 fix-report.md 中已合理否决（避免扩大生产面），未见更优等价方案被无理由放弃。

## 问题清单

未发现 CRITICAL / WARNING 级问题。

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| INFO | 可维护性 | tests/unit/feature-187-dataset-build.test.ts:106,111 | mkdtemp 临时目录测试结束后未显式清理（`fs.rmSync(dir, { recursive: true })`），随用例数量增长会在 `os.tmpdir()` 下持续累积空目录 | 非本次改动引入，属该文件既有模式；可在后续独立 Feature 中统一为所有 CLI spawnSync 用例加 `afterEach` 清理，不阻塞本次修复合入 |

## 总体质量评级

**EXCELLENT**

评级依据：零 CRITICAL，零 WARNING（INFO 1 条且为既有模式非本次引入），改动最小、语义准确、经源码交叉核实链路正确、且已排除对抗性核查关注的三个主要风险点（路径唯一性、平台差异、参数解析错位）。

### 问题分级汇总

- CRITICAL: 0 个
- WARNING: 0 个
- INFO: 1 个
