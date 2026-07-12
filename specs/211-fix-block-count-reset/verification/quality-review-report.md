# 代码质量审查报告（Feature 211：fix 依从性 blockCount 补救重置）

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | EXCELLENT | `resetBlockState` 落点选在 io.mjs 的 BlockCountState 组，与 `loadBlockState`/`saveBlockState` 同组复用同一批私有辅助函数（`primaryStatePath`/`tmpStatePath`/`sanitizeSessionId`），未破坏 judge.mjs（编排）/io.mjs（I/O）/core.mjs（纯判定）三层分工 |
| 设计模式合理性 | EXCELLENT | "删除文件回到从未阻断态"优于"写零值"（方案 B 被合理否决），避免了"存在但为零"与"从未阻断"两态并存的审计歧义；无条件调用（不按 enforcement 分支）用极小代价换取边缘时序健壮性，论证充分 |
| 安全性 | EXCELLENT | `sessionId` 复用既有白名单化 `sanitizeSessionId`（仅 `[A-Za-z0-9._-]`），路径拼接方式与 load/save 完全一致，不存在路径穿越或键不一致风险；无外部输入拼接命令/SQL |
| 性能 | GOOD | compliant 分支新增两次 `fs.unlinkSync`（同步阻塞 I/O），文件不存在时为 `ENOENT` 快速失败；相对既有 transcript 读取开销可忽略，但严格来说 `unlinkSync` 是同步阻塞调用而非异步，在极端文件系统延迟场景下会阻塞 hook 主线程（现状与 `loadBlockState`/`saveBlockState` 一致的同步 I/O 惯例，非本次改动引入的新增风险模式） |
| 可读性 | EXCELLENT | 函数职责单一、注释说明"为什么两级都删"（不仅描述做了什么）；judge.mjs 调用点内联注释解释了 warn/off 档为何无需特殊分支，避免读者产生"为什么不按 enforcement 判断"的疑问 |
| 可维护性 | EXCELLENT | 新函数 20 行以内，无重复代码；测试覆盖三类边界（主路径清除、tmpdir 回落清除、文件不存在幂等）；CLI 端到端测试验证了完整"阻断×2→补救→额度恢复→再阻断"与"降级→补救→再降级"两条状态机路径 |

## 正确性核查（本次审查重点）

1. **路径构造一致性**：`resetBlockState` 直接调用与 `loadBlockState`/`saveBlockState` 完全相同的 `primaryStatePath(projectRoot, sanitizedId)` / `tmpStatePath(sanitizedId)` / `sanitizeSessionId(sessionId)`，无任何路径拼接逻辑的重复实现或漂移风险——键不一致导致"删错/删不到"的担忧不成立（三个函数共享同一套私有辅助函数，非各自重新实现）。
2. **两级 try/catch 粒度**：`for` 循环内每个文件路径独立 `try/catch`，一级 `unlinkSync` 失败（含 `ENOENT`）不会跳出循环、不影响对第二级路径的尝试，符合 fix-report 明确要求的"两级都清"。
3. **异常输入**：`unlinkSync` 对目录会抛 `EISDIR`（被 catch 吞掉，不炸），对符号链接会删除链接本身（非目标），均落在"尽力而为、忽略失败"的既定语义内，与 `saveBlockState`/`loadBlockState` 现有的容错哲学一致，未引入新的未处理异常类别。
4. **`routeBlock`/`releaseDegraded` 语义未变**：`git diff` 确认 judge.mjs 仅新增 1 个 import + compliant 分支 4 行，`routeBlock`（L206）与 `releaseDegraded`（L242）零改动，验证 fix-report "回归风险评估"表述属实。

## 回归面

- p95 预算影响：compliant 路径新增两次同步 `unlinkSync`。健康路径（从未阻断）为两次 `ENOENT` 快速失败，量级可忽略；已阻断过的会话补救成功时为两次真实删除（一次系统调用级 I/O），同样远低于既有 transcript 解析开销。**未做微基准实测**，但基于代码路径分析和既有测试通过（含计时输出，CLI 测试 122ms/144ms 含 5-6 次子进程 `runCli` 调用），未观察到异常延迟。
- `warn`/`off` 档：`warn` 从不 bump 计数（状态文件本不存在），`off` 在函数入口短路，均不会触达 compliant 分支内的 reset 调用，代码路径确认无误。

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| INFO | 性能 | `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs:335`（`resetBlockState` 内 `fs.unlinkSync`） | 使用同步阻塞 I/O，理论上在慢文件系统下会阻塞 hook 主线程；但这是延续 io.mjs 全文件既有的同步 I/O 惯例（`saveBlockState`/`loadBlockState` 同样同步），非本次改动引入的新模式 | 无需本次修复；若未来要异步化应作为 io.mjs 全文件级别的独立技术债处理，不宜在本次单函数改动中局部异步化制造风格不一致 |
| INFO | 可维护性 | `plugins/spec-driver/scripts/fix-compliance-judge.mjs` compliant 分支 | 未对 `resetBlockState` 调用做失败反馈（该函数本身设计为 `void` 返回、静默失败），若未来需要审计"reset 是否真的执行成功"，当前无法区分 | 按当前 fix-report 的设计意图（"reset 失败的最坏后果只是旧计数残留，不影响本次放行判定"）属于有意为之的简化，不构成缺陷 |

无 CRITICAL、无 WARNING 项。

## 测试验证结果

```
node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs
  tests 38, pass 38, fail 0

node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
  tests 32, pass 32, fail 0
```

两文件全绿，新增 5 个用例（io 层 3 个 + CLI 端到端 2 个）断言强度充分：
- io 层验证了"主路径清除"“tmpdir 回落清除”“文件不存在幂等”三种边界。
- CLI 层验证了完整状态机转移：阻断×2→补救→额度恢复→重新计数（`again1/again2` 必须回到 exit 2，而非因残留计数直接降级放行）；降级→补救→再降级产生第 2 条独立的 `workflow-run-summary` 终态事件（证伪 `degradedRecorded` 未随重置归位导致第二轮终态事件被幂等吞掉的风险）。

## 总体质量评级

**EXCELLENT**

评级依据：零 CRITICAL，零 WARNING，仅 2 个 INFO 级观察项（均为既有代码惯例的延续，非本次改动引入的新缺陷）。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 0 个
- INFO: 2 个
