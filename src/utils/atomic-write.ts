/**
 * 原子写入工具函数
 * 从 checkpoint.ts 的 saveCheckpoint() 提取通用原子写入逻辑
 * 核心流程：确定落点 → 创建目录 → 快照目标 mode → 写随机名 .tmp → 还原 mode → renameSync 原子替换
 *
 * ## 🔴 适用边界：本函数会被用来写"别人的文件"（F267 Root Cause）
 * 它出生于「写我方产物」的场景（checkpoint），当时只需保证内容原子性。后来 `hook-installer`
 * 复用它写用户的 `.claude/settings.json`——复用时只匹配了"需要原子性"这一条，没有重新审视
 * "目标是不是别人的文件"这个维度。而 `rename` 替换的是**整个 inode**：目标的**身份**（是不是
 * 用户软链托管的）与**权限意图**（用户自己设的 mode 位）都随旧 inode 一起被丢弃。
 *
 * ## 🔴 为什么软链跟随是 opt-in 而不是默认（F267 对抗审查 C1）
 * 「跟随软链」这个能力本身是一把双刃：它修好了 dotfiles 用户收不到更新的问题，同时也把
 * 「最多破坏目标位置的一个软链」升级成「能把 JSON 覆写到当前用户可写的任意路径」。
 * git 原生存储软链（mode 120000），**克隆即落盘**——一个第三方仓库只要自带
 * `specs/_meta/graph.json -> ../../../../.ssh/authorized_keys`，跑一次 `spectra batch`
 * 就会写穿过去。实测确证，不需要宽 umask、不需要本地攻击者。
 *
 * 故跟随只发给**用户自己托管的配置文件**（`hook-installer` 写 `.claude/settings.json`），
 * 我方产物（graph / cache / manifest）一律不跟随：它们没有任何合理的软链托管场景，
 * 跟随对它们是纯粹的攻击面。默认值取"安全的那一侧"。
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 目标不存在或权限位读不出时的保守默认；与 codex 侧 `codex-hooks-installer.mjs` 一致 */
const DEFAULT_TARGET_MODE = 0o600;

export interface AtomicWriteOptions {
  /**
   * 目标是符号链接时，是否跟随到真实文件再写。
   *
   * **默认 false（不跟随，rename 会替换掉软链本身）**——见模块头「为什么是 opt-in」。
   * 只有写"用户可能用 dotfiles 托管的配置文件"时才应显式传 true。
   */
  followSymlinks?: boolean;
}

/**
 * 决定实际写入落点。
 *
 * `followSymlinks` 为 true 且目标是软链时跟随到真实文件——用户把配置软链进 dotfiles 仓库是
 * 常见形态，直接 `rename` 到链接路径会把软链替换成普通文件：链接被悄悄拆掉，而用户真正在
 * 版本管理的那份文件永远收不到更新，两头都错。
 *
 * 🔴 `realpathSync` 失败时**必须告警再回落**（F267 对抗审查）：悬空软链、软链环（ELOOP）、
 * 中间目录不可穿越（EACCES）三种形态下解析都会失败，此时回落字面路径 = 照样拆链。
 * 静默回落等于对调用方谎称"身份已保全"，而用户的 dotfiles 真实文件一个字节都没收到。
 * 这里不抛错（写入本身仍能完成、拆链不是数据丢失），但必须让用户看得见。
 */
function resolveWriteTarget(targetPath: string, followSymlinks: boolean): string {
  if (!followSymlinks) return targetPath;
  let isLink = false;
  try {
    isLink = fs.lstatSync(targetPath).isSymbolicLink();
  } catch {
    // 目标不存在：没有身份需要保全，按字面路径创建
    return targetPath;
  }
  if (!isLink) return targetPath;
  try {
    return fs.realpathSync(targetPath);
  } catch (error) {
    console.warn(
      `[spectra] ${targetPath} 是符号链接但无法解析真实路径（${
        (error as NodeJS.ErrnoException).code ?? String(error)
      }），本次写入将替换该链接本身；链接指向的文件不会收到更新。`,
    );
    return targetPath;
  }
}

