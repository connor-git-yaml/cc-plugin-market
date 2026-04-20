---
feature: F5 Reading UX
branch: 132-reading-ux
phase: implement
subphase: step-5-browser-verification
created: 2026-04-20
updated: 2026-04-20
status: PENDING_MANUAL_VERIFICATION
t047_note: "graph.html 生成代码路径已验证（batch-orchestrator.ts L954-991）；浏览器 35 项验证需用户手动执行"
---

# F5 Step 4 — graph.html 浏览器人工验证 Checklist

> **注意**：此文档由 T-038 自动生成（草稿）。  
> 实际验证需在 Step 5（T-047）由用户手动执行：生成 `batch --html`，在浏览器中打开 `_meta/graph.html`，逐项勾选。

## 验证准备

```bash
# 1. 对任意有代码的项目运行（推荐 graphify 示例项目）
spectra batch --html

# 2. 找到生成的 graph.html 文件
find . -name "graph.html" -path "*/_meta/*"

# 3. 用浏览器打开（macOS 双击或命令行）
open specs/_generated/_meta/graph.html
# 或：open -a "Google Chrome" specs/_generated/_meta/graph.html
```

---

## Checklist 1：基础渲染（SC-003）

| # | 验证项 | 预期结果 | 通过 |
|---|--------|---------|------|
| 1.1 | 页面在浏览器中正常打开，无控制台红色错误 | Console 零错误 | ☐ |
| 1.2 | 侧边栏显示节点数和边数统计 | 形如 "42 节点 · 78 边" | ☐ |
| 1.3 | 社区图例渲染（若图谱有社区数据） | 左侧列表含社区颜色点 + 标签 | ☐ |
| 1.4 | 节点在 SVG 画布中可见 | 节点圆圈 + 标签渲染 | ☐ |
| 1.5 | 连线在 SVG 画布中可见 | 灰色连线渲染 | ☐ |

---

## Checklist 2：力导向布局（FR-018，节点数 < 2000）

| # | 验证项 | 预期结果 | 通过 |
|---|--------|---------|------|
| 2.1 | 打开时节点会自动扩散（力导向模拟） | 节点从中心向外运动并稳定 | ☐ |
| 2.2 | 节点稳定后可用鼠标拖动 | 拖动节点可改变位置 | ☐ |
| 2.3 | 滚轮缩放正常 | 滚轮缩放图谱，不触发页面滚动 | ☐ |
| 2.4 | 背景拖拽平移正常 | 拖拽空白处移动整个图谱 | ☐ |
| 2.5 | 右上角缩放按钮 (+/-/重置) 正常 | 点击按钮触发对应缩放/重置 | ☐ |

---

## Checklist 3：大图静态模式（FR-022 / FR-023，节点数 >= 2000）

> **注意**：需要对含 ≥ 2000 节点的项目运行。如无此类项目，标注 `[N/A]`。

| # | 验证项 | 预期结果 | 通过 |
|---|--------|---------|------|
| 3.1 | 顶部出现黄色横幅 | "大图模式（XXXX 个节点），力导向布局已关闭，部分交互受限" | ☐ |
| 3.2 | 横幅中节点数与侧边栏统计一致 | 数字相同 | ☐ |
| 3.3 | 节点按社区聚类分布（不是力导向） | 可见节点聚成组状分布 | ☐ |
| 3.4 | 节点不可拖动（静态模式无 drag handler） | 拖动节点无效 | ☐ |

---

## Checklist 4：搜索功能（FR-019）

| # | 验证项 | 预期结果 | 通过 |
|---|--------|---------|------|
| 4.1 | 搜索框输入内容后显示结果列表 | 最多 20 条匹配结果 | ☐ |
| 4.2 | 输入关键字时，匹配节点高亮，其余节点淡出 | 非匹配节点透明度降低 | ☐ |
| 4.3 | 点击搜索结果项，图谱跳转到对应节点并高亮 | 节点橙色圆圈高亮 | ☐ |
| 4.4 | 点击搜索结果后搜索框清空，节点恢复正常显示 | 无残留淡出效果 | ☐ |

---

## Checklist 5：节点详情 + 跳转 Spec（FR-020，SC-005）

