# Implementation Plan: 事件面文档

## 目标

实现 `EventSurfaceGenerator`，为项目生成事件面 inventory：

- channel / topic / queue 列表
- publisher / subscriber 映射
- 消息 payload 摘要
- 可选低置信状态附录

## 范围

- 新增 `src/panoramic/event-surface-generator.ts`
- 新增 `templates/event-surface.hbs`
- 注册到 `GeneratorRegistry`
- 增加单测与 registry 集成验证

## 非目标

- 不实现完整 AsyncAPI 文档
- 不依赖运行时 tracing 或日志采样
- 不把状态机推断作为主交付物

## 设计

### 1. 抽取阶段

输入来源：
- TypeScript / JavaScript AST
- 轻量文本模式回退

识别模式：
- 发布：`emit`, `publish`, `send`, `dispatch`
- 订阅：`on`, `once`, `addListener`, `subscribe`, `consume`, `listen`

### 2. 聚合阶段

按 channel 聚合：
- `kind`
- `publishers`
- `subscribers`
- `messageShapes`
- `evidenceFiles`

### 3. 渲染阶段

主文档包含：
- 总览与统计
- channel inventory 表
- 每个 channel 的 publisher / subscriber / payload 摘要

可选附录：
- `[推断]` 状态图 Mermaid

## 文件变更

### 新增

- `src/panoramic/event-surface-generator.ts`
- `templates/event-surface.hbs`
- `tests/panoramic/event-surface-generator.test.ts`
- `specs/047-event-surface-documentation/*`

### 修改

- `src/panoramic/generator-registry.ts`
- `src/panoramic/index.ts`
