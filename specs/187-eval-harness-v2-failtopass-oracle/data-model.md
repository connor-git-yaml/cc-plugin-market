---
feature_id: 187
artifact: data-model
created: 2026-06-14
---

# F187 数据模型

## 枚举类型

```javascript
// OracleClass — oracle 三分类结果
OracleClass = 'pass' | 'fail' | 'error'

// FailureSource — 失败归因
FailureSource = 'none'        // pass 时
              | 'infra'       // 基础设施层故障，剔除分母
              | 'candidate'   // 候选 patch 导致的失败，计入分母
              | 'fixture'     // fixture 数据/配置错误，剔除分母并告警

// OraclePhase — 执行阶段（自前向后）
OraclePhase = 'image'          // 镜像拉取/构建
            | 'container_start' // 容器启动
            | 'patch_apply'    // patch 应用
            | 'test_exec'      // pytest 执行中
            | 'report_parse'   // 解析 report/log
            | 'done'           // 完成
```

## OracleResult — oracle 执行统一合同

```javascript
OracleResult {
  cmd:            string          // 实际执行的命令字符串（含参数）
  passed:         boolean         // classification === 'pass'
  exitCode:       number | null   // harness 进程退出码
  signal:         string | null   // 进程终止信号（如 'SIGKILL'）
  timedOut:       boolean         // 外层 TS watchdog 触发的超时
  classification: OracleClass
  failureSource:  FailureSource
  phaseReached:   OraclePhase     // 失败时到达的最后阶段
  stdoutTail:     string          // stdout 末尾 ≤2000 字符
  stderrTail:     string          // stderr 末尾 ≤2000 字符
  details:        SwebenchOracleDetails  // 结构化详情（不截断）
}

SwebenchOracleDetails {
  instanceId:            string        // SWE-Bench instance_id
  candidatePatchSha:     string        // 候选 patch 的 sha256（防 goldPatch 误用）
  resolved:              boolean|null  // harness report.json resolved 字段
  completed:             boolean|null  // harness report.json completed 字段
  failToPassExecuted:    string[]      // 实际执行到的 failToPass test ids
  passToPassExecuted:    string[]      // 实际执行到的 passToPass test ids
  failToPassCount:       number        // fixture 声明的 failToPass 数量
  passToPassCount:       number        // fixture 声明的 passToPass 数量
  pytestExitCode:        number|null   // 容器内 pytest 退出码（从 log 反解）
  archFallback:          'rosetta'|null // arm64 镜像缺失时回退 Rosetta
  retried:               boolean       // 是否因 segfault 重试过
  logPath:               string        // harness log 文件落盘路径
}
```

## CohortEntry — cohort 注册表条目

```javascript
CohortEntry {
  id:                string    // cohort 唯一 id（如 'baseline-claude'）
  tool:              string    // 对应 eval-task-runner.mjs --tool 值
  promptBuilder:     function | null  // (taskPrompt: string) => string；null = 抛错
  claudeArgsProfile: string    // 'default' | 'spectra-mcp' 等 arg 组合标识
  prepSteps:         string[]  // 跑前准备步骤（如写 .mcp.json）
  stdinPolicy:       'positional' | 'stdin'  // prompt 传递方式
}
```

## FreezeBlock（扩展后）— 预注册快照结构

```javascript
FreezeBlock {
  // 原有字段（F176 兼容）
  taskSetHash:        string   // sorted taskIds 的 sha256
  frozen:             boolean
  count:              number
  seed:               number|null
  filterRule:         string|null
  gitCommit:          string|null
  taskIds:            string[]

  // F187 新增字段
  schemaVersion:      string   // "1.0"
  oracleSpecHash:     string   // oracle 语义 hash（含分类逻辑源码摘要）
  fixtureContentHash: string   // 全部 fixture 文件内容 sha256
  promptSha256:       string   // effective prompt sha256（对应 meta.promptSha256）
  datasetSourceDigest: string|null  // 本地 JSONL 内容 sha256（方案 A）
  datasetHFRevision:  string|null   // HF dataset revision（方案 B，互斥于 datasetSourceDigest）
}
```

## OracleSpecHashInput — oracleSpecHash 的 canonical 输入结构

```javascript
// 字段按字母序 sort + JSON.stringify → sha256
OracleSpecHashInput {
  arch:                  'arm64-first' | 'x86_64'
  classifyOracleSha256:  string   // classify-oracle.mjs 文件内容 sha256
  datasetSource:         string   // 'local-jsonl' 或 'hf:{name}@{revision}'
  kind:                  'swebench-execution'
  swebenchVersion:       string   // 如 '2.1.3'
  timeout:               number   // watchdog timeoutMs
}
```

## ExperimentManifest — batch 编排参数化配置

```javascript
ExperimentManifest {
  schemaVersion:      string   // "1.0"
  model:              string   // 默认 'claude-opus-4-7'
  outputFormat:       string   // 默认 'stream-json'
  cleanup:            'always' | 'on-success' | 'never'  // 默认 'on-success'
  repeat:             number   // 默认 3（full mode）
  skipJury:           boolean  // 默认 false
  quotaCheckInterval: number   // 默认 6
  swebench: {
    timeoutMs: number   // 默认 300000（5 分钟）
    venvPath:  string   // 默认 'scripts/.swebench-venv'
  }
}
```

## PatchArtifact — 持久化产物集合

```javascript
// 路径约定：run_artifacts/<run_id>/
PatchArtifact {
  runId:     string   // taskId__tool__rN
  patchDiff: string   // 仅 PASS run，git diff 字节级内容
  stdoutLog: string   // 所有 run（harness stdout）
  stderrLog: string   // 所有 run（harness stderr）
}

// 磁盘路径
run_artifacts/
└── <run_id>/
    ├── patch.diff    // 仅 PASS run
    ├── stdout.log    // 所有 run
    └── stderr.log    // 所有 run
```
