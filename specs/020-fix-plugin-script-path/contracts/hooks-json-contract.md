# 契约: hooks.json 格式升级

**版本**: 2.0.0（从 1.0.0 升级）
**文件路径**: `plugins/spec-driver/hooks/hooks.json`

---

## 当前格式（v1 旧版）

```json
{
  "hooks": [
    {
      "event": "SessionStart",
      "commands": [
        {
          "type": "shell",
          "command": "./scripts/postinstall.sh"
        }
      ]
    }
  ]
}
```

**问题**:
- 使用相对路径 `./scripts/postinstall.sh`，cwd 不确定时不可靠
- 格式为旧版 hooks 数组 + event 字段，非当前推荐格式

---

## 修改后格式（v2 新版）

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh"
          }
        ]
      }
    ]
  }
}
```

**变更点**:
1. `hooks` 从数组改为对象，事件名（`SessionStart`）作为 key
2. 每个事件值为 matcher 数组
3. 命令从 `./scripts/postinstall.sh` 改为 `${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh`
4. `type` 从 `"shell"` 改为 `"command"`

---

## 兼容性

此变更遵循 reverse-spec 插件已采用的格式（见 `plugins/reverse-spec/hooks/hooks.json`），属于 Claude Code Plugin 系统的标准格式。
