# Implementation Plan: 故障排查 / 原理说明文档

## 目标

实现 `TroubleshootingGenerator`，从源码和配置中提取可追溯的 troubleshooting entries，并在证据充分时生成 explanation 补充说明。

## 范围

- 新增 `src/panoramic/troubleshooting-generator.ts`
- 新增 `templates/troubleshooting.hbs`
- 注册到 `GeneratorRegistry`
- 增加单测与 registry / barrel 集成验证

## 非目标

- 不实现 FAQ 问答生成
- 不依赖 LLM 才能生成文档
- 不做运行时日志聚合或线上 telemetry 分析

## 设计

### 1. 抽取阶段

静态扫描：
- 显式错误模式：`throw new Error` / `logger.error` / `console.error`
- 配置约束：`process.env.*` / `getenv(...)` / `os.getenv(...)`
- 恢复提示：`retry` / `reconnect` / `fallback` / `recover`

### 2. 聚合阶段

按“配置键”或“错误消息”合并条目：
- 去重
- 合并位置 / evidence
- 基于 recovery 关键词补充 steps

### 3. 渲染阶段

主文档包含：
- 总览与 warnings
- troubleshooting entry 主表
- 每条问题的 symptom / causes / recovery / locations
- explanation 背景说明

## 文件变更

### 新增

- `src/panoramic/troubleshooting-generator.ts`
- `templates/troubleshooting.hbs`
- `tests/panoramic/troubleshooting-generator.test.ts`
- `specs/048-troubleshooting-explanation-docs/*`

### 修改

- `src/panoramic/generator-registry.ts`
- `src/panoramic/index.ts`
