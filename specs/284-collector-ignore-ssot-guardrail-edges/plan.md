# F284 plan

| # | 步骤 | 落点 | 验收 |
|---|---|---|---|
| P1 | 接口 `ignoreDirs` + 六面声明 + 两个适配器声明集 + `mergeSurfaces` 并集 | `src/collector-surface.ts` | tsc 0 |
| P2 | 消费方改引用（source-discovery / ignore-oracle / 四适配器 / file-scanner / generic collector） | 各文件 | 六处 `===` 同一性 |
| P3 | 守卫双向：oracle 测试 `⊆`→相等；新 `collector-surface-ignore-dirs.test.ts`（内容钉死 + 源码层零第二份） | tests | 全绿 |
| P4 | 护栏三面：边属性值级 / 节点顶层 key / 图顶层 key + hyperedges；稳定序列化；JSDoc 边界改写 | `scripts/regen-collector-fingerprint-fixtures.ts` | 护栏用例含新维度全绿；四条变异用例 |
| P5 | 外部语料 A/B（GORM / HikariCP / micrograd）：master dist vs 本卡 dist graph-only 归一化逐字节比对 | `verification/` | 逐字节相同 ⇒ 不 bump BEHAVIOR_VERSION |
| P6 | 异构对抗复审 ≥2 角 + verify 子代理 | `verification/` | CRITICAL 清零 |
| P7 | 门禁 + rebase master + ff push | — | vitest / build / test:plugins / repo:check / release:check 零失败 |

不做：ignoreDirs 进指纹；F279 移交面 #4–#6；非采集面字面量；改 oracle 对 generic collector 的假定（登记）。
