## 总体判断

**BLOCKED：当前不应进入 implement。**

33 个任务的显式依赖图无环、无悬空 Task ID；17 步测试策略也都有形式上的任务映射。但存在 **6 项 CRITICAL**：其中包括 FR-012 无测试承载、T018 假红、批 2 fixture 无法转绿，以及 SC-006/SC-007 的关键证据缺失。以下均为任务分解问题，不重开 spec/plan 架构决策。

## CRITICAL

1. **FR-012 二次同步覆盖测试没有任务承载**

   - 命中：**T007、FR-012**。
   - 依据：FR-012 明确要求“首次 sync → 主仓内容变化 → 再次 sync → worktree 被覆盖”这一新增测试，[spec.md:97](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:97)。T007 只测 manifest add/remove，[tasks.md:64](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:64)，映射表却声称 T007 覆盖 FR-012，[tasks.md:279](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:279)。现有三个 COPY_TARGETS 测试仅覆盖首次复制、写穿隔离和软链迁移，没有二次同步，[sync-worktree-local-state.test.ts:180](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:180)。
   - 证伪场景：T010 错误改成 copy-if-absent，动态 add/remove 测试仍可能通过，但 FR-012 失败。
   - 修法：新增明确的 **characterization guard**，同一 fixture 连续执行两次 sync，并在中间把主仓 `.env.local` 从 v1 改为 v2，最终断言 worktree 为 v2。它在当前实现下应首跑即绿，不能伪标红测试。

2. **T018 并非红测试，无法守护 C11 发布竞态**

   - 命中：**T018、测试策略第 13 步**。
   - 依据：T018 预置 target 后断言“不覆盖 + tmp 被清理”，[tasks.md:126](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:126)。但当前函数遇到已有真实 target 会在创建 tmp 前直接 return，[sync-worktree-local-state.sh:279](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:279)；两项断言会在旧 `mv` 实现上同时通过。
   - 证伪场景：保留 TOCTOU 的“检查→mv”代码不动，T018 所述测试仍绿。
   - 修法：提取可直接调用的发布原语，或加入确定性注入点，使 target 在 tmp 创建后、发布前出现；断言旧 `mv` 覆盖而红、`ln` 遇 EEXIST 保留对方并清理 tmp 后转绿。

3. **批 2 fixture 未建立 ignored 前提，T010 后既有测试会全线失败**

   - 命中：**T007、T010、T011、FR-001/FR-002**。
   - 依据：T007 只要求把 `.worktreeinclude` 纳入 init commit，没有要求 fixture 创建 `.gitignore`，[tasks.md:64](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:64)。现有 `setupRepo()` 是空仓库加空 commit，没有 ignore 规则，[sync-worktree-local-state.test.ts:25](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:25)。T010 随后强制 `not-ignored` 拒绝，[tasks.md:79](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:79)。
   - 证伪场景：默认 manifest 含 `.env.local`，但临时仓库不 ignore 它；T010 会 skip，现有 copy 用例及 T011 checkpoint 失败。原文无法确认 implementer会额外补 `.gitignore`，不能假设。
   - 修法：T007 明确要求 fixture 提交 `.gitignore`，默认包含 `.env.local`；每个动态 manifest 路径也必须同步加入 ignore 规则，并先断言 `git check-ignore` 成功。

4. **T008 的逃逸 fixture 非因果，且没有承载 SC-006 的完整判据**

   - 命中：**T008、FR-011、SC-006**。
   - 依据：FR-011/SC-006 要求 skip、精确 warning、其余步骤完成以及仓库外零 I/O，[spec.md:96](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:96)、[spec.md:159](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:159)。T008 仅写了 source 构造和 reason-code 断言，[tasks.md:69](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:69)，遗漏 plan 要求的 `status===0`、合法步骤完成、canary/no-copy 证据，[plan.md:288](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:288)。
   - 证伪场景：fixture 把 `../shared-secret` 建在 `dirname(worktreeDir)`，但 source 实际拼成 `$PRIMARY_ROOT/../shared-secret`；当前测试布局中二者不是同一路径，[sync-worktree-local-state.test.ts:27](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:27)、[sync-worktree-local-state.sh:246](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:246)。无 containment 时仍会因 source 不存在而普通 skip。
   - 修法：分别按 `PRIMARY_ROOT` 和 `CURRENT_ROOT` 的真实解析结果布置 source/target canary；增加 `copy_path` 未被调用的可观察探针，并逐例断言退出码、合法 symlink/copy 仍完成、隔离 HOME 外无变化。

5. **FR-002 与 FR-004 各有一个硬性分支没有测试任务**

   - 命中：**T002、T007、T009、FR-002、FR-004**。
   - FR-002 要求 `.worktreeinclude` 缺失时视为空清单并给出可见提示，[spec.md:70](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:70)；T002 测“空文件”，T007 后 fixture 总是创建该文件，没有“文件缺失”测试。
   - FR-004 还要求六个 `SYMLINK_TARGETS` 字符串均不出现在 `.worktreeinclude`，[spec.md:72](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:72)；T009 只写 exact allowlist 与 symlink 生成，[tasks.md:74](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:74)。
   - 证伪场景：脚本在 manifest 缺失时退出，或 `.claude/settings.local.json` 同时进入 manifest 和 allowlist；当前任务仍可能全绿。
   - 修法：分别补 manifest 缺失的端到端测试，以及对六个字符串的参数化交叉断言。