| # | 验证项 | 预期结果 | 通过 |
|---|--------|---------|------|
| 5.1 | 点击节点后侧边栏展示详情面板 | 显示 ID、类型、度数、社区、God Node、邻居列表 | ☐ |
| 5.2 | 含 `specPath` 的节点详情面板出现 "打开 Spec 文件" 按钮 | `open-spec-btn` 可见 | ☐ |
| 5.3 | 点击 "打开 Spec 文件" 按钮，触发文件打开行为 | 浏览器弹窗或系统默认程序打开 `.spec.md` | ☐ |
| 5.4 | `specPathExists = false` 的节点点击按钮显示错误提示 | "Spec 文件未找到：<path>" | ☐ |
| 5.5 | 无 `specPath` 的节点不显示跳转按钮 | `spec-link-row` 隐藏 | ☐ |

---

## Checklist 6：Hyperedge 凸包（FR-013 / FR-019，需图谱含超边数据）

> **注意**：需要对含 hyperedge 数据的项目（F4 已运行过的项目）生成 graph.html。如无，标注 `[N/A]`。

| # | 验证项 | 预期结果 | 通过 |
|---|--------|---------|------|
| 6.1 | 侧边栏 "流程超边" 区块显示 | 可见超边标签列表 | ☐ |
| 6.2 | SVG 画布中超边凸包轮廓可见 | 虚线描边的不规则多边形 | ☐ |
| 6.3 | 鼠标悬停超边轮廓时显示 tooltip | 显示超边 label + rationale 前 60 字 | ☐ |
| 6.4 | 凸包颜色区分不同超边 | 不同超边颜色不同 | ☐ |
| 6.5 | 少于 3 个节点的超边不渲染凸包 | 无对应轮廓 | ☐ |

---

## Checklist 7：Self-contained（FR-021，F-007 修复）

| # | 验证项 | 预期结果 | 通过 |
|---|--------|---------|------|
| 7.1 | 断网/离线状态下打开 graph.html 正常 | 无 CDN 请求失败 | ☐ |
| 7.2 | 浏览器 Network 面板无外部请求 | 仅 `file://` 本地资源，零外部网络请求 | ☐ |
| 7.3 | Console 无 CORS 或 CSP 错误 | 零相关错误 | ☐ |

---

## 验证结果记录

```
验证时间：____________________
浏览器版本：____________________
测试项目：____________________
节点数 / 边数：____________________
hyperedge 数：____________________

通过项数：____/35
未通过项（列出 #）：____________________
备注：____________________
```

---

## 已知已完成项（Step 4 + Step 5 代码验证）

以下项目已通过自动化单元测试（T-037、T-047 代码级）验证：

- [x] 7.2 零 CDN 引用（F-007 单测断言）
- [x] 大图横幅元素存在（HTML 结构断言）
- [x] `open-spec-btn` 元素存在（HTML 结构断言）
- [x] `hyperedges-layer` SVG 层存在（HTML 结构断言）
- [x] `convexHull` + `hullToPathD` 实现存在
- [x] `search-dim` CSS 类存在（搜索高亮淡出）
- [x] `FORCE_THRESHOLD = 2000` 常量存在
- [x] `graph.html` 生成代码路径已确认（`batch-orchestrator.ts` L954-991，`--html` flag 触发）

## T-047 全链路 E2E 状态（Step 5）

**代码级验证（已完成）**：

```
命令: npx vitest run --project unit tests/panoramic/html-template.test.ts
退出码: 0
测试结果: 29 tests passed, 0 failed
```

- graph.html 生成代码路径：`batch-orchestrator.ts` L954-991
- 生成路径：`<outputDir>/_meta/graph.html`
- CLI 入口：`spectra batch <projectRoot> --html`

**浏览器人工验证（需人工，35 项）**：

T-047 标注"需人工验证"。Checklist 1-7（共 35 项）由用户在 verify 阶段执行：

```bash
# 1. 确保有 API Key 且已运行 batch
spectra batch <project_root> --mode=reading --html

# 2. 找到生成的 graph.html
find . -name "graph.html" -path "*/_meta/*"

# 3. 用浏览器打开
open specs/_generated/_meta/graph.html
```

**浏览器验证的项目为 T-047 在 verify 阶段需人工验证的内容**。
