# Fix 112 任务列表

- [x] T1: 修改 `src/config/project-config.ts` — 更新 `CONFIG_FILENAMES` 数组和文件头注释
- [x] T2: 修改 `src/batch/checkpoint.ts` — 更新默认路径常量，新增迁移逻辑
- [x] T3: 修改 `tests/unit/project-config.test.ts` — 新增 `.spectra.*` 测试用例
- [x] T4: 修改 `tests/self-hosting/self-host.test.ts` — 更新品牌名
- [x] T5: 修改 `tests/unit/model-selection.test.ts` — 更新临时目录前缀
- [x] T6: 执行 `npm run build` + `npx vitest run` 验证
