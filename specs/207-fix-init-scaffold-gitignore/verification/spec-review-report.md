# Spec 合规审查报告（Phase 4a）

> 审查者：spec-review 子代理（sonnet）；报告由编排器代为落盘（子代理工具集无 Write）。
> 权威依据：plan.md §1.1/§2/§5 + tasks.md T001-T008 + fix-report.md「已知边界」。

## 逐条 FR/契约状态

| 条目 | 描述 | 状态 | 证据 |
|------|------|------|------|
| plan §1.1-1 | 4 条固定 ignore 条目字面量 | 已实现 | `ensure-gitignore.sh:15-20` 与 plan.md §1.1 逐字一致 |
| plan §1.1-2 | 三态 stdout（created:N/appended:N/ready:0） | 已实现 | `ensure-gitignore.sh:49,65,83` |
| plan §1.1-2 追加不带注释头 | 幂等最简实现的裁量 | 已实现 | 创建时才写注释头（L43），追加分支无注释头写入 |
| plan §1.1-3 | 全部就位不触碰文件（mtime 不变） | 已实现 | `ensure-gitignore.sh:64-67` 直接 return，无任何写操作 |
| plan §1.1-4 | 非 git 目录也正常写入 | 已实现 | 代码全程不检测 `.git/` 存在性，测试用例 4 显式断言 |
| plan §1.1-5 | 不用裸露 set -e 连锁写法 | 已实现 | 全函数无顶层 `set -e`；每个写操作后 `\|\| return 0` |
| plan §1.1 末尾无换行边界 | 追加前补 `\n` | 已实现 | `ensure-gitignore.sh:71-76`（command substitution 剥离末尾换行的特性被正确利用） |
| plan §1.1 退出码契约 | project_root 为空/非目录返回 1，其余恒 0 | 已实现 | `ensure-gitignore.sh:34-36` |
| plan §1.2 | init-project.sh 接入（source 位置、step 函数、顺序） | 已实现 | `init-project.sh:49,297-318,320-331`，顺序与 plan 一致 |
| plan §1.2 | init-project-output.sh text 分支 | 已实现 | `init-project-output.sh:123-134` 四态齐全 |
| plan §1.3 | postinstall.sh 静默接入 + `\|\| true` 防御 | 已实现 | `postinstall.sh:46-51` |
| plan §2 六场景规格表 | — | 5/6 有显式断言，1 条隐含覆盖 | 见偏差清单 WARNING-1 |
| plan §3 测试方案 7 用例 | — | 已实现（node:test 裁量合理） | `ensure-gitignore.test.mjs` 7 个 it 块逐条对应 |
| plan §5 回归防御 1/2/3/5/6 | — | 已实现 | 逐项代码核实通过 |
| tasks T001-T007 | — | 已实现 | 逐项验收标准核实通过 |
| tasks T008 | 全量验证 | 未验证/待办（诚实标注，Phase 4c 执行） | tasks.md checkbox 未勾选 |
| fix-report 已知边界 1-3 | project-context.yaml / specs/NNN-*/ 不被误 ignore | 已实现，未越界 | lib 无相关字符串 |
| release:sync 传播 5 文件 | 仅版本号/描述受控字段 | 已实现，未越界 | 抽查均只含 4.2.2 与 productMappingDescription 增量 |

**总体合规率**：12/13 项契约条目已实现（约 92%），1 项测试覆盖缺口。

## 偏差清单

| # | 档位 | 条目 | 偏差描述 | 修复建议 |
|---|------|------|---------|---------|
| W1 | WARNING | plan §2「精确匹配非误判」场景 | 6 个规格场景中唯一无专属测试用例的一条；`grep -qxF` 的 `-x` 精确匹配是关键安全网（避免 `.specify/runs/debug.log` 类宽松内容误判为已 ignore 而漏注入），当前无可执行回归防线 | 补测试：预写含 `.specify/runs/debug.log` 的 .gitignore，断言 `.specify/runs/` 仍被追加 |
| W2 | WARNING | plan §3 + tasks T005/T008「纳入 vitest 套件」表述 | `vitest.config.ts` 的 include 全部限定 `tests/**/*.test.ts`，`npx vitest run` 完全不会加载本测试文件；实际运行链路是 `npm run test:plugins`（`node --test`）。实现层面选 node:test 是正确裁量（与既有 6 个 sibling 一致），失实的是 plan/tasks 文档的验证命令口径，会误导后续验证者"vitest 全绿即含本测试" | 更正 plan.md §3 与 tasks.md T008 的验证命令表述为 `npm run test:plugins` / `npm test` |
| I1 | INFO | tasks.md T008 | checkbox 未勾选，全量验证未留痕 | Phase 4c 实际执行后勾选 |
| I2 | INFO | `ensure-gitignore.sh:48` 写入失败路径 | 写入失败时静默 return 0 且无 stdout，上层落入 `gitignore:unknown` 而非语义更准的 `skip_error` | 可选：写入失败分支显式 return 1，让调用方 `\|\| { }` 捕获为 skip_error；非阻塞 |

## 过度实现检测

未发现 spec/plan 未定义的额外公共 API、配置项或用户可见行为；无越权改动 project-context.yaml 或 specs/NNN-*/ 的 ignore 行为。

## 问题分级汇总

- **CRITICAL: 0**
- **WARNING: 2**（W1 精确匹配场景无测试；W2 plan/tasks 验证口径失实）
- **INFO: 2**（I1 T008 待执行；I2 写入失败信号精度）

**最严重一条**：plan/tasks 声称新增测试可用 `npx vitest run` 验证，但 vitest 配置根本不收该文件，实际只能靠 `npm run test:plugins`——文档层面的验证口径失实，机械照抄会导致"测试从未真正执行过"的误判。
