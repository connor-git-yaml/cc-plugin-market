/**
 * ADR Migration (Feature 140 T43)
 *
 * 实现 spec FR-006 — 旧版 ADR 在 v4.1.0 升级时自动追加 supersede notice。
 *
 * **关键不变量（修复 Codex review finding 1 — high-severity 谓词逻辑 bug）**：
 * legacy 判定谓词必须用 AND，且**排除当前批次产物**：
 *
 *     旧 ADR := frontmatter.generatedByModel 缺失
 *           AND frontmatter.status !== 'superseded'
 *           AND 文件路径 NOT IN currentBatchAdrPaths
 *
 * **禁止用 OR 连接**：OR 会让新生成的 proposed/accepted 状态 ADR 也被误判
 * 为旧 ADR 立即 supersede 自己，是已识别的高危逻辑 bug。
 *
 * 处理：
 *  - 满足全部条件 → frontmatter.status 改为 'superseded' + 追加 supersededAt: '4.1.0'
 *  - 不删除文件（保留供历史参考）
 *  - 不修改文件正文（只动 frontmatter）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('adr-migration');

// ============================================================
// 常量
// ============================================================

/** spec FR-006 锁定：supersedeAt 字段值（与本 Feature 的 targetVersion 对齐）*/
const SUPERSEDE_VERSION = '4.1.0';

/** 简单 YAML frontmatter 块匹配正则（不依赖 yaml lib，零依赖原则）*/
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

// ============================================================
// 类型定义
// ============================================================

export interface MigrateOldAdrsResult {
  /** 检查到的总 .md 文件数（含跳过的）*/
  totalFiles: number;
  /** 实际被 supersede 的文件数 */
  superseded: number;
  /** 已经是 superseded 状态、跳过的文件数 */
  alreadySuperseded: number;
  /** 当前批次产物（在 currentBatchAdrPaths 中）跳过的文件数 */
  skippedCurrentBatch: number;
  /** 含 generatedByModel 字段、跳过的文件数（已是 v4.1+ 产物）*/
  skippedNewFormat: number;
  /** 因解析失败跳过的文件数（不报错，仅 warn）*/
  skippedParseError: number;
  /** 实际改写的文件路径列表 */
  supersededFiles: string[];
}

// ============================================================
// 主入口
// ============================================================

/**
 * 扫描 adrDir 下的旧版 ADR 并追加 supersede notice。
 *
 * @param adrDir ADR 目录绝对路径（通常 `<outputDir>/docs/adr`）
 * @param currentBatchAdrPaths 当前批次新生成的 ADR 文件**绝对路径**集合
 *                             （用于排除新产物，绝不能 supersede 它们）
 * @returns 处理统计 + 改写的文件路径列表
 */
export function migrateOldAdrs(
  adrDir: string,
  currentBatchAdrPaths: Set<string>,
): MigrateOldAdrsResult {
  const result: MigrateOldAdrsResult = {
    totalFiles: 0,
    superseded: 0,
    alreadySuperseded: 0,
    skippedCurrentBatch: 0,
    skippedNewFormat: 0,
    skippedParseError: 0,
    supersededFiles: [],
  };

  if (!fs.existsSync(adrDir)) {
    return result;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(adrDir, { withFileTypes: true });
  } catch (err) {
    logger.warn(`migrateOldAdrs 无法读取 ${adrDir}: ${String(err)}`);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    // index.md / _PIPELINE_DISABLED.md / _PIPELINE_FAILED.md 等 meta 文件跳过
    if (entry.name === 'index.md' || entry.name.startsWith('_')) continue;

    result.totalFiles++;
    const filePath = path.join(adrDir, entry.name);

    // 关键守卫 1：当前批次产物不进入 supersede 流程
    if (currentBatchAdrPaths.has(filePath)) {
      result.skippedCurrentBatch++;
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      result.skippedParseError++;
      logger.warn(`migrateOldAdrs 无法读取 ADR ${filePath}: ${String(err)}`);
      continue;
    }

    const frontmatterMatch = FRONTMATTER_REGEX.exec(content);
    if (!frontmatterMatch) {
      // 文件没有 frontmatter（不是 ADR 格式）— 视为 parse error 跳过
      result.skippedParseError++;
      continue;
    }

    const frontmatterText = frontmatterMatch[1]!;
    const fields = parseSimpleYamlFields(frontmatterText);

    // 关键守卫 2：已是 superseded 状态 → 不重复处理
    if (fields.status === 'superseded') {
      result.alreadySuperseded++;
      continue;
    }

    // 关键守卫 3：已经是 v4.1+ 新格式（含 generatedByModel）→ 不视为旧 ADR
    if (fields.generatedByModel !== undefined) {
      result.skippedNewFormat++;
      continue;
    }

    // 满足全部 AND 条件 → 改写 frontmatter 追加 status=superseded + supersededAt
    const updatedContent = supersedeFrontmatter(content, frontmatterText, frontmatterMatch[0]!);
    try {
      fs.writeFileSync(filePath, updatedContent, 'utf-8');
      result.superseded++;
      result.supersededFiles.push(filePath);
    } catch (err) {
      result.skippedParseError++;
      logger.warn(`migrateOldAdrs 写入失败 ${filePath}: ${String(err)}`);
    }
  }

  if (result.superseded > 0) {
    logger.info(
      `migrateOldAdrs: ${result.superseded}/${result.totalFiles} 个旧 ADR 已追加 supersededAt: ${SUPERSEDE_VERSION}`,
    );
  }
  return result;
}

