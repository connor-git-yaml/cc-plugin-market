# 文档覆盖率审计报告

生成时间: 2026-04-30T08:18:27.002Z

## 总览

| 指标 | 数值 |
|------|------|
| 应文档化模块数 | 9 |
| 已文档化模块数 | 6 |
| 模块覆盖率 | 66.7% |
| 缺少文档模块 | 3 |
| 缺少交叉引用 | 0 |
| 断链条目 | 0 |
| 低置信度文档 | 2 |
| 适用 generators | 4 |
| 已生成 project docs | 0 |

## Generator Coverage

| Generator | Scope | Expected | Generated | Missing | Coverage |
|-----------|-------|----------|-----------|---------|----------|
| `data-model` | project | 1 | 0 | 1 | 0% |
| `event-surface` | project | 1 | 0 | 1 | 0% |
| `module-spec` | module | 9 | 6 | 3 | 66.7% |
| `troubleshooting` | project | 1 | 0 | 1 | 0% |

## 模块层级分布

| Level | Total | Documented | Attention | Missing Doc |
|-------|-------|------------|-----------|-------------|
| 0 | 9 | 4 | 2 | 3 |

## 缺失文档模块

- `config`
- `data__shakespeare__prepare_py`
- `data__shakespeare_char__prepare_py`

## 需要关注的模块

- `configurator.py`:
  状态 `attention`，问题 low-confidence
- `sample.py`:
  状态 `attention`，问题 low-confidence

## 断链

无。

## 缺少交叉引用

无。

## 低置信度文档

- `../nanoGPT-output/spectra-full/modules/configurator.spec.md`（configurator.py）
- `../nanoGPT-output/spectra-full/modules/sample.spec.md`（sample.py）