/**
 * 读目标文件当前的 mode 位（含 setuid/setgid/sticky 高位）。
 * `& 0o7777` 而非 `& 0o777`：后者会把用户刻意设置的高位静默丢掉。
 *
 * 只对**普通文件**取快照：目标是目录/设备等非普通文件时，读到的 mode 属于另一类对象
 * （如目录的 0755），拿它去 chmod 一个即将变成普通文件的 tmp 是张冠李戴（F267 / I4）。
 * 读不到、或不是普通文件，一律回落 0600——写入内容可能是私密配置，宽松 umask 下按默认
 * mode 创建就是 0644 甚至 0666。
 */
function readTargetMode(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.mode & 0o7777 : DEFAULT_TARGET_MODE;
  } catch {
    return DEFAULT_TARGET_MODE;
  }
}

/**
 * 原子写入 JSON 数据到文件
 *
 * ## 三条保证
 * 1. **内容原子性**：先写 tmp 再 `rename`，读者永远看到完整的旧版本或完整的新版本；
 * 2. **身份保全**（仅当 `followSymlinks: true`）：目标是软链时跟随到真实文件，不拆用户的
 *    dotfiles 托管；解析失败时降级为拆链并**打印告警**，不静默；
 * 3. **mode 位保全**：写入前快照目标的 mode 位，`rename` 前按快照精确还原。
 *
 * ## ⚠️ 保全的是 mode 位，不是"权限"（F267 对抗审查 W3）
 * `rename` 换 inode 的同时也换掉 owner 与 group（BSD 语义下新文件继承**目录**的 group）。
 * 那三个八进制数字被精确保全，但**能访问这个文件的人可能变了**——例如 `0660 root:admin`
 * 写完会变成 `0660 <当前用户>:<目录组>`。owner/group 不在保全范围内，这不是本次引入的
 * （`rename` 一直如此），但别把"mode 位保全"读成"权限语义不变"。
 *
 * ## ⚠️ 保全 ≠ 加固
 * 已存在文件的宽 mode（用户自己设的 0666）会被**如实保全**，本函数不做"顺手收紧"——那是替
 * 用户改他的配置。收紧到 0600 只发生在**首次创建**的路径上。
 *
 * ## ⚠️ TOCTOU
 * `stat` 与 `rename` 之间目标 mode 若被并发修改，保全的是"写入开始时的快照"而非最终值。这不是
 * 原子操作，此处显式承认、不加伪补偿（重读校验只会把窗口挪个位置）。
 *
 * ## 为什么 tmp 名带 pid + 随机后缀
 * 固定名 `${target}.tmp` 下两个并发进程会争用同一个 tmp 路径：一方 `rename` 走后另一方报
 * `ENOENT`，更坏的是"胜出方"rename 的可能是对方写进去的 payload，等于**静默丢更新**。
 * 各写各的 tmp 后，`rename` 是同目录内的原子替换，结果必为其中一方的**完整**文档。
 * 随机分量用 `crypto.randomBytes` 而非 `Math.random().toString(36)`——后者在
 * `Math.random()` 返回极小值时会退化出空串/单字符后缀（已实算确证）。
 *
 * ## 已知边界（登记，不修）
 * - **孤儿 tmp 累积**：崩溃残留的唯一名 tmp 不会被后续写入覆盖或清理（固定名时代最多留 1 个）。
 *   清理逻辑只碰本次调用自己创建的那一个，不敢碰"别人的 tmp"。
 * - **硬链接**被 `rename` 断开：另一条链保留旧内容。「身份保全」只覆盖软链。
 * - **tmp 名比目标名长 ~20 字节**：basename 逼近 NAME_MAX 时会比旧实现更早报 ENAMETOOLONG；
 *   当前 5 个消费方的 basename 都远够不到。
 *
 * ## 为什么不加 `diagnostics` 参数（与 codex 侧 parity 的刻意分歧）
 * codex 侧 `writeJsonAtomic` 用必传的 `diagnostics` 数组上报降级事件，因为它有一个天然的上层
 * 收集器（`commit`）。本函数是 5 个消费方共享的**底层工具**，其中 3 个写的是我方产物、根本不
 * 关心权限细节：给默认值 `[]` 等于让告警落进随即被丢弃的数组（parity 注释已点名这是反模式），
 * 设为必填则是纯噪声。故降级事件一律 `console.warn`，不做结构化返回。
 *
 * @param filePath - 目标文件路径
 * @param data - 要序列化为 JSON 的数据
 * @param options - 见 `AtomicWriteOptions`
 */
