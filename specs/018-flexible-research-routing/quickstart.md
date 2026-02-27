# Quickstart: Feature 模式灵活调研路由

**Feature Branch**: `018-flexible-research-routing`

本指南帮助实现者快速理解变更范围和实施步骤。

---

## 变更概览

本特性修改 4 个现有文件，不新增文件：

| 文件 | 变更类型 | 预估变更量 |
|------|----------|-----------|
| `plugins/spec-driver/skills/speckit-feature/SKILL.md` | 重构 | +120 行 |
| `plugins/spec-driver/agents/tech-research.md` | 修改 | ~10 行 |
| `plugins/spec-driver/templates/driver-config-template.yaml` | 新增段落 | +18 行 |
| `driver-config.yaml` | 新增段落 | +3 行 |

---

## 快速实施路径

### Step 1: 配置文件（5 分钟）

在 `plugins/spec-driver/templates/driver-config-template.yaml` 的 `agents:` 段之后、`verification:` 段之前新增 `research:` 配置段：

```yaml
research:
  default_mode: auto
  custom_steps: []
```

在 `driver-config.yaml` 中同步新增相同配置段。

### Step 2: tech-research.md 软依赖降级（10 分钟）

修改 `plugins/spec-driver/agents/tech-research.md` 中的 5 处文本：

1. 角色描述: "基于产品调研结论" → "基于产品调研结论（如有）或需求描述"
2. 输入定义: "必须" → "如存在则读取，不存在则基于需求描述执行"
3. 执行流程第 1 步: 增加条件分支（有/无 product-research.md）
4. 约束: 删除"不可在产品调研完成前执行"
5. 失败处理: "返回失败" → "进入独立模式"

### Step 3: SKILL.md 编排器重构（30 分钟）

按以下顺序修改 `plugins/spec-driver/skills/speckit-feature/SKILL.md`：

1. **输入解析**: 在参数表格新增 `--research <mode>` 行
2. **新增 Phase 0.5**: 在 Phase 0 和 Phase 1a 之间插入"调研模式确定"段落
3. **重构 Phase 1a-1c**: 将固定流水线改为条件执行（根据 `research_mode`）
4. **新增 codebase-scan**: 定义代码库扫描步骤（复用 Story 模式逻辑）
5. **适配 GATE_RESEARCH**: 添加模式感知的分级门禁逻辑
6. **适配上下文注入**: Phase 2（specify）和 Phase 4（plan）的调研制品引用改为动态
7. **适配完成报告**: 制品列表根据模式动态生成
8. **适配 `--rerun research`**: 重跑时重新进入模式确定流程

---

## 验证清单

完成实现后，依次验证以下场景：

- [ ] `full` 模式: 行为与修改前 100% 一致（SC-001）
- [ ] `skip` 模式: 不调用任何调研子代理，后续阶段正常完成（SC-002）
- [ ] `tech-only` 模式: 仅调用技术调研子代理（SC-003）
- [ ] 智能推荐: 对不同需求描述推荐合理模式（SC-004）
- [ ] 未配置 `research` 段: 行为与升级前一致（SC-005）
- [ ] `--research` 参数: 正确覆盖配置和推荐（SC-006）

---

## 关键约束提醒

1. **向后兼容是第一优先级**: 未配置时行为不变，`full` 模式 = 当前行为
2. **不新增文件**: 所有变更通过修改现有 Prompt 文本实现
3. **零运行时依赖**: 不引入任何代码逻辑，纯 Prompt 工程
4. **进度分母固定为 10**: 跳过的步骤显示 "[已跳过]"，不改变编号体系
5. **GATE_DESIGN 始终启用**: 不因跳过调研而间接绕过设计门禁
