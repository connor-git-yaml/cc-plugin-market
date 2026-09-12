# F285 plan

| # | 步骤 | 落点 | 验收 |
|---|---|---|---|
| P1 | prepublishOnly 接 typecheck:tests + test:plugins | package.json | 守护测试钉顺序 |
| P2 | 覆盖率阈值接 CI：独立 coverage job | ci.yml | 本机 `test:coverage` exit 0、阈值达标 |
| P3 | tsconfig.tests.json + typecheck:tests:full；CI 只报不阻断步骤 + 计数 | tsconfig.tests.json / package.json / ci.yml | 本机 1022 / 147 基线登记 |
| P4 | CI Test 步只跑 vitest（mjs 面单跑） | ci.yml | `run: npm run test:plugins` 恰 1 行 |
| P5 | 删 claude-review.yml | .github/workflows | 文件缺席 |
| P6 | 守护测试 + 全量门禁 + verify 子代理 | tests/unit/release-ci-gates.test.ts, verification/ | 全绿 |
| P7 | rebase master + ff push | — | 零失败 |

不做：修测试类型错误；full 门阻断；改 npm test；其它 workflow。
