# C3 canonical AST fixture 说明

每个目录对应 plan §7.3 / spec FR-009(c) 的一个判定合同：

- `fresh-*`：两个变体 MUST 产生**相同**指纹（注释 / JSDoc / 格式化 / 语法噪声免疫）。
- `stale-*`：两个变体 MUST 产生**不同**指纹（标识符 / 字面值 / 控制结构 / 一元运算符 /
  声明关键字 / 重载后续声明变化）。
- `stale-unary-*` / `stale-decl-kind` / `stale-using-vs-var` / `stale-await-using`
  是 C-2 与 N-1 实测漏报组：朴素实现下两变体 token 序列**完全相同**，是防回归核心资产。
- `lang-mts-cts`：N-3，`.mts`/`.cts` MUST 判为受支持语言。
- `fingerprint-version-mismatch`：源文件不变，由测试构造旧 `fingerprintVersion` /
  `normalizationProfile` 的 lock 条目，验证 SC-005「版本升级不误报批量 stale」。
