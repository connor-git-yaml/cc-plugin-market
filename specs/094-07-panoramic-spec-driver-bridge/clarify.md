# F-094-07 需求澄清报告

**执行日期**: 2026-04-11
**Spec 文件**: specs/094-07-panoramic-spec-driver-bridge/spec.md
**状态**: 5 个问题全部自动解决

---

## 歧义扫描总览

| 类别 | 状态 | 说明 |
|------|------|------|
| 功能范围与行为 | Clear | `--project-root` 参数已补充为 FR-015 |
| 领域与数据模型 | Clear | Blueprint 字段名差异已注明以源码为准 |
| 交互与 UX 流程 | Clear | 用户旅程和错误状态描述完整 |
| 集成与外部依赖 | Clear | MCP 参数名确定为 `operation` |
| 术语一致性 | Clear | FR-010/FR-014 措辞已统一 |

---

## 自动解决的澄清

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| C-00 | MCP 参数名 `operation` vs `analyzer` | 保留 `operation` | `operation` 语义更准确（操作类型而非分析器实例），与 CLI 子操作名对称一致；Blueprint 为示意性伪代码 |
| C-01 | CLI `--project-root` 参数遗漏 | 新增 FR-015，可选参数默认 cwd | Blueprint 三个子命令均附带此参数 |
| C-02 | Blueprint 字段名 `cycles`/`topologyLevels` 与源码不一致 | 以 spec/源码为准 | `CrossPackageOutput` 实际字段已由 tech-research 确认 |
| C-03 | FR-014 集成测试 MAY vs Blueprint 强制标准 | 升级为 SHOULD | Blueprint 验收标准为里程碑门禁 |
| C-04 | FR-010 SHOULD/[必须] 措辞矛盾 | 统一为 SHOULD/[应当] | US-4 优先级 P3，[必须] 系笔误 |
