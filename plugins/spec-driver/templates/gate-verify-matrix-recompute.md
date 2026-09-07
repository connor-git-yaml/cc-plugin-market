**`GATE_VERIFY` 矩阵冻结值重算（由 `templates/gate-verify-matrix-recompute.md` 单一事实源经 `npm run docs:sync:agents` 注入，请勿手改本块）**

冻结值链的**唯一外部锚**是编排器在 `GATE_VERIFY` 的**亲自重算**——verify 子代理持有 `Bash`，磁盘上的 `plan.md` 与 `tasks.md` 都在它的写面之内，同一次推理可连矩阵带哈希一并原地改写；它改不了的只有编排器发给它的 prompt 文本，以及编排器自己算出来的那个数。**本块把该重算写进编排器的可执行口径**：委派清单一项、门决策前置一步、日志行三个字段位。**本块不新增门、不新增任何需要用户拍板的中断点、不改 `gate_policy` 到 `behavior` 的映射、不改 `orchestration.yaml` 的 gate 定义**——它只规定这一道**既有**门在做决策之前必须先算什么、日志里必须留下什么。

## (a) verify 委派 prompt 的显式清单加一项

委派 verify 子代理时，prompt 的显式清单**必须包含**：

> **`GATE_TASKS` 冻结值注入块** —— 三项齐全：**规范化 sha256** + **冻结时点** + **表行数（含计数单位）**。

- 该注入块的产生者是编排器在 `GATE_TASKS` 通过后执行的四步动作（见共享块 `gate-tasks-scope-cut-acceptance.md` 的「冻结值字段格式」一节）。
- **不在清单里就等于没有**：委派拼装是逐项照抄清单的，写在别处的旁注不会被拼进去。清单缺该项时，verify 拿不到 ① 注入值，按其判定态定义该项判「**未执行（缺席）**」并归入不通过侧。
- **本会话无持有值时照样要写**：写「冻结值注入块：`absent`（原因：{本 mode 不挂 `GATE_TASKS` / `resume` 会话未取到冻结字段 sha / 其他}）」。**留空与写 `absent` 不等价**——前者与「忘了拼」同形。

## (b) `GATE_VERIFY` 决策的前置步骤（在取 `behavior` 之前先算）

**顺序固定：先重算、再取 `behavior`、最后决策。** 把重算放到决策之后，就只剩一个记录动作，无法影响结论。

**第 1 步 · 重算**（命令原文，逐字照抄，把 `<plan.md>` 换成本次 `plan.md` 的实际路径）：

```bash
python3 -c "import re,hashlib;t=open('<plan.md>',encoding='utf-8').read();s=re.search(r'(?ms)^## FR → Phase 覆盖矩阵\n(.*?)(?=^## )',t).group(1);n='\n'.join(l.rstrip() for l in s.replace('\r\n','\n').split('\n'));n=re.sub(r'\n{3,}','\n\n',n).strip('\n')+'\n';print(hashlib.sha256(n.encode()).hexdigest())"
```

该命令实现的规范化与冻结时点**同一套**：CRLF → LF、去行尾空白、折叠连续空行、去首尾空行后补一个换行，再取 sha256。**两处不得各写一套**——规范化规则不同则两个哈希必然不等，重算会恒报不一致。

**第 2 步 · 比对**：把第 1 步的输出与**本会话持有的 `GATE_TASKS` 注入值**比对，得出三个字段：

| 字段 | 取值 | 口径 |
|---|---|---|
| `recomputed` | `{sha8}` | 第 1 步输出的**前 8 位**；命令报错或章节取不到时记 `error` |
| `held` | `{sha8}` 或 `absent` | 本会话持有值的前 8 位；**无持有值记 `absent`** |
| `match` | `yes` / `no` / `absent` | 两值相等记 `yes`，不等记 `no`，**任一侧为 `absent` 或 `error` 记 `absent`** |

**`absent` 的三种合法来源（须在 `reason` 里写明是哪一种）**：

1. 本 mode 不挂 `GATE_TASKS`（如 `fix`），本会话从来没有过冻结值；
2. `resume` 会话取不到冻结字段的 commit sha（缺 sha，或 `git cat-file -e <sha>` 失败）；
3. 重算命令本身失败（`plan.md` 不存在、矩阵章节取不到、`python3` 不可用）。

**`match=absent` ⇒ 矩阵对账记「未执行（缺席）」**并归入合并律的不通过侧。**不得**因「本 mode 本来就没有冻结值」而把该项记为通过——「没有可比的」与「比过了且一致」是两件事，前者是缺席不是达标。

**第 3 步 · 取 `behavior` 并决策**（既有流程不变），随后按 (c) 输出日志行。

## (c) 日志行模板（扩三个字段位）

```text
[GATE] GATE_VERIFY | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | merge={pass|fail} | recomputed={sha8|error} | held={sha8|absent} | match={yes|no|absent} | reason={理由}
```

- `merge` 取自 verify 返回摘要里的**合并律结论**（`pass` / `fail`）；返回摘要没有该结论时记 `fail` 并在 `reason` 写明「合并律结论缺席」——**缺结论按不通过处理**，与「判不出从严」同向。
- **三个新字段位不是可选装饰**：**没有字段位的要求等于没有要求**，日志行模板是编排器唯一会照抄的东西。缺字段位时，「算了并比对了」与「一步没做而 verify 自报三值一致」在日志上完全同形。
- `reason` 在 `match=no` 时**必须**写明差异：重算值、持有值、以及「矩阵在哪个阶段被改过」的判断。

## (d) 决策必须消费上面两个结论

**`merge=fail` 或 `match=no` ⇒ 不得 `AUTO_CONTINUE`。**

- 这一条**优先于 `behavior` 的 `auto`**：`behavior=auto` 只说明这道门在无异常时不停下，它**不构成**对「合并律判不通过」或「重算与持有值不一致」的放行依据。
- `match=absent` 时按上文归为「未执行（缺席）」⇒ 计入合并律不通过侧 ⇒ 由 `merge=fail` 承接，同样不得 `AUTO_CONTINUE`。
- **本条不改变门是否停下的 `behavior` 语义**：它改变的是**决策取值**——`decision` 不得取 `AUTO_CONTINUE`，转入该门既有的处置路径（展示制品与结论，等用户裁决）。**这是既有交互，不是新增的中断点。**

**为什么这一条必须写在编排器侧而不是 verify 侧**：verify 的判定态定义里已有「① 缺席 ⇒ 判『未执行（缺席）』」，那条 fail-loud 反过来给了 verify 一个**造假动机**——不自写 ①，本项就必红。三值全部由 verify 自读、自算、自报，人工在门内看到的是它自报的一致，没有任何独立读数可对。**编排器的重算是这条链上唯一一个不落在 verify 写面内的读数。**
