# F266 Spec 合规审查报告（Phase 4a）

> 审查执行者：spec-driver:spec-review 子代理（工具集无 Write，报告由主编排器逐字转录落盘）。
> 审查基线：工作树相对 HEAD ee6e8314 的全部改动（第一轮实现完成时点）；其后的三轮对抗修复批次由
> `adversarial-review-disposition.md` 单独覆盖。

## 结论摘要

**0 CRITICAL / 1 WARNING / 3 INFO** · 14 条 FR 中 13 条完全合规（92.9%），1 条（FR-009）为已申报、
经用户裁决（方案 B）授权、类型系统层结构性锁定的部分实现。

## 逐条 FR 状态

| FR | 状态 | 关键证据 |
|----|------|---------|
| FR-001 | 已实现 | `module-derivation.ts` 两计数判据 + logger.warn，文案不杜撰 flag |
| FR-002 | 已实现 | graph-only 不经模块派生；测试断言 warn 调用数 0 |
| FR-003 | 已实现 | hook 段落改 graph-only；`graph.ts` 信息量守卫（严格不减 + `--force` 逃生 + 无基线放行） |
| FR-004 | 已实现 | README:158 与 cli-reference 两处改为如实描述（非增量解析） |
| FR-005 | 已实现（结构性验证） | `plugins/spectra/hooks/post-commit.sh` 零改动 + hash 常驻断言 |
| FR-006 | 已实现 | `isEmptyGraph`（`&&` 严格判据）→ cannot-assess/empty-graph，继承 exit 2 |
| FR-007 | 已实现（结构性验证） | 空图分支不可达 `describeBuilderStamp`；`exitCodeFor` 零改动 |
| FR-008 | 已实现 | 空图闸为纯新增分支；既有四 reason 与正常路径零改写 |
| FR-009 | **部分实现（已申报偏差）** | 三分 resolution + freshness 正交；成因②并入 `coverage-gap` 且 `separable: false` 为字面量类型（编译期锁定） |
| FR-010 | 已实现 | `generateNextStepHint` 按 (resolution × freshness) 组合；组合态双层含义 |
| FR-011 | 已实现 | honesty 追加式挂载；builderMismatch 独立字段不进 staleReasons |
| FR-012 | 已实现 | `buildComparisonScope` 产出 notation/gitRange/includesUncommitted 恒 false |
| FR-013 | 已实现 | 三接口以 `honesty?:` 可选字段追加；旧式断言全绿未改一行；schema enum 纯追加 |
| FR-014 | 已实现 | 本卡不改 graph producer；byte-stable 双跑 sha256 相等（stable 与 raw 均等） |

## 偏差裁定（实现者报备 3 处）

| 偏差 | 裁定 |
|------|------|
| `annotationDegraded?: true` 可选字段（plan 未列） | 可接受，无需回写 spec——宪法 IV 防御性诚实设计，追加式 |
| detect_changes `evidenceScope='graph'` | 可接受——Key Entities「证据粒度」对无单一 symbol 场景的必然推论 |
| hono 替代 nanoGPT 语料 | 可接受——nanoGPT 纯 Python（0 TS/JS）会产生假阴性验收；hono 是对 Constraint 9 精神的忠实执行 |

## FR-009 WARNING 详情

spec 字面要求「至少四种成因可区分」，交付为三分 + `coverage-gap` 合并态（`separable: false`）。
依据：graph.json 未持久化②的判别证据（`calleeKind:'unresolved'` 只活在抽取期），强行拆分等于造假
（宪法 IV）。用户已裁决方案 B。核验确认：`ResolutionReason` 三值枚举 + `separable` 字面量 `false`
类型，结构性禁止悄悄扩四分或丢声明。**建议**：在 M10 P1 轨道正式登记「graph producer 侧持久化
call-site 归因」候选卡（plan Q1 已给方案 A 设计草案），避免偏差被遗忘。

## 过度实现检查

未发现 CRITICAL 级过度实现。`--force`（plan Q7 YAGNI 例外论证在案）与 `FRESHNESS_TTL_MS`
（硬编码常量非配置项）均为必要补充能力。

## spec 同步建议

不修改 spec.md（偏差属"交付与字面有出入但已充分论证"，非"spec 描述错误"）；
tasks.md / plan.md 已如实记录。
