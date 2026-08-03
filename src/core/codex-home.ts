/**
 * Feature 240 / FR-006：Codex 家目录解析（Node 侧唯一事实源）
 *
 * 语义：环境变量 `CODEX_HOME` 存在且非空时使用其值；否则 fallback 到 `<家目录>/.codex`。
 *
 * 🔴 与官方 `codex doctor` 的对齐边界（实测结论见 `specs/240-codex-runtime-closeout/_grounding.md` §9.6）：
 * - **对齐**：空串等同未设置 → fallback。这一条经实测确认与 doctor 行为一致。
 * - **不对齐（我方自定义语义，不得声称对齐）**：doctor 会做规范化（去尾斜杠 / 转绝对 / 解 symlink），
 *   且对**不存在的目录**直接判 `fail`。本 helper 是纯函数、零 I/O，**只做取值与 fallback**，
 *   既不规范化也不做存在性校验；路径是否存在、是否可写，由各调用点按需自行处理并 fail-loud。
 *   不做规范化的理由：realpath 等规范化需读文件系统，会破坏纯函数属性，
 *   并使 shell 侧 `lib/codex-home.sh` 的逐字节对拍无法进行。
 *
 * 🔴 作用域边界（`_grounding.md` §9.2）：本 helper **只服务于以家目录为基**的全局 Codex 路径。
 * 以仓库根 / 当前工作目录为基的仓库内 `.codex/` 路径（如项目级 skills 安装、
 * `.codex/skills/` 下的 F238 wrapper 产物）**MUST NOT** 消费本 helper。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 与 shell 侧 `plugins/spec-driver/scripts/lib/codex-home.sh` 的等价性范围
 *    （Codex 对抗审查 W1 修订：原注释声称「逐字节等价」属 over-claim，已按实测收窄）
 *
 * **等价范围**（由 `tests/unit/codex-home-shell.test.ts` 的对拍用例机械保证）：
 *   (a) `CODEX_HOME` 显式非空（绝对 / 相对 / 尾斜杠 / 内部重复斜杠 / 含空格 /
 *       波浪号字面量 / symlink / 不存在 / 无权限）——一律原样返回，两侧逐字节一致；
 *   (b) `CODEX_HOME` 未设置或为空串，且家目录为**不含 dot-segment** 的非空值
 *       ——两侧同为 `<家目录>/.codex`，逐字节一致。
 *
 * **已知差异**（实测确认，两侧注释与测试矩阵同步登记，不得再声称等价）：
 *   | # | 输入形态                    | Node 侧                       | shell 侧                     | 处置 |
 *   |---|-----------------------------|-------------------------------|------------------------------|------|
 *   | 1 | 值含换行符 `\n`             | 原样保留                      | 消费端 `$(...)` 剥尾换行     | **已消除**：两侧统一 fail-loud 拒绝（见 assertNoNewline） |
 *   | 2 | `HOME` 与 `CODEX_HOME` 同 unset | `os.homedir` 经系统账户仍得家目录 | `${HOME:-}` 为空 → 非零退出 | **保留差异**：shell 侧 fail-loud，Node 侧走系统 fallback |
 *   | 3 | 家目录含 dot-segment（`.` / `..`） | `path.join` 做词法规约        | 原样拼接，不规约             | **保留差异**：见下方理由 |
 *
 * 差异 2 不修的理由：让 shell 侧也取系统账户需引入 `getent`（Linux）/ `dscl`（macOS）
 *   平台分支，把一个纯字符串函数变成依赖平台工具链的探测器；而 `HOME` unset 在
 *   Codex / npm 生命周期脚本的实际运行环境中属异常态，此时 shell 侧 fail-loud
 *   （提示显式设置 `CODEX_HOME`）比静默猜一个家目录更安全。
 * 差异 3 不修的理由：对齐 `path.join` 需在 bash 里重写一份 `path.normalize`
 *   （`.` / `..` / 前导 `..` / 绝对与相对的不同规约规则），等于手写路径解析器——
 *   F231 已实证该类手写解析器是逃逸面而非防线。且词法规约 dot-segment 在
 *   symlink 存在时与内核实际解析结果**本就不一致**（`/a/../b` 中 `/a` 若为
 *   symlink，内核解析结果 ≠ `path.join` 给出的 `/b`），故"两侧都规约"并不比
 *   现状更正确。含 dot-segment 的家目录属病态输入，由测试矩阵显式登记其行为。
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 拒绝含换行符的取值（上表差异 1 的两侧统一处置）。
 *
 * 为何必须 fail-loud 而非各自返回：shell 消费端一律以 `$(resolve_codex_home_from_env)`
 * 取值，command substitution 会**剥掉全部尾部换行**，Node 侧则原样保留 —— 同一个
 * `CODEX_HOME` 会在两条链路上指向**不同目录**，而 `remove --global` 会据此
 * 删除错误的目录（静默破坏性后果）。换行在目录名中虽 POSIX 合法，但实际只可能
 * 来自误用（如 `CODEX_HOME=$(cat path.txt)` 带上了文件尾换行），故直接拒绝。
 *
 * 只拦 `\n` 不拦 `\r`：command substitution 不剥 `\r`，两侧对 `\r` 行为一致，
 * 不构成分叉，不在此处扩大拦截面。
 */
