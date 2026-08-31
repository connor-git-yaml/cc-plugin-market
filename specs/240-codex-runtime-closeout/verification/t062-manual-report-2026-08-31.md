# T062 Codex spec-driver hooks 信任状态迁移人工验证报告

验证日期：2026-08-31（Asia/Shanghai）

总体结论：**FAIL（伴随多项 UNEXPECTED）**。Codex 原生插件 hook 的发现、授信和真实执行可用；当前 doctor 不识别 F264 插件自带 hooks，且“修改 hook 脚本一个字节即 modified”的 spec 假设不成立。

| 分段 | 结果 | 摘要 |
|---|---|---|
| 0 | PASS | 恰好 5 条 plugin hook；变量展开；初始均 untrusted；双注册守卫生效。 |
| 1 | UNEXPECTED | 原生 untrusted→trusted 和无 bypass 真实事件成功；doctor 前后均 not-applicable。 |
| 2 | UNEXPECTED | hook 脚本改 1 字节后原生仍 trusted；doctor 仍 not-applicable。 |
| 3 | UNEXPECTED | hooks.json 命令改 1 字节可触发 modified，UI 按 t 可恢复 trusted；doctor remediation=null。 |

## 环境

### 版本、OAuth、HEAD、隔离路径

原始输出：

```text
codex-cli 0.151.0
-rw-------@ 1 connorlu  staff  3885 Aug 25 14:51 /Users/connorlu/.codex/auth.json
f7a65aa9 docs(M10): 批次 1 体检落账 + 账本 15 条全流转 + 派发模板四条硬约束 + 进展账
CODEX_HOME=/Users/connorlu/.t062-codex-home.9jgpsz
PROBE_PROJECT=/Users/connorlu/.t062-probe-project.lvGXFJ
drwx------@ 4 connorlu  staff  128 Aug 31 18:00 /Users/connorlu/.t062-codex-home.9jgpsz
drwx------@ 2 connorlu  staff   64 Aug 31 18:00 /Users/connorlu/.t062-probe-project.lvGXFJ
-rw-------@ 1 connorlu  staff  3885 Aug 31 18:00 /Users/connorlu/.t062-codex-home.9jgpsz/auth.json
```

结论：**PASS**。codex-cli 0.151.0 ≥ 0.149.0；~/.codex/auth.json 仅只读复制；HEAD f7a65aa9 满足下限。

## 分段 0：环境搭建与 F264 双注册守卫

### marketplace add

原始输出：

```json
{
  "marketplaceName": "cc-plugin-market",
  "installedRoot": "/Users/connorlu/.codex/worktrees/df87/cc-plugin-market",
  "alreadyAdded": false
}
```

### plugin add

原始输出：

```json
{
  "pluginId": "spec-driver@cc-plugin-market",
  "name": "spec-driver",
  "marketplaceName": "cc-plugin-market",
  "version": "4.4.3",
  "installedPath": "/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3",
  "authPolicy": "ON_INSTALL"
}
```

### 首次 hooks/list

原始输出：

```jsonl
{"id":1,"result":{"userAgent":"Codex Desktop/0.151.0 (Mac OS 26.6.2; arm64) dumb (t062-probe; 1.0.0)","codexHome":"/Users/connorlu/.t062-codex-home.9jgpsz","platformFamily":"unix","platformOs":"macos"}}
{"method":"remoteControl/status/changed","params":{"status":"disabled","serverName":"connorlus-MacBook-Pro.local","installationId":"46afe402-cd92-4a0b-b970-4e4442b6be99","environmentId":null},"emittedAtMs":1788170470879}
{"id":2,"result":{"data":[{"cwd":"/Users/connorlu/.t062-probe-project.lvGXFJ","hooks":[{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:pre_tool_use:0:0","eventName":"preToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":0,"enabled":true,"isManaged":false,"currentHash":"sha256:97d44115c67c8b393a2bd63fcf1b117fe3000083403938cf585baf4f8e007ea7","trustStatus":"untrusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:post_tool_use:0:0","eventName":"postToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/post-tool-use-format.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":1,"enabled":true,"isManaged":false,"currentHash":"sha256:6e79e79877af66ca4c45f5e2ac5472aba7bb859905e9b82cc98a99501fb0369b","trustStatus":"untrusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:session_start:0:0","eventName":"sessionStart","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/scripts/postinstall.sh","async":false,"matcher":"","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":2,"enabled":true,"isManaged":false,"currentHash":"sha256:2b029e5ad3dcea41f44353a6253b1cc45493ef67dadeec1b06c17a1aff77499d","trustStatus":"untrusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:0:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-task-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":3,"enabled":true,"isManaged":false,"currentHash":"sha256:f756a4d0d7bb57ecb46a7412224d81b5cc305be9a61be066cda1cabc5706e30b","trustStatus":"untrusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:1:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-fix-compliance-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":4,"enabled":true,"isManaged":false,"currentHash":"sha256:910c20141dee49f6bb646db606b97e3c1f060218fcffd5944795a4815ffa0473","trustStatus":"untrusted"}],"warnings":[],"errors":[]}]}}
```

观察：恰好 5 条：preToolUse 1、postToolUse 1、sessionStart 1、stop 2；均 source=plugin、pluginId=spec-driver@cc-plugin-market；命令根路径已展开；全部 trustStatus=untrusted。

### 全局合并器

原始输出：

```text
Spec Driver Codex skills 安装完成: /Users/connorlu/.t062-codex-home.9jgpsz/skills
[codex-hooks] 已检测到 Codex 原生插件注册（marketplace=cc-plugin-market），跳过合并写入以避免同一 hook 被注册两次；若确认当前 Codex 版本不读取插件内 hooks，可追加 --force-hooks 强制安装
[codex-hooks] 判定依据：/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json
[提示] hooks 已由 Codex 原生插件注册生效，无需再跑合并器；如确认当前 Codex 版本不读取插件内 hooks，可在命令后加 --force-hooks 强制安装
[提示] 只想清掉历史合并器写入的 hook 条目（保留已安装的 Codex skills）：node "/Users/connorlu/.codex/worktrees/df87/cc-plugin-market/plugins/spec-driver/scripts/install-codex-hooks.mjs" --codex-home "/Users/connorlu/.t062-codex-home.9jgpsz" --remove；codex-skills.sh remove --global 会连 skills 一起卸载
```

### 守卫后的状态

原始输出：

```text
HOOKS_JSON_PRESENT=no
SPEC_DRIVER_SKILL_COUNT=9
```

### 守卫后 hooks/list

原始输出：

```jsonl
{"id":1,"result":{"userAgent":"Codex Desktop/0.151.0 (Mac OS 26.6.2; arm64) dumb (t062-probe; 1.0.0)","codexHome":"/Users/connorlu/.t062-codex-home.9jgpsz","platformFamily":"unix","platformOs":"macos"}}
{"method":"remoteControl/status/changed","params":{"status":"disabled","serverName":"connorlus-MacBook-Pro.local","installationId":"46afe402-cd92-4a0b-b970-4e4442b6be99","environmentId":null},"emittedAtMs":1788170490249}
{"id":2,"result":{"data":[{"cwd":"/Users/connorlu/.t062-probe-project.lvGXFJ","hooks":[{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:pre_tool_use:0:0","eventName":"preToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":0,"enabled":true,"isManaged":false,"currentHash":"sha256:97d44115c67c8b393a2bd63fcf1b117fe3000083403938cf585baf4f8e007ea7","trustStatus":"untrusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:post_tool_use:0:0","eventName":"postToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/post-tool-use-format.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":1,"enabled":true,"isManaged":false,"currentHash":"sha256:6e79e79877af66ca4c45f5e2ac5472aba7bb859905e9b82cc98a99501fb0369b","trustStatus":"untrusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:session_start:0:0","eventName":"sessionStart","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/scripts/postinstall.sh","async":false,"matcher":"","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":2,"enabled":true,"isManaged":false,"currentHash":"sha256:2b029e5ad3dcea41f44353a6253b1cc45493ef67dadeec1b06c17a1aff77499d","trustStatus":"untrusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:0:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-task-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":3,"enabled":true,"isManaged":false,"currentHash":"sha256:f756a4d0d7bb57ecb46a7412224d81b5cc305be9a61be066cda1cabc5706e30b","trustStatus":"untrusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:1:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-fix-compliance-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":4,"enabled":true,"isManaged":false,"currentHash":"sha256:910c20141dee49f6bb646db606b97e3c1f060218fcffd5944795a4815ffa0473","trustStatus":"untrusted"}],"warnings":[],"errors":[]}]}}
```

结论：**PASS**。守卫明确跳过合并写入；$CODEX_HOME/hooks.json 不存在，原生 hook 未重复。

## 分段 1：untrusted → trusted

### 授信前 doctor

