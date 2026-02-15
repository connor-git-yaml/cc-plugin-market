# 契约: LICENSE 模板文件格式

**Branch**: `015-speckit-doc-command` | **Date**: 2026-02-15

## 概述

定义存储在 `plugins/spec-driver/templates/licenses/` 目录下的静态 LICENSE 模板文件的格式规范。

## 目录结构

```text
plugins/spec-driver/templates/licenses/
├── MIT.txt
├── Apache-2.0.txt
├── GPL-3.0.txt
├── BSD-2-Clause.txt
├── BSD-3-Clause.txt
├── ISC.txt
├── MPL-2.0.txt
└── Unlicense.txt
```

## 文件命名规范

- 文件名严格使用 SPDX 标准标识符（如 `Apache-2.0.txt`，不用 `apache2.txt`）
- 扩展名统一为 `.txt`
- 大小写与 SPDX 官方一致

## 占位符规范

| 占位符 | 含义 | 替换来源 | 降级值 |
|--------|------|---------|--------|
| `[year]` | 版权年份 | 当前年份（`new Date().getFullYear()`） | 当前年份 |
| `[fullname]` | 版权持有者 | package.json author.name > git config user.name | `[COPYRIGHT HOLDER]` |

**重要**: 不同协议使用不同的占位符位置:
- **MIT**: 开头 `Copyright (c) [year] [fullname]`
- **Apache-2.0**: 附录中的 `Copyright [year] [fullname]`
- **BSD-2-Clause/BSD-3-Clause**: 开头 `Copyright (c) [year] [fullname]`
- **ISC**: 开头 `Copyright (c) [year] [fullname]`
- **GPL-3.0**: 末尾附录建议 `Copyright (C) [year] [fullname]`
- **MPL-2.0**: 无年份/姓名占位符（协议本身不含版权声明行）
- **Unlicense**: 无占位符（公共领域声明，不含版权信息）

## 替换规则

```text
1. 读取模板文件内容
2. 将所有 [year] 替换为当前年份字符串
3. 将所有 [fullname] 替换为版权持有者名称
4. 如果版权持有者信息不可用:
   - MPL-2.0 和 Unlicense: 无需替换
   - 其余协议: 保留 [fullname] 占位符，在完成报告中提醒用户手动补充
5. 写入 LICENSE 文件（无扩展名）
```

## 内容校验

- 模板文件必须来源于 SPDX 官方（https://spdx.org/licenses/）或 choosealicense.com
- 除占位符字段外，文本内容不得有任何修改
- 模板文件的行尾统一为 LF（Unix 风格）
- 文件末尾保留一个空行
