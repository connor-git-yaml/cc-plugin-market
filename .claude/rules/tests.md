---
paths:
  - "tests/**"
---

## 测试规范

- 测试文件以 `.test.ts` 或 `.spec.ts` 结尾，与被测文件同名
- 单元测试使用 vitest；集成测试放 `tests/integration/`
- 测试中不使用 `any` 类型；Mock 对象需标注类型
- 覆盖率门槛：80%（branches/functions/lines/statements）
- 避免测试间共享可变状态；每个测试用例独立
- 异步测试使用 async/await，不使用 done callback
