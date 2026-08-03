/**
 * F248：图采集面专用的扩展名提取纯函数（零依赖叶子模块）。
 *
 * 收敛 `source-commit.ts::extname` 与 `quality/ignore-oracle.ts::extnameOf` 两份
 * 逐字重复的私有实现（同引入于 F217 的 0f72d4a，仅函数名/参数名不同）。两者均为
 * 模块私有且异名，重复对符号搜索不可见，直到 F243 并排对比时才暴露。
 */

/**
 * 提取路径末尾从最后一个 `.`（含）到末尾的子串——**严格大小写、全字符串搜索**，
 * 不做 dotfile / basename 特判。
 *
 * ## 为什么不用 `path.extname`
 *
 * 本函数服务于「图采集面判定」：两处调用方的返回值都只用于 `Set.has()` 白名单查询，
 * 白名单镜像的是 TSJS/PY collector 的 `name.endsWith(ext)` 精确匹配判定面
 * （source-discovery.ts 的 walkTsJsFiles / walkPyFiles）。这两个生产者的 `endsWith`
 * 区分大小写、也不理解 dotfile 语义，因此提取侧必须同样"笨"才能与之对齐
 * （迁自 source-commit.ts 的 FIX-4 决策：生产者不收 `.TS` 文件，freshness 就不该把
 * 它算作触发 dirty 判定的源码改动，否则会把生产者根本不会重新分析的改动误判为
 * "图未反映最新改动"）。注意 generic collector（Java/Go，
 * generic-language-skeleton-collector.ts::walkFiles）是既有例外：它用
 * `path.extname(name).toLowerCase()` 判定（大小写不敏感、dotfile 特判），本函数
 * 不镜像该差异——这是 F248 之前就存在的判定面不一致，属收敛范围外的预存行为，
 * 已在 fix-report 登记残留。
 *
 * 与 `path.extname` 的语义差异如下——这些**不是 bug，是行为合同**：
 *
 * | 输入                | extractExtension          | path.extname |
 * |---------------------|---------------------------|--------------|
 * | `'.gitignore'`      | `'.gitignore'`（整串）      | `''`         |
 * | `'src.v2/Makefile'` | `'.v2/Makefile'`（目录段的点也命中） | `''`  |
 * | `'a.TS'`            | `'.TS'`（保留大小写）        | `'.TS'`      |
 *
 * 上表前两行的"怪值"在两种实现下**都不命中**扩展名白名单，调用方同走兜底分支
 * （dirty 判定不计入 / ignore 分派退回 union 集合）——返回值虽异、分支不变。真正
 * 会改变调用方分支的是形如 `'.ts'` 的**纯 dotfile 文件名**：本函数返回 `'.ts'`
 * **命中** TSJS 白名单，而 `path.extname('.ts')` 的 dotfile 特判返回 `''` 走兜底。
 * 生产者侧 walkTsJsFiles 对文件不做 dotfile 跳过，名为 `.ts` 的文件会被
 * `endsWith('.ts')` 正常采集——因此"命中"才是与生产者对齐的正确行为，改用
 * `path.extname` 会静默丢失这类文件的 dirty 判定与 TSJS ignore 分派，
 * **禁止替换为 `path.extname`**。
 *
 * 反过来说：通用路径处理场景（取真实文件后缀、生成显示名等）应当直接用
 * `path.extname`，**不要**使用本函数——它的语义是反直觉的，只在需要与采集面
 * `endsWith` 判定对齐时才正确。
 *
 * @param name 文件路径或文件名（相对/绝对均可）；函数不解析路径结构，只做字符串层面
 *   的最后一个 `.` 定位
 * @returns 从最后一个 `.`（含）到末尾的子串；不含 `.` 时返回空字符串 `''`
 */
export function extractExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return '';
  return name.slice(idx);
}
