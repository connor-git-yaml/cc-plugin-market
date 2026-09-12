/**
 * F283 — 委派工具名的**唯一事实源**。
 *
 * why 单独成模块：此前 core（transcript 侧提取委派）/ ledger-writer（PostToolUse 采集侧）/ ledger-reader
 * （账本读取侧）各持一份 `new Set(['Agent', 'Task'])`，core↔reader 之间零守卫——三份漂移会让采集、读取、
 * 判定对"什么算委派"各说各话（对抗 E W-1 实测：改 hooks.json matcher 零测试变红）。放在独立 lib 而不是
 * 任一既有模块：core 是零 I/O 纯函数层，不得反向 import 有 I/O 的 writer；reader 已 import writer，
 * writer 再 import reader 即成环。本模块进判定器 import 闭包（JUDGE_FILE_SET）。
 *
 * 真不可变（对抗复审两路 W-4）：`Object.freeze(new Set())` 只冻结对象属性、**不阻止** `add / delete / clear`，
 * 三处消费方任一处误 `.add` 都会静默扩大委派白名单。此处把三个变更方法覆盖为抛错后再冻结。
 *
 * `Agent` = 当前 CLI 记录名，`Task` = 历史 / 未来名，等价对待。`SendMessage` 刻意不并入——"派了工"
 * 与"给已派的工发消息"是两件事（core 有专门用例钉住）。hooks.json 里账本 handler 的 matcher
 * 必须逐项等于本集合（ledger-writer 测试派生校验）。
 */
function immutableSet(values) {
  const set = new Set(values);
  const refuse = (op) => () => { throw new TypeError(`DELEGATION_TOOL_NAMES 是不可变集合，拒绝 ${op}（委派白名单只能在 delegation-tool-names.mjs 改）`); };
  Object.defineProperties(set, {
    add: { value: refuse('add'), writable: false, configurable: false },
    delete: { value: refuse('delete'), writable: false, configurable: false },
    clear: { value: refuse('clear'), writable: false, configurable: false },
  });
  return Object.freeze(set);
}

export const DELEGATION_TOOL_NAMES = immutableSet(['Agent', 'Task']);
