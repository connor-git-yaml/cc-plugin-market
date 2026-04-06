# Feature 087 — 技术规划

## 方案总览

11 个 FR 按 4 个模块分批实施。全部为 Markdown/YAML/Bash 变更 + 脚本目录重组，不涉及 TypeScript 源码。

## 实施模块

### M1: 制品 Schema + Trace（FR-1, FR-2, FR-7）
- 创建 14 个 `agents/*.artifact.yaml`（标准化格式）
- 在 feature SKILL.md 追加 Trace 写入逻辑
- 追加错误传播链路（降级原因 + root cause 传播）

### M2: SKILL.md 性能优化（FR-3 ~ FR-6）
- 自适应入口检测：feature/story/implement SKILL.md 初始化阶段
- Constitution 内联检查：替代独立 agent 调用
- Plan+Tasks 合并调用：story SKILL.md
- 增量验证策略：feature/story SKILL.md

### M3: 治理精简（FR-8 ~ FR-10）
- 脚本目录重组：experimental/ 分离
- sync.md 健康度检查追加
- constitution.md 可量化约束追加

### M4: contributor-guide（FR-11）
- 新增 docs/contributor-guide.md

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 新增文件 | ~18（14 artifact.yaml + contributor-guide + experimental/ 移动） |
| 修改文件 | ~8（SKILL.md x3 + sync.md + constitution.md + 脚本） |
| 风险等级 | MEDIUM（SKILL.md 追加较多，需仔细验证行为不退化） |

## 依赖顺序

M1（基础制品合同）→ M2（SKILL.md 优化引用 artifact）→ M3（治理精简）→ M4（文档）
