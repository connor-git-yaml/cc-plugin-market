---
feature: "092-config-ux-and-cross-feature-guard"
type: requirements-checklist
date: 2026-04-06
---

# Requirements Checklist -- Feature 092

## Functional Requirements

- [ ] **FR-001**: init-project.sh 对 spec-driver.config.yaml 执行 Schema 校验，失败时输出错误位置和修复建议
- [ ] **FR-002**: Schema 校验区分 YAML 语法错误和 Schema 结构错误，分别输出不同错误信息
- [ ] **FR-003**: 编排器初始化输出 effective config 表（生效值 + 来源层级）
- [ ] **FR-004**: effective config 覆盖所有配置层级（命令行参数 / Agent 覆盖 / preset 默认值 / 内置默认值）
- [ ] **FR-005**: analyze Agent 包含 Pass G 跨 Feature 文件冲突检测，扫描近 5 个 Feature 的 tasks.md
- [ ] **FR-006**: 冲突检测排除通用配置文件，仅检测 src/、plugins/、scripts/ 下的文件
- [ ] **FR-007**: 冲突检测按严重性分级（HIGH/MEDIUM/LOW）
- [ ] **FR-008**: spec-driver.config.yaml 支持 verification.timeout 字段（正整数，默认 300）
- [ ] **FR-009**: verify Agent 执行验证命令时应用 verification.timeout 超时值
- [ ] **FR-010**: sync Agent 包含矛盾检测（数值冲突 + 行为描述冲突）
- [ ] **FR-011**: sync Agent 包含术语一致性检查
- [ ] **FR-012**: 8 个 SKILL.md frontmatter 包含 allowed-tools / model / effort 声明
- [ ] **FR-013**: Schema 校验脚本采用 createCheck() 标准化检查结果模式
- [ ] **FR-014**: 零新增外部依赖（仅用 simple-yaml.mjs + Zod + Node.js 内置模块）

## Non-Functional Requirements

- [ ] **NFR-001**: Schema 校验脚本执行时间不超过 2 秒
- [ ] **NFR-002**: 所有变更为追加型，不删除现有逻辑，不修改 SKILL.md body
- [ ] **NFR-003**: 新增代码遵循 scripts/lib/ 模块化风格
- [ ] **NFR-004**: 与 090 并行开发无冲突（frontmatter vs body 分区）

## User Story Acceptance

### Story 1: 配置错误提前发现 (P1)
- [ ] 拼写错误字段输出修复建议
- [ ] 非法值输出合法值列表
- [ ] 合法配置校验通过，无额外输出

### Story 2: 配置透明化 (P1)
- [ ] effective config 显示来自 config.yaml 的配置项及来源
- [ ] effective config 显示使用内置默认值的配置项及来源
- [ ] effective config 显示命令行参数覆盖的配置项及来源

### Story 3: 跨 Feature 冲突预警 (P2)
- [ ] 文件重叠时输出 OVERLAP_WARNING 及文件列表
- [ ] 通用配置文件重叠时不触发告警
- [ ] 无重叠时输出 Pass G: CLEAN

### Story 4: 验证命令超时保护 (P2)
- [ ] 超时值生效，超时命令被终止
- [ ] 未配置时使用默认值 300 秒
- [ ] 非法超时值被 Schema 校验拦截

### Story 5: sync 文档矛盾检测 (P3)
- [ ] 检测术语不一致
- [ ] 检测数值矛盾
- [ ] 无矛盾时检测通过

### Story 6: Skill frontmatter 声明 (P3)
- [ ] 8 个 SKILL.md 含 allowed-tools / model / effort
- [ ] model 字段值合法（opus/sonnet/haiku）
- [ ] effort 字段值合法（low/medium/high）

## Edge Cases

- [ ] 空配置文件（0 字节）时输出友好提示
- [ ] YAML 语法错误时输出语法错误（非 Schema 错误）
- [ ] specs/ 下不足 5 个 Feature 时扫描所有可用 Feature
- [ ] 近期 Feature 缺少 tasks.md 时跳过继续
- [ ] verification.timeout 极大值时输出警告

## Integration

- [ ] `npm run repo:check` 全部 pass
- [ ] 与 090（implement-mid-gate）无合并冲突
- [ ] Schema 校验结果可被 repo:check 链路消费

## Success Criteria

- [ ] **SC-001**: 3 种结构错误分别获得正确校验错误和修复建议
- [ ] **SC-002**: effective config 表覆盖所有配置项且来源标注正确
- [ ] **SC-003**: Pass G 对重叠场景正确输出 OVERLAP_WARNING
- [ ] **SC-004**: Zod Schema 包含 verification.timeout 字段定义
- [ ] **SC-005**: sync.md 对矛盾场景正确输出警告
- [ ] **SC-006**: 8 个 SKILL.md frontmatter 声明完整
- [ ] **SC-007**: npm run repo:check 全部 pass
- [ ] **SC-008**: 零新增外部依赖