function assertNoNewline(value: string, label: string): void {
  if (value.includes('\n')) {
    throw new TypeError(
      `resolveCodexHome：${label} 含换行符，无法在 Node 与 shell 两侧一致解析（shell 的 $() 会剥掉尾部换行导致指向不同目录），请修正取值`,
    );
  }
}

export interface CodexHomeDeps {
  /** 环境变量表（必填，禁止由函数体内隐式取全局） */
  env: Record<string, string | undefined>;
  /** 家目录取值函数（必填，同上） */
  homedir: () => string;
}

/**
 * 解析 Codex 家目录（纯函数）。
 *
 * `deps` **必填**而非「可选 + 内部默认」：可选参数必然要求函数体内保有默认值来源，
 * 与「不隐式读取全局」逻辑冲突。F238 已实测证明「可选参数 + 内部默认值」会让 caller 的
 * 遗漏静默降级为默认行为，从而掩盖下游缺陷 —— 故此处取「强制显式注入 + 运行期 fail-loud」。
 *
 * @throws {TypeError} `deps` 缺失或形状非法；或 fallback 分支下家目录取值为空。
 */
export function resolveCodexHome(deps: CodexHomeDeps): string {
  // TypeScript 类型只在编译期约束，.mjs / JS 调用方可绕过 → 运行期守卫不可省
  if (typeof deps !== 'object' || deps === null) {
    throw new TypeError('resolveCodexHome(deps) 需要显式传入 deps 对象（禁止隐式默认值）');
  }
  if (typeof deps.env !== 'object' || deps.env === null) {
    throw new TypeError('resolveCodexHome(deps) 的 deps.env 必须为对象');
  }
  if (typeof deps.homedir !== 'function') {
    throw new TypeError('resolveCodexHome(deps) 的 deps.homedir 必须为函数');
  }

  const configured = deps.env['CODEX_HOME'];
  // 非空即原样返回：不 trim、不规范化、不校验存在性（唯一例外是换行符 —— 见 assertNoNewline）
  if (typeof configured === 'string' && configured !== '') {
    assertNoNewline(configured, 'CODEX_HOME');
    return configured;
  }

  const home = deps.homedir();
  // 空家目录会让 join('', '.codex') 得出相对路径 '.codex'，写操作将落进当前工作目录 ——
  // 属静默灾难，且 shell 侧无法对该形态逐字节对拍，故两侧统一 fail-loud。
  if (typeof home !== 'string' || home === '') {
    throw new TypeError('resolveCodexHome 无法 fallback：家目录取值为空，请显式设置 CODEX_HOME');
  }
  assertNoNewline(home, '家目录取值');
  return join(home, '.codex');
}

/**
 * 生产环境入口：全仓库唯一显式读取真实运行时环境与家目录的位置。
 *
 * 所有生产代码 MUST 经本函数取值，不得各自读取环境变量，
 * 以保证「取值来源单一 + 纯函数可测」两个属性同时成立。
 */
export function resolveCodexHomeFromProcess(): string {
  return resolveCodexHome({ env: process.env, homedir: () => homedir() });
}