6. **FR-006/SC-007 缺少关键 shell 接线证据，且 plan 指定的旧测试修改无人承载**

   - 命中：**T014–T019、T032、FR-006、SC-007**。
   - 依据：SC-007 要求验证“本地重建路径 provenance 正确更新”，[spec.md:160](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:160)。T014 只测 build helper，T015 只测纯状态机，T017 只测 fresh/stale poison-sidecar；T032 没有断言成功腿的 `bootstrapSource: "local-build"`，[tasks.md:210](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:210)。此外 plan 明确要求修改既有两个 stale fixture，使其 graph 含 `graph.sourceCommit`，[plan.md:322](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:322)，tasks 中没有任务明确承载。
   - 证伪场景：所有纯函数正确，但 T019 传错四事实 flag，把成功本地构建记为 `unknown`；现有列出的测试仍可能通过。另一个实现可把 `unknown-provenance` 静默处理，T017 的 fresh/stale 两态仍绿。
   - 修法：新增完整 shell `--attempt-build` stub 接线测试，断言 `local-build`、embedded commit、HEAD、状态落盘；补 `fresh/dirty/stale/unknown` 四态的 bash warning 映射测试；把“两条既有 stale fixture 改造”明确归入 T017。

## WARNING

- **T012–T015 的红态缺乏目标特异性**：模块直到 T016 才创建，因此 T013/T014/T015 都会在测试收集阶段因同一模块缺失而失败，目标断言并未执行，[tasks.md:96](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:96)。建议合并成一个“模块缺失红测试”，或在 T012 后增加导出 skeleton，让后续测试因具体行为错误而红。

- **T022 的红态原因写错时点**：在 T022 执行时 T019 尚未落地，脚本根本没有 Node helper 调用，因此 PATH 去掉 node 不会触发 `set -e` 中断；真正失败的是“预期 warning 不存在”，[tasks.md:154](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:154)。应修正完成判据中的失败原因。

- **批 4 不能声称仅依赖批 1、可独立 checkpoint**：T024 显式依赖 T019，[tasks.md:164](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:164)，T028 又依赖 T024，[tasks.md:184](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:184)。可并行的只是批 4 的部分任务；完整批 4 checkpoint 实际依赖批 3。

- **测试策略第 16 步的“红”未保留**：plan 标为“红 + 回归修复”，[plan.md:414](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:414)；T026 明说首跑仍绿，T027 直接实施，没有一个先失败的“第 14 族缺失”断言，[tasks.md:174](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:174)。建议先新增对 `worktree-local-state:*` check namespace 的失败断言。

- **T002/T005 的 bash 探针入口无法从原文确认**：T005 只说新增内部函数，[tasks.md:47](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:47)，但现脚本不可安全 `source`，会继续解析参数并执行 git 主流程，[sync-worktree-local-state.sh:20](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:20)。应钉死可执行 probe 命令或 source-safe 分离方式，避免测试复制解析逻辑。

- **T029 的净增量判据计数错误，且没有最终闭环任务**：列出的其实是 4 个新测试文件加 1 个既有文件扩展，不是“5 个新文件”，[tasks.md:195](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:195)。同时 T031 不依赖 T032/T033；建议改为预计 `+4 test files`，并新增最终 checkpoint 依赖 T031、T032、T033。

- **T009 与 T032 的完成判据仍不够机械化**：T009 未明确 FR-005 全部 pattern 及 word-boundary 正反例矩阵，[spec.md:73](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:73)；T032 的“图可被查询工具读取”没有指定命令、退出码和输出断言，[tasks.md:210](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:210)。

## INFO

- 机械解析 33 个任务的 `依赖` 字段：**无环、无缺失 Task ID**。问题是依赖语义和批次声明，而不是图论环。
- 17 步测试策略都有形式落点，但第 13 步是假红、第 16 步没有红任务；13 FR/9 SC 也都有映射行，但映射不等于实际覆盖。
- 映射表中的 `FR-011 → T032（隔离环境验证）` 是错误交叉引用：T032 是 graph bootstrap 双腿计时，不做路径逃逸，[tasks.md:277](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:277)。
- 文档反复称“九类 reason”，实际列出的是 **8 个拒绝 reason + 1 个合法控制样本**，[tasks.md:27](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/tasks.md:27)。建议改名，避免实现者寻找不存在的第九个 reason。

## 批次 checkpoint 结论

| 批次 | 判断 |
|---|---|
| 批 1 | 有条件可绿；需先钉死 T002/T005 探针入口 |
| 批 2 | **不可绿**；ignored fixture 缺失，且 FR-002/004/012 证据不完整 |
| 批 3 | **不可作为可信 checkpoint**；T018 假红，SC-007 接线与旧 stale fixture 改造缺失 |
| 批 4 | 可部分并行，但完整 checkpoint 实际依赖 T019，不能独立于批 3 |
| 批 5 | 自动门禁可执行，但文件数判据错误，且未聚合两项手工验收 |

建议先修复全部 CRITICAL，并重新做一次只针对 tasks 的轻量复审，再进入 implement。本次审查全程只读，未修改仓库文件，也未执行任何 Git 写操作。

工具使用反馈：本次属于纯制品审查，未使用 Spectra MCP；Spec Driver 的完整 implement 流程因会进入写入/实施阶段而未启动，仅采用其合同与门禁口径。

Codex session ID: 019fc277-71a2-7d81-b9ae-9c0219fdcdb4
Resume in Codex: codex resume 019fc277-71a2-7d81-b9ae-9c0219fdcdb4
