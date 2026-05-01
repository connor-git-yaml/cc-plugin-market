---
type: troubleshooting
generatedAt: 2026-04-30T08:18:16.387Z
projectName: nanoGPT
totalEntries: 3
---

# 故障排查 / 原理说明: nanoGPT

## 总览

- Troubleshooting entries: `3`
- Explanation notes: `1`

## Warning

- 当前仅提取 3 条 grounded troubleshooting entries，低于蓝图建议的 5 条

## Troubleshooting Inventory

| Title | Kind | Confidence | Config Keys | Locations |
| --- | --- | --- | --- | --- |
| 配置约束: LOCAL_RANK | `config-constraint` | `medium` | `LOCAL_RANK` | 1 |
| 配置约束: RANK | `config-constraint` | `medium` | `RANK` | 1 |
| 配置约束: WORLD_SIZE | `config-constraint` | `medium` | `WORLD_SIZE` | 1 |

## 配置约束: LOCAL_RANK

- Kind: `config-constraint`
- Confidence: `medium`

**Symptom**

依赖 `LOCAL_RANK` 的功能在缺失或非法时会失败

**Possible causes**
- LOCAL_RANK 缺失、为空或未注入运行环境

**Recovery steps**
- 定位并检查 `train.py:86` (anonymous) 的约束实现
- 检查并设置 `LOCAL_RANK`

**Related locations**
- `train.py:86` (`anonymous`): `ddp_local_rank = int(os.environ['LOCAL_RANK'])`

**Config keys**
- `LOCAL_RANK`

**Evidence**
- `ddp_local_rank = int(os.environ['LOCAL_RANK'])`

## 配置约束: RANK

- Kind: `config-constraint`
- Confidence: `medium`

**Symptom**

依赖 `RANK` 的功能在缺失或非法时会失败

**Possible causes**
- RANK 缺失、为空或未注入运行环境

**Recovery steps**
- 定位并检查 `train.py:85` (anonymous) 的约束实现
- 检查并设置 `RANK`

**Related locations**
- `train.py:85` (`anonymous`): `ddp_rank = int(os.environ['RANK'])`

**Config keys**
- `RANK`

**Evidence**
- `ddp_rank = int(os.environ['RANK'])`

## 配置约束: WORLD_SIZE

- Kind: `config-constraint`
- Confidence: `medium`

**Symptom**

依赖 `WORLD_SIZE` 的功能在缺失或非法时会失败

**Possible causes**
- WORLD_SIZE 缺失、为空或未注入运行环境

**Recovery steps**
- 定位并检查 `train.py:87` (anonymous) 的约束实现
- 检查并设置 `WORLD_SIZE`

**Related locations**
- `train.py:87` (`anonymous`): `ddp_world_size = int(os.environ['WORLD_SIZE'])`

**Config keys**
- `WORLD_SIZE`

**Evidence**
- `ddp_world_size = int(os.environ['WORLD_SIZE'])`


## Explanation

### 配置校验策略

代码中存在显式配置约束，系统倾向在启动或关键路径早期 fail-fast，而不是静默忽略缺失配置。

Evidence:
- 配置约束: LOCAL_RANK -> ddp_local_rank = int(os.environ['LOCAL_RANK'])
- 配置约束: RANK -> ddp_rank = int(os.environ['RANK'])
- 配置约束: WORLD_SIZE -> ddp_world_size = int(os.environ['WORLD_SIZE'])