// ============================================================
// frontmatter 改写助手
// ============================================================

/**
 * 解析简单 YAML frontmatter（支持 `key: value` 单行格式 + 嵌套对象的字符串检测）。
 * 不实现完整 YAML — 只识别 status / supersededAt / generatedByModel 三个 key。
 */
function parseSimpleYamlFields(text: string): {
  status?: string;
  supersededAt?: string;
  generatedByModel?: string;
} {
  const result: { status?: string; supersededAt?: string; generatedByModel?: string } = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const statusMatch = /^status\s*:\s*(.+?)\s*$/.exec(trimmed);
    if (statusMatch) {
      result.status = statusMatch[1]!.replace(/^['"]|['"]$/g, '').trim();
      continue;
    }
    const supersededMatch = /^supersededAt\s*:\s*(.+?)\s*$/.exec(trimmed);
    if (supersededMatch) {
      result.supersededAt = supersededMatch[1]!.replace(/^['"]|['"]$/g, '').trim();
      continue;
    }
  }

  // 修复 Codex W-4 — 严格验证 generatedByModel 值结构（不只是 key 存在）：
  //  接受合规结构（视为新格式跳过 supersede）：
  //   (1) 多行 YAML block scalar：`generatedByModel:` 后跟 `map:` 和 `reduce:` 子字段
  //   (2) 单行内联对象：含 `map` / `reduce` 关键字段
  //  拒绝（视为缺失，继续 supersede legacy）：
  //   (1) `generatedByModel:` 空值（无后续 map/reduce 子字段）
  //   (2) `generatedByModel: ""` / `generatedByModel: {}` 空对象 / 损坏字段
  if (/^\s*generatedByModel\s*:/m.test(text)) {
    // 找 generatedByModel: 后的所有内容（直到下一个顶层 key 或 frontmatter 结尾）
    const lines = text.split(/\r?\n/);
    let inBlock = false;
    let blockContent = '';
    for (const line of lines) {
      if (/^\s*generatedByModel\s*:/.test(line)) {
        inBlock = true;
        blockContent += line + '\n';
        continue;
      }
      if (inBlock) {
        // 遇到下一个顶层字段（行首非空白）→ 结束 block
        if (/^\S/.test(line)) {
          break;
        }
        blockContent += line + '\n';
      }
    }
    // 必须同时含有 map 和 reduce 子字段
    const hasMap = /\bmap\s*:/i.test(blockContent);
    const hasReduce = /\breduce\s*:/i.test(blockContent);
    if (hasMap && hasReduce) {
      result.generatedByModel = blockContent;
    }
    // 其他情况 → 不设值（被视为缺失字段，触发 legacy supersede）
  }
  return result;
}

/**
 * 在既有 frontmatter 中追加 status=superseded + supersededAt 字段。
 * 如果已有 status 字段（非 superseded 值），原地替换；否则追加到末尾。
 */
function supersedeFrontmatter(
  fullContent: string,
  frontmatterText: string,
  fullMatch: string,
): string {
  let updated = frontmatterText;

  // 替换或追加 status
  if (/^status\s*:/m.test(updated)) {
    updated = updated.replace(/^status\s*:.*$/m, 'status: superseded');
  } else {
    updated += '\nstatus: superseded';
  }

  // 替换或追加 supersededAt
  if (/^supersededAt\s*:/m.test(updated)) {
    updated = updated.replace(/^supersededAt\s*:.*$/m, `supersededAt: "${SUPERSEDE_VERSION}"`);
  } else {
    updated += `\nsupersededAt: "${SUPERSEDE_VERSION}"`;
  }

  // 重组：保留原 trailing newline 行为
  const newFrontmatterBlock = `---\n${updated}\n---\n`;
  return fullContent.replace(fullMatch, newFrontmatterBlock);
}
