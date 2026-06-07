# 修复任务 — Feature 179

## T01 — 核心修复：batch-orchestrator stripTimestamps

- **文件**：`src/batch/batch-orchestrator.ts`
- **位置**：第 1565 行
- **改动**：
  ```typescript
  // Before
  normalizeGraphForWrite(graphJson);
  // After
  normalizeGraphForWrite(graphJson, { stripTimestamps: true });
  ```
- **验收**：修改后 graph.json 落盘时 `graph.generatedAt` 为 `'1970-01-01T00:00:00.000Z'`

---

## T02 — 注释更新：F175 E2E readNormalizedGraph

- **文件**：`tests/e2e/feature-175-batch-incremental.e2e.test.ts`
- **位置**：L210-226（`readNormalizedGraph` JSDoc 注释）
- **改动**：更新注释说明 F179 修复后落盘侧已 byte-stable，`delete generatedAt` 保留为防御兜底
- **注意**：不改逻辑，仅改注释文字

---

## T03 — eval-task-runner 补 --full

- **文件**：`scripts/eval-task-runner.mjs`
- **位置**：L286（`spawnSync` args 数组）
- **改动**：
  ```js
  // Before
  const r = spawnSync('node', [distCli, 'batch', '--mode', 'code-only', '--no-html'], {
  // After
  const r = spawnSync('node', [distCli, 'batch', '--mode', 'code-only', '--no-html', '--full'], {
  ```

---

## T04 — feature-170c 补 --full

- **文件**：`scripts/feature-170c-sc002-driver-eval.mjs`
- **位置**：L121（`spawnSync` args 数组）
- **改动**：同 T03，在 `--no-html` 后追加 `'--full'`

---

## T05 — feature-170d 补 --full

- **文件**：`scripts/feature-170d-driver-preference.mjs`
- **位置**：L145（`spawnSync` args 数组）
- **改动**：同 T03，在 `--no-html` 后追加 `'--full'`

---

## T06 — driver-eval-core prompt 更新

- **文件**：`scripts/lib/driver-eval-core.mjs`
- **位置**：L17（prompt 字符串）
- **改动**：将字符串内的 `findFuzzyMatches` 改为 `resolveSymbolFuzzy`

---

## T07 — feature-170c prompt 更新

- **文件**：`scripts/feature-170c-sc002-driver-eval.mjs`
- **位置**：L50（prompt 字符串）
- **改动**：将字符串内的 `findFuzzyMatches` 改为 `resolveSymbolFuzzy`

---

## 验收标准（全部通过才可提交）

- [ ] T01-T07 全部改动已实施
- [ ] `npx vitest run` → 4111+ pass, 0 fail
- [ ] `npm run build` → 零类型错误
- [ ] `npm run repo:check` → 零报错
- [ ] 手动核查 graph.json 中 `graph.generatedAt` = epoch（可通过单元测试或快速 CLI 调用验证）