原始输出：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-31T10:01:26.125Z",
  "overallStatus": "warning",
  "checks": {
    "repo-version.spectra": {
      "id": "repo-version.spectra",
      "category": "repo-version",
      "product": "spectra",
      "status": "ok",
      "summary": "spectra 仓库声明版本为 4.5.0",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spectra.version",
        "semver": "4.5.0",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "repo-version.spec-driver": {
      "id": "repo-version.spec-driver",
      "category": "repo-version",
      "product": "spec-driver",
      "status": "ok",
      "summary": "spec-driver 仓库声明版本为 4.4.3",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spec-driver.version",
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "global-cli.spectra": {
      "id": "global-cli.spectra",
      "category": "global-cli",
      "product": "spectra",
      "status": "warning",
      "summary": "全局 spectra CLI 版本号与仓库一致（4.5.0），但 build commit 与本地 HEAD 不同（commitComparison=mismatch）",
      "details": {
        "binaryName": "spectra",
        "semver": "4.5.0",
        "hadVPrefix": true,
        "commitSuffixPresent": true,
        "rawShape": "decorated-semver",
        "commitComparison": "mismatch"
      },
      "remediation": {
        "code": "upgrade-global-cli",
        "command": "npm install -g spectra@latest",
        "text": "全局 CLI 与仓库声明版本不一致或不可用，升级全局安装后重跑本诊断。"
      }
    },
    "global-cli.spec-driver": {
      "id": "global-cli.spec-driver",
      "category": "global-cli",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有独立的全局 CLI，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "plugin-build.spectra": {
      "id": "plugin-build.spectra",
      "category": "plugin-build",
      "product": "spectra",
      "status": "indeterminate",
      "summary": "已走完全部 5 个排查点仍未找到 spectra 的 active plugin 标记（reason=codex-active-marker-unknown）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "commitComparison": "absent"
      },
      "remediation": {
        "code": "manual-investigate",
        "command": null,
        "text": "该维度不可自动判定，需人工排查后重跑本诊断。"
      }
    },
    "plugin-build.spec-driver": {
      "id": "plugin-build.spec-driver",
      "category": "plugin-build",
      "product": "spec-driver",
      "status": "ok",
      "summary": "active spec-driver plugin build 版本与仓库一致（4.4.3）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "commitComparison": "absent"
      },
      "remediation": null
    },
    "mcp-server.spectra": {
      "id": "mcp-server.spectra",
      "category": "mcp-server",
      "product": "spectra",
      "status": "warning",
      "summary": "PATH 上的 spectra 二进制所构建的 MCP server 与本地 HEAD 不是同一个 commit（commitComparison=mismatch），MCP 行为可能对不上当前代码",
      "details": {
        "probeMethod": "stdio-server-build-info",
        "probeTarget": "path-binary",
        "commitComparison": "mismatch",
        "semver": "4.5.0",
        "buildDirty": false
      },
      "remediation": {
        "code": "reload-mcp-client",
        "command": null,
        "text": "请在 MCP 客户端中重新加载该 server 后重跑本诊断。注意本诊断读的是 PATH 上的二进制，客户端已连接的旧进程需重连后本结论才适用。"
      }
    },
    "mcp-server.spec-driver": {
      "id": "mcp-server.spec-driver",
      "category": "mcp-server",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有对应的 MCP server，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "hook-trust": {
      "id": "hook-trust",
      "category": "hook-trust",
      "product": null,
      "status": "not-applicable",
      "summary": "Codex 家目录下不存在 hooks.json，hook 信任状态不适用",
      "details": {
        "attemptedProbes": [
          {
            "id": "codex-home-hooks-json",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "config-toml-readable",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "config-toml-hooks-state",
            "outcome": "absent",
            "errorClass": null
          }
        ],
        "trustStatus": "not-applicable",
        "hooksJsonPath": "hooks.json"
      },
      "remediation": null
    }
  }
}
```

原生 RPC 已证明 untrusted，但 doctor 返回 hook-trust.status=not-applicable、trustStatus=not-applicable、remediation=null：**UNEXPECTED**。

### UI 原文与证据限制

启动命令：

~~~bash
CODEX_HOME=/Users/connorlu/.t062-codex-home.9jgpsz codex -C /Users/connorlu/.t062-probe-project.lvGXFJ
~~~

首次 /hooks 汇总可见：

~~~text
Hooks
Lifecycle hooks from config and enabled plugins.
PreToolUse  Installed 1  Active 1
PostToolUse Installed 1  Active 1
SessionStart Installed 1 Active 1
Stop Installed 2 Active 2
Press enter to view hooks; esc to close
~~~

Stop 详情可见：

~~~text
Stop hooks
Turn hooks on or off. Your changes are saved automatically.
[x] Hook 1
[x] Hook 2
Source Plugin - spec-driver@cc-plugin-market
Trust Trusted
Press space or enter to toggle; esc to go back
~~~

用户没有逐字回述首次授信发生前的完整按键。本报告不推断具体哪个动作导致首次信任写入，只记录 RPC 的 untrusted→trusted。

### UI 后 hooks/list

原始输出：

```jsonl
{"id":1,"result":{"userAgent":"Codex Desktop/0.151.0 (Mac OS 26.6.2; arm64) dumb (t062-probe; 1.0.0)","codexHome":"/Users/connorlu/.t062-codex-home.9jgpsz","platformFamily":"unix","platformOs":"macos"}}
{"method":"remoteControl/status/changed","params":{"status":"disabled","serverName":"connorlus-MacBook-Pro.local","installationId":"46afe402-cd92-4a0b-b970-4e4442b6be99","environmentId":null},"emittedAtMs":1788170878681}
{"id":2,"result":{"data":[{"cwd":"/Users/connorlu/.t062-probe-project.lvGXFJ","hooks":[{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:pre_tool_use:0:0","eventName":"preToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":0,"enabled":true,"isManaged":false,"currentHash":"sha256:97d44115c67c8b393a2bd63fcf1b117fe3000083403938cf585baf4f8e007ea7","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:post_tool_use:0:0","eventName":"postToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/post-tool-use-format.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":1,"enabled":true,"isManaged":false,"currentHash":"sha256:6e79e79877af66ca4c45f5e2ac5472aba7bb859905e9b82cc98a99501fb0369b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:session_start:0:0","eventName":"sessionStart","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/scripts/postinstall.sh","async":false,"matcher":"","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":2,"enabled":true,"isManaged":false,"currentHash":"sha256:2b029e5ad3dcea41f44353a6253b1cc45493ef67dadeec1b06c17a1aff77499d","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:0:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-task-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":3,"enabled":true,"isManaged":false,"currentHash":"sha256:f756a4d0d7bb57ecb46a7412224d81b5cc305be9a61be066cda1cabc5706e30b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:1:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-fix-compliance-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":4,"enabled":true,"isManaged":false,"currentHash":"sha256:910c20141dee49f6bb646db606b97e3c1f060218fcffd5944795a4815ffa0473","trustStatus":"trusted"}],"warnings":[],"errors":[]}]}}
```

### UI 后 doctor

原始输出：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-31T10:11:07.965Z",
  "overallStatus": "warning",
  "checks": {
    "repo-version.spectra": {
      "id": "repo-version.spectra",
      "category": "repo-version",
      "product": "spectra",
      "status": "ok",
      "summary": "spectra 仓库声明版本为 4.5.0",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spectra.version",
        "semver": "4.5.0",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "repo-version.spec-driver": {
      "id": "repo-version.spec-driver",
      "category": "repo-version",
      "product": "spec-driver",
      "status": "ok",
      "summary": "spec-driver 仓库声明版本为 4.4.3",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spec-driver.version",
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "global-cli.spectra": {
      "id": "global-cli.spectra",
      "category": "global-cli",
      "product": "spectra",
      "status": "warning",
      "summary": "全局 spectra CLI 版本号与仓库一致（4.5.0），但 build commit 与本地 HEAD 不同（commitComparison=mismatch）",
      "details": {
        "binaryName": "spectra",
        "semver": "4.5.0",
        "hadVPrefix": true,
        "commitSuffixPresent": true,
        "rawShape": "decorated-semver",
        "commitComparison": "mismatch"
      },
      "remediation": {
        "code": "upgrade-global-cli",
        "command": "npm install -g spectra@latest",
        "text": "全局 CLI 与仓库声明版本不一致或不可用，升级全局安装后重跑本诊断。"
      }
    },
    "global-cli.spec-driver": {
      "id": "global-cli.spec-driver",
      "category": "global-cli",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有独立的全局 CLI，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "plugin-build.spectra": {
      "id": "plugin-build.spectra",
      "category": "plugin-build",
      "product": "spectra",
      "status": "indeterminate",
      "summary": "已走完全部 5 个排查点仍未找到 spectra 的 active plugin 标记（reason=codex-active-marker-unknown）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "commitComparison": "absent"
      },
      "remediation": {
        "code": "manual-investigate",
        "command": null,
        "text": "该维度不可自动判定，需人工排查后重跑本诊断。"
      }
    },
    "plugin-build.spec-driver": {
      "id": "plugin-build.spec-driver",
      "category": "plugin-build",
      "product": "spec-driver",
      "status": "ok",
      "summary": "active spec-driver plugin build 版本与仓库一致（4.4.3）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "commitComparison": "absent"
      },
      "remediation": null
    },
    "mcp-server.spectra": {
      "id": "mcp-server.spectra",
      "category": "mcp-server",
      "product": "spectra",
      "status": "warning",
      "summary": "PATH 上的 spectra 二进制所构建的 MCP server 与本地 HEAD 不是同一个 commit（commitComparison=mismatch），MCP 行为可能对不上当前代码",
      "details": {
        "probeMethod": "stdio-server-build-info",
        "probeTarget": "path-binary",
        "commitComparison": "mismatch",
        "semver": "4.5.0",
        "buildDirty": false
      },
      "remediation": {
        "code": "reload-mcp-client",
        "command": null,
        "text": "请在 MCP 客户端中重新加载该 server 后重跑本诊断。注意本诊断读的是 PATH 上的二进制，客户端已连接的旧进程需重连后本结论才适用。"
      }
    },
    "mcp-server.spec-driver": {
      "id": "mcp-server.spec-driver",
      "category": "mcp-server",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有对应的 MCP server，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "hook-trust": {
      "id": "hook-trust",
      "category": "hook-trust",
      "product": null,
      "status": "not-applicable",
      "summary": "Codex 家目录下不存在 hooks.json，hook 信任状态不适用",
      "details": {
        "attemptedProbes": [
          {
            "id": "codex-home-hooks-json",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "config-toml-readable",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "config-toml-hooks-state",
            "outcome": "found",
            "errorClass": null
          }
        ],
        "trustStatus": "not-applicable",
        "hooksJsonPath": "hooks.json"
      },
      "remediation": null
    }
  }
}
```

### 真实事件首次尝试

原始输出：

```jsonl
Reading additional input from stdin...
Not inside a trusted directory and --skip-git-repo-check was not specified.
```

### 探针 git init

原始输出：

```text
Initialized empty Git repository in /Users/connorlu/.t062-probe-project.lvGXFJ/.git/
```

### 真实事件重试（无 bypass）

原始输出：

```jsonl
Reading additional input from stdin...
{"type":"thread.started","thread_id":"01a0574d-9459-7762-9d23-90e5f6246949"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"T062_EVENT_OK"}}
{"type":"turn.completed","usage":{"input_tokens":18274,"cached_input_tokens":11008,"cache_write_input_tokens":0,"output_tokens":8,"reasoning_output_tokens":0}}
```

### SessionStart 落盘证据

原始输出：

```text
### PROBE ARTIFACT
-rw-r--r--@ 1 connorlu  staff  88 Aug 31 18:11:40 2026 /Users/connorlu/.t062-probe-project.lvGXFJ/.specify/.spec-driver-path
CONTENT=/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3
EXPECTED=/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3
CONTENT_MATCH=yes
### GIT EXCLUDE
# git ls-files --others --exclude-from=.git/info/exclude
# Lines that start with '#' are comments.
# For a project mostly in C, the following would be a good set of
# exclude patterns (uncomment them if you want to use them):
# *.[oa]
# *~
.specify/.spec-driver-path
.specify/runs/
.specify/scorecards/
.specify/templates/
.specify/graph-consumption-audit.jsonl
.specify/kb-nohit/
### GIT STATUS
```

结论：原生迁移与真实 hook 执行 **PASS**；doctor 合同 **FAIL/UNEXPECTED**；分段总体 **UNEXPECTED**。

## 分段 2：修改 hook 脚本 1 字节

### 单字节变更证明

原始输出：

```text
TARGET=/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh
BACKUP=/Users/connorlu/.t062-codex-home.9jgpsz/evidence/segment2-pre-tool-use-guard.sh.backup
### BEFORE
3f5e7a3a3434712b1d21b457f9e5e465ded779e9b0f83c0ee1ab34549714a3ba  /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh
2:# PreToolUse Hook: 当前 feature 分支存在未完成 spec-driver 任务时，对 src/ 的直接编辑发出警示
### AFTER
6d8c84967862f1381957736a5586f7fe58b80ada15327e47a882bb23dd04213c  /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh
2:# PreToolUse Hook. 当前 feature 分支存在未完成 spec-driver 任务时，对 src/ 的直接编辑发出警示
### CMP -l
    38  72  56
DIFF_BYTE_COUNT=1

```

### 脚本变更后 hooks/list

原始输出：

```jsonl
{"id":1,"result":{"userAgent":"Codex Desktop/0.151.0 (Mac OS 26.6.2; arm64) dumb (t062-probe; 1.0.0)","codexHome":"/Users/connorlu/.t062-codex-home.9jgpsz","platformFamily":"unix","platformOs":"macos"}}
{"method":"remoteControl/status/changed","params":{"status":"disabled","serverName":"connorlus-MacBook-Pro.local","installationId":"46afe402-cd92-4a0b-b970-4e4442b6be99","environmentId":null},"emittedAtMs":1788171140196}
{"id":2,"result":{"data":[{"cwd":"/Users/connorlu/.t062-probe-project.lvGXFJ","hooks":[{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:pre_tool_use:0:0","eventName":"preToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":0,"enabled":true,"isManaged":false,"currentHash":"sha256:97d44115c67c8b393a2bd63fcf1b117fe3000083403938cf585baf4f8e007ea7","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:post_tool_use:0:0","eventName":"postToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/post-tool-use-format.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":1,"enabled":true,"isManaged":false,"currentHash":"sha256:6e79e79877af66ca4c45f5e2ac5472aba7bb859905e9b82cc98a99501fb0369b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:session_start:0:0","eventName":"sessionStart","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/scripts/postinstall.sh","async":false,"matcher":"","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":2,"enabled":true,"isManaged":false,"currentHash":"sha256:2b029e5ad3dcea41f44353a6253b1cc45493ef67dadeec1b06c17a1aff77499d","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:0:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-task-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":3,"enabled":true,"isManaged":false,"currentHash":"sha256:f756a4d0d7bb57ecb46a7412224d81b5cc305be9a61be066cda1cabc5706e30b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:1:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-fix-compliance-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":4,"enabled":true,"isManaged":false,"currentHash":"sha256:910c20141dee49f6bb646db606b97e3c1f060218fcffd5944795a4815ffa0473","trustStatus":"trusted"}],"warnings":[],"errors":[]}]}}
```

### 脚本变更后 doctor

原始输出：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-31T10:12:28.446Z",
  "overallStatus": "warning",
  "checks": {
    "repo-version.spectra": {
      "id": "repo-version.spectra",
      "category": "repo-version",
      "product": "spectra",
      "status": "ok",
      "summary": "spectra 仓库声明版本为 4.5.0",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spectra.version",
        "semver": "4.5.0",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "repo-version.spec-driver": {
      "id": "repo-version.spec-driver",
      "category": "repo-version",
      "product": "spec-driver",
      "status": "ok",
      "summary": "spec-driver 仓库声明版本为 4.4.3",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spec-driver.version",
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "global-cli.spectra": {
      "id": "global-cli.spectra",
      "category": "global-cli",
      "product": "spectra",
      "status": "warning",
      "summary": "全局 spectra CLI 版本号与仓库一致（4.5.0），但 build commit 与本地 HEAD 不同（commitComparison=mismatch）",
      "details": {
        "binaryName": "spectra",
        "semver": "4.5.0",
        "hadVPrefix": true,
        "commitSuffixPresent": true,
        "rawShape": "decorated-semver",
        "commitComparison": "mismatch"
      },
      "remediation": {
        "code": "upgrade-global-cli",
        "command": "npm install -g spectra@latest",
        "text": "全局 CLI 与仓库声明版本不一致或不可用，升级全局安装后重跑本诊断。"
      }
    },
    "global-cli.spec-driver": {
      "id": "global-cli.spec-driver",
      "category": "global-cli",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有独立的全局 CLI，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "plugin-build.spectra": {
      "id": "plugin-build.spectra",
      "category": "plugin-build",
      "product": "spectra",
      "status": "indeterminate",
      "summary": "已走完全部 5 个排查点仍未找到 spectra 的 active plugin 标记（reason=codex-active-marker-unknown）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "commitComparison": "absent"
      },
      "remediation": {
        "code": "manual-investigate",
        "command": null,
        "text": "该维度不可自动判定，需人工排查后重跑本诊断。"
      }
    },
    "plugin-build.spec-driver": {
      "id": "plugin-build.spec-driver",
      "category": "plugin-build",
      "product": "spec-driver",
      "status": "ok",
      "summary": "active spec-driver plugin build 版本与仓库一致（4.4.3）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "commitComparison": "absent"
      },
      "remediation": null
    },
    "mcp-server.spectra": {
      "id": "mcp-server.spectra",
      "category": "mcp-server",
      "product": "spectra",
      "status": "warning",
      "summary": "PATH 上的 spectra 二进制所构建的 MCP server 与本地 HEAD 不是同一个 commit（commitComparison=mismatch），MCP 行为可能对不上当前代码",
      "details": {
        "probeMethod": "stdio-server-build-info",
        "probeTarget": "path-binary",
        "commitComparison": "mismatch",
        "semver": "4.5.0",
        "buildDirty": false
      },
      "remediation": {
        "code": "reload-mcp-client",
        "command": null,
        "text": "请在 MCP 客户端中重新加载该 server 后重跑本诊断。注意本诊断读的是 PATH 上的二进制，客户端已连接的旧进程需重连后本结论才适用。"
      }
    },
    "mcp-server.spec-driver": {
      "id": "mcp-server.spec-driver",
      "category": "mcp-server",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有对应的 MCP server，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "hook-trust": {
      "id": "hook-trust",
      "category": "hook-trust",
      "product": null,
      "status": "not-applicable",
      "summary": "Codex 家目录下不存在 hooks.json，hook 信任状态不适用",
      "details": {
        "attemptedProbes": [
          {
            "id": "codex-home-hooks-json",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "config-toml-readable",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "config-toml-hooks-state",
            "outcome": "found",
            "errorClass": null
          }
        ],
        "trustStatus": "not-applicable",
        "hooksJsonPath": "hooks.json"
      },
      "remediation": null
    }
  }
}
```

### 脚本还原

原始输出：

```text
### RESTORED
3f5e7a3a3434712b1d21b457f9e5e465ded779e9b0f83c0ee1ab34549714a3ba  /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh
RESTORE_MATCH=yes
2:# PreToolUse Hook: 当前 feature 分支存在未完成 spec-driver 任务时，对 src/ 的直接编辑发出警示
```

### 还原后 hooks/list

原始输出：

```jsonl
{"id":1,"result":{"userAgent":"Codex Desktop/0.151.0 (Mac OS 26.6.2; arm64) dumb (t062-probe; 1.0.0)","codexHome":"/Users/connorlu/.t062-codex-home.9jgpsz","platformFamily":"unix","platformOs":"macos"}}
{"method":"remoteControl/status/changed","params":{"status":"disabled","serverName":"connorlus-MacBook-Pro.local","installationId":"46afe402-cd92-4a0b-b970-4e4442b6be99","environmentId":null},"emittedAtMs":1788171164312}
{"id":2,"result":{"data":[{"cwd":"/Users/connorlu/.t062-probe-project.lvGXFJ","hooks":[{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:pre_tool_use:0:0","eventName":"preToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":0,"enabled":true,"isManaged":false,"currentHash":"sha256:97d44115c67c8b393a2bd63fcf1b117fe3000083403938cf585baf4f8e007ea7","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:post_tool_use:0:0","eventName":"postToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/post-tool-use-format.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":1,"enabled":true,"isManaged":false,"currentHash":"sha256:6e79e79877af66ca4c45f5e2ac5472aba7bb859905e9b82cc98a99501fb0369b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:session_start:0:0","eventName":"sessionStart","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/scripts/postinstall.sh","async":false,"matcher":"","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":2,"enabled":true,"isManaged":false,"currentHash":"sha256:2b029e5ad3dcea41f44353a6253b1cc45493ef67dadeec1b06c17a1aff77499d","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:0:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-task-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":3,"enabled":true,"isManaged":false,"currentHash":"sha256:f756a4d0d7bb57ecb46a7412224d81b5cc305be9a61be066cda1cabc5706e30b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:1:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-fix-compliance-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":4,"enabled":true,"isManaged":false,"currentHash":"sha256:910c20141dee49f6bb646db606b97e3c1f060218fcffd5944795a4815ffa0473","trustStatus":"trusted"}],"warnings":[],"errors":[]}]}}
```

### 还原后 doctor

原始输出：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-31T10:12:51.213Z",
  "overallStatus": "warning",
  "checks": {
    "repo-version.spectra": {
      "id": "repo-version.spectra",
      "category": "repo-version",
      "product": "spectra",
      "status": "ok",
      "summary": "spectra 仓库声明版本为 4.5.0",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spectra.version",
        "semver": "4.5.0",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "repo-version.spec-driver": {
      "id": "repo-version.spec-driver",
      "category": "repo-version",
      "product": "spec-driver",
      "status": "ok",
      "summary": "spec-driver 仓库声明版本为 4.4.3",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spec-driver.version",
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "global-cli.spectra": {
      "id": "global-cli.spectra",
      "category": "global-cli",
      "product": "spectra",
      "status": "warning",
      "summary": "全局 spectra CLI 版本号与仓库一致（4.5.0），但 build commit 与本地 HEAD 不同（commitComparison=mismatch）",
      "details": {
        "binaryName": "spectra",
        "semver": "4.5.0",
        "hadVPrefix": true,
        "commitSuffixPresent": true,
        "rawShape": "decorated-semver",
        "commitComparison": "mismatch"
      },
      "remediation": {
        "code": "upgrade-global-cli",
        "command": "npm install -g spectra@latest",
        "text": "全局 CLI 与仓库声明版本不一致或不可用，升级全局安装后重跑本诊断。"
      }
    },
    "global-cli.spec-driver": {
      "id": "global-cli.spec-driver",
      "category": "global-cli",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有独立的全局 CLI，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "plugin-build.spectra": {
      "id": "plugin-build.spectra",
      "category": "plugin-build",
      "product": "spectra",
      "status": "indeterminate",
      "summary": "已走完全部 5 个排查点仍未找到 spectra 的 active plugin 标记（reason=codex-active-marker-unknown）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "commitComparison": "absent"
      },
      "remediation": {
        "code": "manual-investigate",
        "command": null,
        "text": "该维度不可自动判定，需人工排查后重跑本诊断。"
      }
    },
    "plugin-build.spec-driver": {
      "id": "plugin-build.spec-driver",
      "category": "plugin-build",
      "product": "spec-driver",
      "status": "ok",
      "summary": "active spec-driver plugin build 版本与仓库一致（4.4.3）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "commitComparison": "absent"
      },
      "remediation": null
    },
    "mcp-server.spectra": {
      "id": "mcp-server.spectra",
      "category": "mcp-server",
      "product": "spectra",
      "status": "warning",
      "summary": "PATH 上的 spectra 二进制所构建的 MCP server 与本地 HEAD 不是同一个 commit（commitComparison=mismatch），MCP 行为可能对不上当前代码",
      "details": {
        "probeMethod": "stdio-server-build-info",
        "probeTarget": "path-binary",
        "commitComparison": "mismatch",
        "semver": "4.5.0",
        "buildDirty": false
      },
      "remediation": {
        "code": "reload-mcp-client",
        "command": null,
        "text": "请在 MCP 客户端中重新加载该 server 后重跑本诊断。注意本诊断读的是 PATH 上的二进制，客户端已连接的旧进程需重连后本结论才适用。"
      }
    },
    "mcp-server.spec-driver": {
      "id": "mcp-server.spec-driver",
      "category": "mcp-server",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有对应的 MCP server，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "hook-trust": {
      "id": "hook-trust",
      "category": "hook-trust",
      "product": null,
      "status": "not-applicable",
      "summary": "Codex 家目录下不存在 hooks.json，hook 信任状态不适用",
      "details": {
        "attemptedProbes": [
          {
            "id": "codex-home-hooks-json",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "config-toml-readable",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "config-toml-hooks-state",
            "outcome": "found",
            "errorClass": null
          }
        ],
        "trustStatus": "not-applicable",
        "hooksJsonPath": "hooks.json"
      },
      "remediation": null
    }
  }
}
```

观察：只把注释中的 0x3a 改为 0x2e，cmp 仅 1 字节差异；原生 currentHash 未变、状态仍 trusted。说明 Codex 0.151.0 信任哈希不覆盖被调用脚本内容。doctor 仍 not-applicable。结论：**UNEXPECTED**，SC-013 第 2 段未达成。

## 分段 3：remediation

脚本变更无法制造 modified 后，在隔离 hooks.json 的命令中插入一个无语义空格（bash␠→bash␠␠）制造真实原生 modified。

### hooks.json 单字节证明

原始输出：

```text
BEFORE_BYTES=1630
AFTER_BYTES=1631
BYTE_LENGTH_DELTA=1
INSERT_OFFSET_ZERO_BASED=394
INSERTED_BYTE_DECIMAL=32
INSERTED_BYTE_HEX=0x20
REMOVE_INSERTED_BYTE_RESTORES_ORIGINAL=yes
```

### 制造 modified 后 hooks/list

原始输出：

```jsonl
{"id":1,"result":{"userAgent":"Codex Desktop/0.151.0 (Mac OS 26.6.2; arm64) dumb (t062-probe; 1.0.0)","codexHome":"/Users/connorlu/.t062-codex-home.9jgpsz","platformFamily":"unix","platformOs":"macos"}}
{"method":"remoteControl/status/changed","params":{"status":"disabled","serverName":"connorlus-MacBook-Pro.local","installationId":"46afe402-cd92-4a0b-b970-4e4442b6be99","environmentId":null},"emittedAtMs":1788171183014}
{"id":2,"result":{"data":[{"cwd":"/Users/connorlu/.t062-probe-project.lvGXFJ","hooks":[{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:pre_tool_use:0:0","eventName":"preToolUse","handlerType":"command","command":"bash  /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":0,"enabled":true,"isManaged":false,"currentHash":"sha256:37bda85867e57ecc6d7a3953966591812897247504079a33661317f18cff3067","trustStatus":"modified"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:post_tool_use:0:0","eventName":"postToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/post-tool-use-format.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":1,"enabled":true,"isManaged":false,"currentHash":"sha256:6e79e79877af66ca4c45f5e2ac5472aba7bb859905e9b82cc98a99501fb0369b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:session_start:0:0","eventName":"sessionStart","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/scripts/postinstall.sh","async":false,"matcher":"","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":2,"enabled":true,"isManaged":false,"currentHash":"sha256:2b029e5ad3dcea41f44353a6253b1cc45493ef67dadeec1b06c17a1aff77499d","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:0:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-task-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":3,"enabled":true,"isManaged":false,"currentHash":"sha256:f756a4d0d7bb57ecb46a7412224d81b5cc305be9a61be066cda1cabc5706e30b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:1:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-fix-compliance-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":4,"enabled":true,"isManaged":false,"currentHash":"sha256:910c20141dee49f6bb646db606b97e3c1f060218fcffd5944795a4815ffa0473","trustStatus":"trusted"}],"warnings":[],"errors":[]}]}}
```

### 制造 modified 后 doctor

原始输出：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-31T10:13:12.857Z",
  "overallStatus": "warning",
  "checks": {
    "repo-version.spectra": {
      "id": "repo-version.spectra",
      "category": "repo-version",
      "product": "spectra",
      "status": "ok",
      "summary": "spectra 仓库声明版本为 4.5.0",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spectra.version",
        "semver": "4.5.0",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "repo-version.spec-driver": {
      "id": "repo-version.spec-driver",
      "category": "repo-version",
      "product": "spec-driver",
      "status": "ok",
      "summary": "spec-driver 仓库声明版本为 4.4.3",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spec-driver.version",
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "global-cli.spectra": {
      "id": "global-cli.spectra",
      "category": "global-cli",
      "product": "spectra",
      "status": "warning",
      "summary": "全局 spectra CLI 版本号与仓库一致（4.5.0），但 build commit 与本地 HEAD 不同（commitComparison=mismatch）",
      "details": {
        "binaryName": "spectra",
        "semver": "4.5.0",
        "hadVPrefix": true,
        "commitSuffixPresent": true,
        "rawShape": "decorated-semver",
        "commitComparison": "mismatch"
      },
      "remediation": {
        "code": "upgrade-global-cli",
        "command": "npm install -g spectra@latest",
        "text": "全局 CLI 与仓库声明版本不一致或不可用，升级全局安装后重跑本诊断。"
      }
    },
    "global-cli.spec-driver": {
      "id": "global-cli.spec-driver",
      "category": "global-cli",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有独立的全局 CLI，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "plugin-build.spectra": {
      "id": "plugin-build.spectra",
      "category": "plugin-build",
      "product": "spectra",
      "status": "indeterminate",
      "summary": "已走完全部 5 个排查点仍未找到 spectra 的 active plugin 标记（reason=codex-active-marker-unknown）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "commitComparison": "absent"
      },
      "remediation": {
        "code": "manual-investigate",
        "command": null,
        "text": "该维度不可自动判定，需人工排查后重跑本诊断。"
      }
    },
    "plugin-build.spec-driver": {
      "id": "plugin-build.spec-driver",
      "category": "plugin-build",
      "product": "spec-driver",
      "status": "ok",
      "summary": "active spec-driver plugin build 版本与仓库一致（4.4.3）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "commitComparison": "absent"
      },
      "remediation": null
    },
    "mcp-server.spectra": {
      "id": "mcp-server.spectra",
      "category": "mcp-server",
      "product": "spectra",
      "status": "warning",
      "summary": "PATH 上的 spectra 二进制所构建的 MCP server 与本地 HEAD 不是同一个 commit（commitComparison=mismatch），MCP 行为可能对不上当前代码",
      "details": {
        "probeMethod": "stdio-server-build-info",
        "probeTarget": "path-binary",
        "commitComparison": "mismatch",
        "semver": "4.5.0",
        "buildDirty": false
      },
      "remediation": {
        "code": "reload-mcp-client",
        "command": null,
        "text": "请在 MCP 客户端中重新加载该 server 后重跑本诊断。注意本诊断读的是 PATH 上的二进制，客户端已连接的旧进程需重连后本结论才适用。"
      }
    },
    "mcp-server.spec-driver": {
      "id": "mcp-server.spec-driver",
      "category": "mcp-server",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有对应的 MCP server，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "hook-trust": {
      "id": "hook-trust",
      "category": "hook-trust",
      "product": null,
      "status": "not-applicable",
      "summary": "Codex 家目录下不存在 hooks.json，hook 信任状态不适用",
      "details": {
        "attemptedProbes": [
          {
            "id": "codex-home-hooks-json",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "config-toml-readable",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "config-toml-hooks-state",
            "outcome": "found",
            "errorClass": null
          }
        ],
        "trustStatus": "not-applicable",
        "hooksJsonPath": "hooks.json"
      },
      "remediation": null
    }
  }
}
```

原生 preToolUse=modified；doctor 仍 not-applicable 且 remediation=null：**UNEXPECTED**。

### UI 实测步骤（逐字）

1. 在隔离 CODEX_HOME 启动 Codex。
2. 输入 /hooks。
3. 选择 PreToolUse，按 Enter。
4. 界面显示：

~~~text
PreToolUse hooks
1 hook needs review before it can run.

[!] Hook 1 · modified
Event    PreToolUse
Matcher  Edit|Write
Source   Plugin - spec-driver@cc-plugin-market
Mode     Sync
Timeout  600s
Trust    Modified since last trusted - review required

Press t to trust; esc to go back
~~~

5. 按小写 t。
6. 无二次确认，立即显示：

~~~text
PreToolUse hooks
Turn hooks on or off. Your changes are saved automatically.

[x] Hook 1
Event    PreToolUse
Matcher  Edit|Write
Source   Plugin - spec-driver@cc-plugin-market
Mode     Sync
Timeout  600s
Trust    Trusted

Press space or enter to toggle; esc to go back
~~~

### 按 t 后 hooks/list

原始输出：

```jsonl
{"id":1,"result":{"userAgent":"Codex Desktop/0.151.0 (Mac OS 26.6.2; arm64) dumb (t062-probe; 1.0.0)","codexHome":"/Users/connorlu/.t062-codex-home.9jgpsz","platformFamily":"unix","platformOs":"macos"}}
{"method":"remoteControl/status/changed","params":{"status":"disabled","serverName":"connorlus-MacBook-Pro.local","installationId":"46afe402-cd92-4a0b-b970-4e4442b6be99","environmentId":null},"emittedAtMs":1788171850151}
{"id":2,"result":{"data":[{"cwd":"/Users/connorlu/.t062-probe-project.lvGXFJ","hooks":[{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:pre_tool_use:0:0","eventName":"preToolUse","handlerType":"command","command":"bash  /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":0,"enabled":true,"isManaged":false,"currentHash":"sha256:37bda85867e57ecc6d7a3953966591812897247504079a33661317f18cff3067","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:post_tool_use:0:0","eventName":"postToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/post-tool-use-format.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":1,"enabled":true,"isManaged":false,"currentHash":"sha256:6e79e79877af66ca4c45f5e2ac5472aba7bb859905e9b82cc98a99501fb0369b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:session_start:0:0","eventName":"sessionStart","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/scripts/postinstall.sh","async":false,"matcher":"","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":2,"enabled":true,"isManaged":false,"currentHash":"sha256:2b029e5ad3dcea41f44353a6253b1cc45493ef67dadeec1b06c17a1aff77499d","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:0:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-task-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":3,"enabled":true,"isManaged":false,"currentHash":"sha256:f756a4d0d7bb57ecb46a7412224d81b5cc305be9a61be066cda1cabc5706e30b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:1:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-fix-compliance-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":4,"enabled":true,"isManaged":false,"currentHash":"sha256:910c20141dee49f6bb646db606b97e3c1f060218fcffd5944795a4815ffa0473","trustStatus":"trusted"}],"warnings":[],"errors":[]}]}}
```

### 按 t 后 doctor

原始输出：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-31T10:24:14.855Z",
  "overallStatus": "warning",
  "checks": {
    "repo-version.spectra": {
      "id": "repo-version.spectra",
      "category": "repo-version",
      "product": "spectra",
      "status": "ok",
      "summary": "spectra 仓库声明版本为 4.5.0",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spectra.version",
        "semver": "4.5.0",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "repo-version.spec-driver": {
      "id": "repo-version.spec-driver",
      "category": "repo-version",
      "product": "spec-driver",
      "status": "ok",
      "summary": "spec-driver 仓库声明版本为 4.4.3",
      "details": {
        "contractPath": "contracts/release-contract.yaml",
        "versionField": "products.spec-driver.version",
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "baselineCommit": "available"
      },
      "remediation": null
    },
    "global-cli.spectra": {
      "id": "global-cli.spectra",
      "category": "global-cli",
      "product": "spectra",
      "status": "warning",
      "summary": "全局 spectra CLI 版本号与仓库一致（4.5.0），但 build commit 与本地 HEAD 不同（commitComparison=mismatch）",
      "details": {
        "binaryName": "spectra",
        "semver": "4.5.0",
        "hadVPrefix": true,
        "commitSuffixPresent": true,
        "rawShape": "decorated-semver",
        "commitComparison": "mismatch"
      },
      "remediation": {
        "code": "upgrade-global-cli",
        "command": "npm install -g spectra@latest",
        "text": "全局 CLI 与仓库声明版本不一致或不可用，升级全局安装后重跑本诊断。"
      }
    },
    "global-cli.spec-driver": {
      "id": "global-cli.spec-driver",
      "category": "global-cli",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有独立的全局 CLI，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "plugin-build.spectra": {
      "id": "plugin-build.spectra",
      "category": "plugin-build",
      "product": "spectra",
      "status": "indeterminate",
      "summary": "已走完全部 5 个排查点仍未找到 spectra 的 active plugin 标记（reason=codex-active-marker-unknown）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "commitComparison": "absent"
      },
      "remediation": {
        "code": "manual-investigate",
        "command": null,
        "text": "该维度不可自动判定，需人工排查后重跑本诊断。"
      }
    },
    "plugin-build.spec-driver": {
      "id": "plugin-build.spec-driver",
      "category": "plugin-build",
      "product": "spec-driver",
      "status": "ok",
      "summary": "active spec-driver plugin build 版本与仓库一致（4.4.3）",
      "details": {
        "probedSources": [
          {
            "id": "codex-plugin-manifest",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-cli-help",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "codex-doctor-checks",
            "outcome": "error",
            "errorClass": "non-zero-exit"
          },
          {
            "id": "codex-home-paths",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "app-server-rpc",
            "outcome": "not-probed",
            "errorClass": null
          }
        ],
        "semver": "4.4.3",
        "rawShape": "bare-semver",
        "commitComparison": "absent"
      },
      "remediation": null
    },
    "mcp-server.spectra": {
      "id": "mcp-server.spectra",
      "category": "mcp-server",
      "product": "spectra",
      "status": "warning",
      "summary": "PATH 上的 spectra 二进制所构建的 MCP server 与本地 HEAD 不是同一个 commit（commitComparison=mismatch），MCP 行为可能对不上当前代码",
      "details": {
        "probeMethod": "stdio-server-build-info",
        "probeTarget": "path-binary",
        "commitComparison": "mismatch",
        "semver": "4.5.0",
        "buildDirty": false
      },
      "remediation": {
        "code": "reload-mcp-client",
        "command": null,
        "text": "请在 MCP 客户端中重新加载该 server 后重跑本诊断。注意本诊断读的是 PATH 上的二进制，客户端已连接的旧进程需重连后本结论才适用。"
      }
    },
    "mcp-server.spec-driver": {
      "id": "mcp-server.spec-driver",
      "category": "mcp-server",
      "product": "spec-driver",
      "status": "not-applicable",
      "summary": "spec-driver 没有对应的 MCP server，该组合在设计上不存在对应物",
      "details": {},
      "remediation": null
    },
    "hook-trust": {
      "id": "hook-trust",
      "category": "hook-trust",
      "product": null,
      "status": "not-applicable",
      "summary": "Codex 家目录下不存在 hooks.json，hook 信任状态不适用",
      "details": {
        "attemptedProbes": [
          {
            "id": "codex-home-hooks-json",
            "outcome": "absent",
            "errorClass": null
          },
          {
            "id": "config-toml-readable",
            "outcome": "found",
            "errorClass": null
          },
          {
            "id": "config-toml-hooks-state",
            "outcome": "found",
            "errorClass": null
          }
        ],
        "trustStatus": "not-applicable",
        "hooksJsonPath": "hooks.json"
      },
      "remediation": null
    }
  }
}
```

### 恢复原 hooks.json

原始输出：

```text
### RESTORED hooks.json
a67ee83fdc811553807fcd0412d61c5ea7bf070d24b793c00c3621f62e4819d5  /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json
RESTORE_MATCH=yes
20:            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use-guard.sh"
```

### 恢复后 hooks/list

原始输出：

```jsonl
{"id":1,"result":{"userAgent":"Codex Desktop/0.151.0 (Mac OS 26.6.2; arm64) dumb (t062-probe; 1.0.0)","codexHome":"/Users/connorlu/.t062-codex-home.9jgpsz","platformFamily":"unix","platformOs":"macos"}}
{"method":"remoteControl/status/changed","params":{"status":"disabled","serverName":"connorlus-MacBook-Pro.local","installationId":"46afe402-cd92-4a0b-b970-4e4442b6be99","environmentId":null},"emittedAtMs":1788171868588}
{"id":2,"result":{"data":[{"cwd":"/Users/connorlu/.t062-probe-project.lvGXFJ","hooks":[{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:pre_tool_use:0:0","eventName":"preToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":0,"enabled":true,"isManaged":false,"currentHash":"sha256:97d44115c67c8b393a2bd63fcf1b117fe3000083403938cf585baf4f8e007ea7","trustStatus":"modified"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:post_tool_use:0:0","eventName":"postToolUse","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/post-tool-use-format.sh","async":false,"matcher":"Edit|Write","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":1,"enabled":true,"isManaged":false,"currentHash":"sha256:6e79e79877af66ca4c45f5e2ac5472aba7bb859905e9b82cc98a99501fb0369b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:session_start:0:0","eventName":"sessionStart","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/scripts/postinstall.sh","async":false,"matcher":"","timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":2,"enabled":true,"isManaged":false,"currentHash":"sha256:2b029e5ad3dcea41f44353a6253b1cc45493ef67dadeec1b06c17a1aff77499d","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:0:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-task-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":3,"enabled":true,"isManaged":false,"currentHash":"sha256:f756a4d0d7bb57ecb46a7412224d81b5cc305be9a61be066cda1cabc5706e30b","trustStatus":"trusted"},{"key":"spec-driver@cc-plugin-market:hooks/hooks.json:stop:1:0","eventName":"stop","handlerType":"command","command":"bash /Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-fix-compliance-check.sh","async":false,"matcher":null,"timeoutSec":600,"statusMessage":null,"additionalContextLimit":null,"sourcePath":"/Users/connorlu/.t062-codex-home.9jgpsz/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json","source":"plugin","pluginId":"spec-driver@cc-plugin-market","displayOrder":4,"enabled":true,"isManaged":false,"currentHash":"sha256:910c20141dee49f6bb646db606b97e3c1f060218fcffd5944795a4815ffa0473","trustStatus":"trusted"}],"warnings":[],"errors":[]}]}}
```

原生 RPC 证明 t 使 modified→trusted。恢复旧命令后旧哈希再次为 modified，说明信任只绑定当前哈希。隔离目录随后整体清理。

### doctor 与 UI remediation 对比

| 项目 | doctor | UI 实测 |
|---|---|---|
| modified 识别 | not-applicable | /hooks 正确显示 modified |
| remediation | null | 有明确入口与按键 |
| 入口 | 无 | /hooks |
| 定位 | 无 | 选择事件并 Enter |
| 授信 | 无 | Press t to trust；按小写 t |
| 二次确认 | 无 | 本次无二次确认，直接 Trusted |

### FR-009/FR-010 与模板原文

原始输出：

```text
### spec.md FR-009 / FR-010
### A3/A4 交叉 — hook 信任诊断与文档（用户决策二）

- **FR-009**（必须，**人工流程已按 C4 升级为硬验收**）：FR-008 的四方诊断 MUST 增加一项独立 check：探测 Codex 侧 hooks 的信任状态（`_grounding.md` §8.3：`HookTrustStatus` 取值域含 `managed`/`untrusted`/`trusted`/`modified`；信任按内容哈希绑定，脚本内容变更即失效）。

  - **探测手段**留给 plan/实施阶段选择（如经 app-server RPC `hooks/list` 读取 `HookMetadata.trustStatus`，`_grounding.md` §4.3 已确认该 RPC 入口存在），但 spec 层面钉死下列合同：
  - **三种情形分别返回固定状态值**（不得合并、不得笼统）：

    | 情形 | check `status` | 必须携带的信息 |
    |---|---|---|
    | 探测到 `untrusted` | `warning` | `remediation.code = grant-hook-trust`，附**经实测验证有效**的授予步骤 |
    | 探测到 `modified`（内容哈希变更导致信任失效） | `warning` | `remediation` 明确说明"hook 脚本内容已变更，需重新授予信任" |
    | 探测失败 / 不可判定 | `indeterminate` | `details` 记录已尝试的探测手段与失败原因（以固定 probe id + reason 枚举形式，见 FR-012(2)） |

  - **MUST NOT** 在探测失败时静默假设"已信任"。
  - **remediation 的实测约束（🔴 闭合 C4）**：`remediation` 中给出的任何步骤，**MUST 事先经过实测验证确实能达成目标状态**；**未经实测的步骤不得写入**。理由：填一个"看似合理实则无效"的步骤，比不给步骤更有害——用户会照做、失败、且不知道为何失败。
  - **人工验收硬 SC（见 SC-013）**：本 FR 的有效性 MUST 通过一次真实人工验证证明，具体要求见 Success Criteria SC-013，**不得**降级为"建议人工验证"。
  - 追溯：milestone A3/A4 交叉；用户决策二；`_grounding.md` §8.3；闭合 **C4**

- **FR-010**（必须，**rev3 已按 W2-plan 补齐实施落点与断言方式**）：Codex 侧 hooks 安装/使用说明文档 MUST 明确写出"首次使用需要完成 hooks 信任授予"这一前置步骤，且安装脚本/流程本身 MUST NOT 自动写入任何绕过信任的配置项，MUST NOT 调用 `--dangerously-bypass-hook-trust`（该 flag 仅允许出现在本 feature 新增的 E2E 测试脚本内部，作为测试场景专用，不得出现在任何面向用户的安装/使用路径）。

  **(1) 文档事实源与生成链（rev3 新增，闭合 W2-plan）**

  - **事实源文件**：`plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs` 中承载 Codex 全局说明文本的那段常量（即当前产出 `~/.codex/spec-driver-capability.md` 说明的同一处，`:82` 附近）。该处是"首次信任"提示的**唯一 canonical 来源**，**MUST NOT** 在其他文件里另写一份平行文案。
  - **生成链**：事实源 → `npm run repo:sync`（wrapper 生成与 body-sha256 重算）→ 全局说明文本产物（`$CODEX_HOME/spec-driver-capability.md`）。该链路受 F238 wrapper body-sha256 门禁保护，改动后 MUST 跑 `npm run repo:sync` + `npm run repo:check` 零失败。
  - **路径文案**：文档中提及的路径 MUST 遵守 FR-007(2) 的文案规则（标注"默认路径，实际以 `CODEX_HOME` 为准"）。

  **(2) 断言方式（至少满足以下三条，验收见 SC-026）**

  1. 生成后的全局说明文本中**含"首次信任"语义的表述**（可机械 grep 的关键词，如"首次"+"信任"）；
  2. 该文本中提及 hooks 路径处**含 `CODEX_HOME` 限定说明**（不得只写死 `~/.codex` 而无限定）；
### spec.md SC-013
814-
815-#### Codex 对抗审查 CRITICAL（6/6 全闭合）
816-
817-| 编号 | 问题 | 闭合位置 |
818-|---|---|---|
819-| **C1** | 全文缺 `SC-*`，无法机械判定完成 | 新增 **§5 Success Criteria**（SC-001 ~ SC-024，每条含命令 + 退出码/字段断言，并按 A3/A4/共通分组） |
820-| **C2** | FR-004 缺防陈旧/防串线关联合同 | rev2 在 **FR-004(2)** 新增关联合同键与 7 类异常样本判定表；**§6.4** 定义合同结构；**SC-007** 要求 12 行负向测试。**⚠️ rev3 说明：该闭合方案随 FR-004 整体改道而撤回**（决策三）——C2 所指的"陈旧/串线"风险在新方案下不复存在，因为 FR-004 不再读取 `.specify/runs/`。 |
821-| **C3** | 四方诊断遗漏强制脱敏 | 新增 **FR-012**（allowlist 而非黑名单、四类禁止输出、四通道覆盖、canary 多编码断言、对齐 doctor redacted）；**SC-014** 机械验收。**rev3 已按 C5-plan 进一步强化为值级 typed schema + 五通道 + 八注入点。** |
822:| **C4** | 信任路径只"建议人工验证"不足 | **FR-009** 升级为三情形固定状态值 + `remediation` 实测约束；**SC-013** 升级为 `[MANUAL]` 硬门禁（untrusted→trusted 真实迁移且不带 bypass flag 验证生效、修改脚本观察 `modified`、未实测步骤不得写入 remediation） |
823-| **C5** | FR-002 白名单无法执行 FR-001 范围约束 | **FR-002** 拆为 **schema 层（10 事件）+ 产品层（4 事件）两层门禁**，失败 code 可区分；校验对象扩至三处（canonical source / 生成结果 / 隔离安装后的 `$CODEX_HOME/hooks.json`）；要求"第五个合法但越界事件"失败测试；**SC-002** 验收。**rev3 已按 C4-plan 澄清两层作用域（schema 层全文件 / 产品层仅我方条目）。** |
824-| **C6** | 漏掉 A 轨已知的机械 inventory 验收 | 新增 **FR-013**（inventory 命令、预期条目、启用状态、失败退出码、复用 F213/F239 但**仍须本轮实跑**）；**SC-022** 验收 |
825-
826-#### Codex 对抗审查 WARNING（7 修 / 1 裁定不采纳）
827-
828-| 编号 | 问题 | 闭合位置 |
829-|---|---|---|
830-| **W1** | FR-003 事实矛盾（Stop payload 无 `tool_name`）+ 阻断语义 over-claim | **FR-003** 改为"allow/block/failure-degrade 基于 Bash 事件 + Stop 独立第四路径"；撤回 §1 与 FR-003 中"已同构""已知降级语义"表述，改标「**待 E2E 确定**」并新增 6 行**观察矩阵**；SC-003 ~ SC-006 分路径验收，SC-006 反向断言测试中不出现 Stop 的 `tool_name` |
831-| **W2** | 诊断比较域与状态机不完整 | **FR-008(1)** 按产品分组比较矩阵（显式排除 `marketplace.metadata.version`）；**(2)** 版本归一化规则；**(3)** `overallStatus` 完整真值表（drift→fail、indeterminate→warning）；**(4)** CLI 退出码真值表（含 `--strict`）；**(5)** `remediation` 结构化 `{code,command,text}`；**(6)** §6.2 schema 由"建议"升级为 **MUST** |
832-| **W3** | §1 对 MCP 风险 over-claim（"杜绝"） | **§1** 目标改为「显式暴露漂移或不可判定状态，降低静默风险」，并明令禁止"杜绝/彻底解决/完全避免"类措辞 |
833-| **W4** | `CODEX_HOME` 边界矩阵不全 + §5.3 接口自相矛盾 | **FR-006** 补齐 9 项边界矩阵并落进 §7 Edge Cases + SC-009；"不存在路径与 doctor 对齐"改标 `[待实测]` 并明确在补测前属**我方自定义语义**（另记入 §10 第 8 条）；**§6.3** 取"强制显式注入"一侧（`deps` 必填 fail-loud + `resolveCodexHomeFromProcess()` 为唯一生产默认值来源），消解 `opts?` 矛盾 |
834-| **W5** | FR-007 漏用户文案与测试迁移面 | **FR-007(2)** 纳入 `extract-wrapper-body.mjs:82` 文案（并提示 sha 门禁需 `repo:sync`）；**(3)** 要求保留 unset 默认行为断言 + 新增自定义 env 用例、禁止机械改写原断言；**(4)** 删除虚构的 worktree cache 消费者，改为可证明的否定项（SC-021）；场景 D 同步修订 |
--
846-
847-#### checklist / clarification 遗留项（6/6 全闭合）
848-
849-| 来源 | 问题 | 闭合位置 |
850-|---|---|---|
851-| checklist 项 1 | 缺独立 Success Criteria 章节 | 同 C1（§5） |
852-| checklist 项 2 | §9 引导句章节号错误（第 5 条出自 §6 非 §8.7） | **§10** 引导句改为「§6 与 §8.7」，并逐条标注各自出处 |
853-| checklist 项 3 | FR-007 "worktree cache 保留可扩展性"缺量化验收 | **FR-007(4)** 删除该不可验证条款，改为可证明的否定项 + **SC-021** |
854-| clarify #1 | FR-004 交叉校验失败是否有否决权 | rev2 在 **FR-004(3)** 写明「仅记录不否决」。**⚠️ rev3：交叉校验设计随 FR-004 改道整体撤回**（决策三），该 clarify 已不适用。 |
855-| clarify #3 | FR-008 "确认不存在等价机制"未操作化 | **FR-008(5)** 给出 5 类可枚举排查点清单（复用 `_grounding.md` §4.1/§8 已排查信号源），走完仍无结果才落 `indeterminate`，`details` 记录已排查信号源；§7 Edge Cases 同步 |
856-| clarify #5 | `overallStatus` 真值表缺 `indeterminate` 映射 | **FR-008(3)** 补全 4 行真值表，`indeterminate`（无 fail）→ `warning`；§6.2 同步；SC-012 验收 |
857-| clarify #6 | FR-003 failure-degrade "对比记录"产出形态 | **FR-003** 明确为**文档产出**（plan.md/tasks.md 设计说明或脚本头注释），**不**设为独立自动化断言 |
858:| Codex INFO 4 | §1 "轨道 A 收尾"措辞 | **§1** 声明为"**实现收口**"，里程碑最终关闭以 T039（SC-024）与信任人工验证（SC-013）完成为条件；§9 同步 |
859-
860-#### 未修改说明
861-
862-- clarify #2（FR-005 (a)/(b) 取舍延后）、clarify #4（FR-009 兜底）经核查为恰当延后/已有兜底，rev2 维持原状并在正文加注核定结论。
863-- 原 spec 的 Non-Goals 九条、FR-001、FR-005、§9 T039 处置结论、§10 未决项 1~6 的事实内容均保留原样（仅补充出处标注与范围锁定措辞）。
### remediation template exact
/**
 * remediation 模板表。
 *
 * 🔴 `grant-hook-trust` 的 `command` 恒为 `null`：FR-009 明确要求「任何步骤 MUST 事先
 * 经实测验证确实能达成目标状态」，而 hook 信任授予的确切命令形态尚未经 SC-013 人工
 * 验证（T062 挂账）。填一个看似合理实则无效的步骤，比不给步骤更有害。
 */
const REMEDIATION_TEMPLATES = Object.freeze({
  'upgrade-global-cli': {
    command: 'npm install -g spectra@latest',
    text: '全局 CLI 与仓库声明版本不一致或不可用，升级全局安装后重跑本诊断。',
  },
  'reinstall-plugin': {
    command: null,
    text: 'active plugin build 与仓库声明版本不一致，请在对应客户端中重新安装该 plugin 后重跑本诊断。',
  },
  'reload-mcp-client': {
    command: null,
    // 🔴 F265 对抗审查 C-2：本诊断探的是 PATH 上的二进制，不是客户端已连接的那个进程。
    // 不点破这一点，读者会把"PATH 上是新的"当成"我正在用的 MCP 也是新的"。
    text:
      '请在 MCP 客户端中重新加载该 server 后重跑本诊断。' +
      '注意本诊断读的是 PATH 上的二进制，客户端已连接的旧进程需重连后本结论才适用。',
  },
  'grant-hook-trust': {
    command: null,
    text: '请参考 Codex 官方文档，在 Codex 客户端中完成 hook 信任授予；在授予完成前 hook 不会执行。',
  },
  'manual-investigate': {
    command: null,
    text: '该维度不可自动判定，需人工排查后重跑本诊断。',
  },
```

### SC-013 原文

原始输出：

```text
- **SC-012 `[A4]` 四方诊断 schema / 状态机 / 退出码 / 值级类型约束**
  命令：`node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --format json`（本 feature 新增）+ `npx vitest run tests/unit/codex-runtime-doctor.test.ts`（本 feature 新增）
  断言：退出码 `0`；JSON 输出通过 schema 校验（`schemaVersion` / `generatedAt` / `overallStatus` / `checks{id,category,status,summary,details,remediation}`）；`checks` 覆盖 `repo-version` / `global-cli` / `plugin-build` / `mcp-server` / `hook-trust` 五个 category；每个 `remediation` 为 `null` 或结构化 `{code, command, text}` 且 `code` 属固定枚举。单测 MUST 覆盖 FR-008(3) 真值表全部 4 行、FR-008(4) 退出码真值表全部 4 行（含 `--strict` 下 `fail → 1`）、以及按产品分组的比较矩阵（含 `marketplace.metadata.version` 被显式排除的断言、版本后缀归一化断言 `spectra v4.4.0 (0ae3eb7)` → `4.4.0`、无法解析时落 `indeterminate` 而非 `fail`）。
  **rev3 追加（闭合 C5-plan）**：MUST 断言所有报告字段的值通过 FR-012(2) 的受限类型校验——枚举字段非法值即构造失败；版本字段不匹配受限 semver 时落 `indeterminate` 而非透传；probe 字段为固定 id + outcome 枚举组合；路径字段为经约束的相对形态。
  追溯：FR-008 / FR-012(2)；闭合 C1 / W2 / clarify #5 / **C5-plan**

- **SC-013 `[A4]` `[MANUAL]` hook 信任状态迁移人工验证（🔴 硬门禁，不可降级）**
  命令：人工在真实 Codex 客户端执行，步骤与观察结果 MUST 逐条记录进 `verification-report.md`
  断言（三段全部达成才算通过）：
  1. **`untrusted → trusted` 真实迁移**：在干净 `CODEX_HOME` 下安装我方 hooks，先观察诊断报告 `hook-trust` check 为 `untrusted`；按 `remediation` 给出的步骤完成授予后，再次观察为 `trusted`；随后**不带** `--dangerously-bypass-hook-trust` 触发一次真实事件，确认 hook **确实执行**（探针文件落盘）。
  2. **`modified` 状态**：修改 hook 脚本内容（哪怕一个字节）后再次探测，确认状态变为 `modified`（验证信任按内容哈希绑定，`_grounding.md` §8.3）。
  3. **`remediation` 有效性**：本次人工验证中**实际执行过**的授予步骤，才允许写入 `remediation`；未实测通过的步骤 MUST 从实现中移除。
  另需断言：诊断对 `untrusted` / `modified` / 探测失败三种情况返回 FR-009 表中规定的**固定状态值**。
  追溯：FR-009；闭合 C1 / **C4**

- **SC-014 `[A4]` 诊断输出强制脱敏（canary × 五通道 × 八注入点）**
  命令：`npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts`（本 feature 新增）
  断言：退出码 `0`；测试注入 canary API key 后，对 **JSON 输出 / 文本输出 / 错误分支输出 / `indeterminate` 分支输出 / CLI 顶层错误输出**五个通道分别断言：canary 的**明文**、**base64**、**URL-encoded**、**JSON 转义**四种形式均**不出现**；同时断言输出中不含原始 config 文件片段、不含完整环境变量集合、不含完整 argv、**不含任何原始 stdout / stderr / error message**。
  **rev3 追加（闭合 C5-plan）**：canary 注入点 MUST **逐一独立覆盖 FR-012(5) 列出的 8 个 adapter**（config.toml / auth.json / 环境变量 / 子进程 stdout / 子进程 stderr / RPC 错误 / 文件读取失败 / 嵌套 probe 失败原因），每个注入点有独立用例，**禁止**用一个注入点代表全部。
  额外静态断言：`details` 的键来自显式 allowlist（实现中存在该 allowlist 常量且被强制应用）；**值**经受限类型构造器产出（存在该构造器且 `summary` / `remediation` / 顶层错误消息均经其产出）；**不存在**基于内容特征的黑名单过滤。
  追溯：FR-012；闭合 C1 / **C3** / **C5-plan**

- **SC-015 `[A4]` `--strict` 下的漂移可被机械捕获**
  命令：`node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --strict --format json`（在构造的漂移 fixture 环境下）
  断言：存在真实版本漂移时退出码 `1` 且 `overallStatus === "fail"`；只有 `indeterminate` 无 `fail` 时退出码 `0` 且 `overallStatus === "warning"`。
  追溯：FR-008(3)(4)；闭合 C1 / W2

- **SC-026 `[A4]` 首次信任提示的文档落点可断言（rev3 新增，闭合 W2-plan）**
```

当前模板“请参考 Codex 官方文档……”缺少本次实测有效的 /hooks、事件选择、Enter、t；运行时因误判 not-applicable 根本没有返回该模板。

## 与 spec 不符清单

### SC-013

1. doctor 未实现 untrusted→trusted 观察，前后均 not-applicable；只有原生 RPC 迁移成功。
2. hook 脚本改一个字节没有变为 modified；只有 hooks.json 命令变化会触发。
3. doctor remediation=null，无法按 doctor 指引授信。
4. 三段必须全部达成，故 SC-013 **FAIL**，T062 不能记 PASS。

### FR-009

1. doctor 没有消费可用的 app-server hooks/list，仍以 $CODEX_HOME/hooks.json 是否存在判定；F264 主路径下产生假阴性。
2. 原生为 untrusted/modified 时，doctor 没有返回规定的 warning 与 grant-hook-trust。
3. “信任按脚本内容哈希绑定”被 0.151.0 实测证伪；currentHash 绑定 hook 命令/声明，不覆盖脚本字节。
4. grant-hook-trust 模板缺少实测可执行步骤。

### FR-010

- 安装、授信、真实事件均未用 --dangerously-bypass-hook-trust，也未写入自动绕过配置：**PASS**。
- 原生初始状态为 untrusted，必须显式授信：**PASS**。

## 建议回填的实测 remediation

~~~text
在目标 CODEX_HOME 下启动 Codex，输入 /hooks；选择标记为 untrusted 或 modified 的事件并按 Enter；确认命令与来源后，按界面提示的小写 t 授予当前哈希信任。显示 Trust Trusted 后退出并重跑 doctor。若没有显示 “Press t to trust”，不要猜测按键，按 Esc 返回并人工排查。
~~~

首次 untrusted→trusted 的完整逐键过程未被逐字回述；只能采用本次完整实测的 modified→trusted 路径，不得补写未观察细节。

## 清理

- 隔离 CODEX_HOME 与探针项目在报告写入后按精确路径清理。
- 未修改真实 ~/.codex。
- 未修改仓库文件；未执行 commit/push/stash/checkout。
- 最终目录与 git status 原始输出在收尾命令后追加。

参考：OpenAI Hooks 文档 <https://learn.chatgpt.com/docs/hooks>。

## 清理确认附录

首次清理时，仍运行的测试 Codex 会话重新创建了 CODEX_HOME 的系统 skills 目录；随后仅终止该隔离测试会话及其 MCP 子进程，并再次清理。两次原始输出如下。

### 首次清理

```text
CODEX_HOME_TARGET=/Users/connorlu/.t062-codex-home.9jgpsz
PROBE_PROJECT_TARGET=/Users/connorlu/.t062-probe-project.lvGXFJ
TARGET_VALIDATION=pass
### AUTH SHA256 BEFORE CLEANUP
04900f654c6d888a6ecbeca84f600fd1cda71089978d6495fe02f15a824add0f  /Users/connorlu/.codex/auth.json
04900f654c6d888a6ecbeca84f600fd1cda71089978d6495fe02f15a824add0f  /Users/connorlu/.t062-codex-home.9jgpsz/auth.json
### DIRECTORY CHECK
CODEX_HOME_EXISTS=yes
PROBE_PROJECT_EXISTS=no
### REAL AUTH AFTER CLEANUP
-rw-------@ 1 connorlu  staff  3885 Aug 25 14:51 /Users/connorlu/.codex/auth.json
04900f654c6d888a6ecbeca84f600fd1cda71089978d6495fe02f15a824add0f  /Users/connorlu/.codex/auth.json
### GIT STATUS PORCELAIN BEGIN
### GIT STATUS PORCELAIN END
### GIT STATUS SHORT BRANCH
## HEAD (no branch)
```

### 终止测试会话并最终清理

```text
### TEST PROCESS BEFORE TERMINATION
32336 32324 codex -C /Users/connorlu/.t062-probe-project.lvGXFJ
32385 32336 node ./mcp/server.cjs --stdio
### TEST PROCESS AFTER TERMINATION
CODEX_TEST_PROCESS_RUNNING=no
MCP_CHILD_RUNNING=no
### FINAL DIRECTORY CHECK
CODEX_HOME_EXISTS=no
PROBE_PROJECT_EXISTS=no
### FINAL GIT STATUS PORCELAIN BEGIN
### FINAL GIT STATUS PORCELAIN END
### FINAL GIT STATUS SHORT BRANCH
## HEAD (no branch)
```

最终结论：隔离 CODEX_HOME 不存在；探针项目不存在；真实 auth.json SHA-256 未变化；仓库 porcelain 输出为空（工作树干净，当前处于 detached HEAD）。

## 工具使用反馈（Dogfooding）

- MCP / RPC 可用性：Codex app-server 的 hooks/list 可用，返回的 source、pluginId、currentHash、trustStatus 足以完成原生验证。
- 返回信息：原生 RPC 信息够用；spec-driver doctor 没有消费该信号，F264 插件主路径下把真实 untrusted/trusted/modified 统一误报为 not-applicable。
- 流程顺畅度：T062 旧骨架依赖全局 hooks.json，与 F264 插件自带 hooks 主路径不兼容；双注册守卫本身工作正常。
- 结果准确性：doctor 的 hook-trust 结论不准确；FR-009/SC-013 关于“脚本内容哈希”的假设也与 Codex 0.151.0 实测不符。
- 反馈落账：本任务硬约束禁止修改仓库文件，因此未追加 docs/design/dogfooding-feedback-ledger.md；上述四项作为后续 Fix 输入随报告交回。
