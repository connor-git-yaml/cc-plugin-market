# 任务分解

- [x] T1: 创建 src/panoramic/internal.ts — 从 index.ts 迁移全部非公共符号 + @internal JSDoc
- [x] T2: 重写 src/panoramic/index.ts — 仅保留 15 个公共 API 符号（≤60 行）
- [x] T3: 修复 tests/panoramic/architecture-ir-generator.test.ts 导入路径
- [x] T4: 修复 tests/panoramic/architecture-overview-generator.test.ts 导入路径
- [x] T5: 修复 tests/panoramic/pattern-hints-generator.test.ts 导入路径
- [x] T6: 修复 tests/panoramic/architecture-ir-builder.test.ts 导入路径
- [x] T7: 修复 tests/panoramic/event-surface-generator.test.ts 动态 import
- [x] T8: 修复 tests/panoramic/runtime-topology-generator.test.ts 动态 import
- [x] T9: 修复 tests/panoramic/troubleshooting-generator.test.ts 动态 import
- [x] T10: 运行 npm run build 验证 — 通过
- [x] T11: 运行 vitest run 全量测试验证 — 39 文件 / 426 测试全部通过
