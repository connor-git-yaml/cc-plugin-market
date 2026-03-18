/**
 * 语言分组器
 * 按语言对文件列表进行分组，支持可选的语言过滤（Feature 031）
 */
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';

// ============================================================
// 类型定义
// ============================================================

/** 按语言分组后的文件集合 */
export interface LanguageGroup {
  /** 语言标识（即 adapter.id） */
  adapterId: string;
  /** 语言显示名称 */
  languageName: string;
  /** 该语言的文件路径列表（相对于项目根目录） */
  files: string[];
}

/** 语言分组结果 */
export interface LanguageGroupResult {
  /** 语言分组列表 */
  groups: LanguageGroup[];
  /** 警告信息（如指定的过滤语言不存在） */
  warnings: string[];
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 按语言对文件列表进行分组
 *
 * 遍历文件列表，通过 LanguageAdapterRegistry.getAdapter() 按语言分组。
 * 未注册扩展名的文件被忽略不纳入任何分组。
 *
 * @param files - scanFiles() 返回的文件路径列表
 * @param filterLanguages - 可选的语言过滤列表（adapter.id 或语言名称）
 * @returns 分组结果和警告信息
 */
export function groupFilesByLanguage(
  files: string[],
  filterLanguages?: string[],
): LanguageGroupResult {
  const registry = LanguageAdapterRegistry.getInstance();
  const warnings: string[] = [];

  // 步骤 1：按语言分组
  const groupMap = new Map<string, LanguageGroup>();

  for (const file of files) {
    const adapter = registry.getAdapter(file);
    if (!adapter) continue;

    if (!groupMap.has(adapter.id)) {
      groupMap.set(adapter.id, {
        adapterId: adapter.id,
        languageName: adapter.languages[0] ?? adapter.id,
        files: [],
      });
    }
    groupMap.get(adapter.id)!.files.push(file);
  }

  let groups = Array.from(groupMap.values());

  // 步骤 2：应用语言过滤
  if (filterLanguages && filterLanguages.length > 0) {
    // 构建已知适配器 ID 集合（用于匹配 filter 参数）
    const adapterIdSet = new Set(groups.map((g) => g.adapterId));

    // 解析 filterLanguages 到 adapter.id
    const allowedIds = new Set<string>();
    for (const lang of filterLanguages) {
      // 直接匹配 adapter.id
      if (adapterIdSet.has(lang)) {
        allowedIds.add(lang);
        continue;
      }

      // 尝试通过语言名称匹配
      let found = false;
      for (const group of groups) {
        if (group.languageName === lang) {
          allowedIds.add(group.adapterId);
          found = true;
          break;
        }
      }

      if (!found) {
        warnings.push(`指定的语言 '${lang}' 在项目中不存在`);
      }
    }

    groups = groups.filter((g) => allowedIds.has(g.adapterId));
  }

  return { groups, warnings };
}