export function writeAtomicJson(
  filePath: string,
  data: unknown,
  options: AtomicWriteOptions = {},
): void {
  const resolvedPath = path.resolve(filePath);

  // 确保目录存在。
  // 🔴 不比照 codex 侧加 `mode: 0o700`：那是针对 `hooks.json`「目录里换一份文件即命令注入」
  // 的加固，本函数的 5 个消费方里 3 个写的是我方缓存/图产物，收紧它们的目录权限属于卡面未
  // 点名的额外加固（「保全 ≠ 加固」同样适用于目录层）。`.claude/` 目录的权限面另有登记，
  // 见 `hook-installer.ts` 中 `.claude/` 目录创建处。
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  // 🔴 落点必须贯穿 tmp 命名与 rename：tmp 若建在软链所在目录、再 rename 到软链路径，链接
  // 照样被拆。tmp 与最终目标必须同属一个目录，rename 才是同设备原子替换。
  const writeTarget = resolveWriteTarget(resolvedPath, options.followSymlinks === true);
  const followed = writeTarget !== resolvedPath;
  const targetMode = readTargetMode(writeTarget);
  const tmpPath = `${writeTarget}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  const content = JSON.stringify(data, null, 2);
  // 🔴 只有"我们确实创建了这个 tmp"才允许清理它。`flag:'wx'` 报 EEXIST 时那个路径上的文件
  // 是**别人的**（并发进程的 tmp，或被预置的诱饵），无条件 rmSync 会把它删掉——清理动作
  // 本身变成破坏动作。
  let tmpCreated = false;

  try {
    // `mode: 0o600` + `flag: 'wx'`（O_EXCL）：
    // - 创建即 0600 保证内容从落盘第一刻起就不宽于 0600，消除"chmod 之前以 0644 暴露"的窗口
    //   （`open(2)` 的 mode 受 umask 掩蔽，只会更严不会更松）；
    // - O_EXCL 让"tmp 路径被预置成已有文件或软链"直接报错落进下面的清理分支，而不是顺着别人
    //   的软链把内容写到未知位置。EEXIST 时**不重试**：换个随机后缀重试会把确定性抛错变成
    //   概率性成功，掩盖真实的路径冲突信号。
    try {
      fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
      tmpCreated = true;
    } catch (error) {
      // 🔴 跟随软链后落点不可写是一个**用户完全看不懂**的失败（F267 对抗审查 C3）：
      // Nix home-manager / nix-darwin 把配置软链进只读的 `/nix/store`，裸抛的 EACCES 指向一个
      // 用户从没听说过、名字还是随机的 `.tmp.<pid>.<rand>` 路径。这里换成指名道姓的错误。
      const code = (error as NodeJS.ErrnoException).code;
      if (followed && (code === 'EACCES' || code === 'EROFS' || code === 'EPERM')) {
        throw new Error(
          `[spectra] 无法更新 ${resolvedPath}：它是指向 ${writeTarget} 的符号链接，` +
            `而该真实文件所在目录不可写（${code}）。若配置由 Nix / 只读 store 托管，` +
            `请改在托管源处修改，或先把该路径换成可写的普通文件。`,
          { cause: error },
        );
      }
      throw error;
    }
    try {
      // chmod 不受 umask 影响，才能还原 0640 / setgid 这类原值。
      fs.chmodSync(tmpPath, targetMode);
    } catch (error) {
      // 🔴 chmod 失败**不阻断写入**：无权限位的文件系统（exFAT / SMB / 部分容器 overlay）上
      // "权限被放宽"这个风险面本就不存在，让一个锦上添花的元数据动作反过来把本可正常完成的
      // 写入拦下来，是新增了此前不存在的阻断面。此时最终权限仍不宽于 0600（tmp 的创建 mode），
      // 只是没能精确匹配原文件可能更严格的形态，故告警让用户可核对。
      console.warn(
        `[spectra] 目标文件 mode 保全失败（${writeTarget}），已按默认权限写入: ${
          (error as NodeJS.ErrnoException).code ?? String(error)
        }`,
      );
    }
    fs.renameSync(tmpPath, writeTarget);
  } catch (error) {
    if (tmpCreated) {
      try {
        // 只清理本次调用自己创建的那一个 tmp；升级前遗留的固定名 `${target}.tmp` 残留、以及
        // 其它进程的 tmp，对本实现都是"别人的文件"，不在清理范围内。
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // 清理失败不掩盖原始错误
      }
    }
    throw error;
  }
}
