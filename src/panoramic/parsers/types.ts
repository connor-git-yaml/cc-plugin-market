/**
 * 非代码制品解析器输出类型定义 + Zod Schema
 *
 * 三组类型对应三个 Parser：
 * - SkillMdInfo / SkillMdSection: SkillMdParser 的输出
 * - BehaviorInfo / BehaviorState: BehaviorYamlParser 的输出
 * - DockerfileInfo / DockerfileStage / DockerfileInstruction: DockerfileParser 的输出
 *
 * 每个类型均有对应的 Zod Schema，用于运行时验证解析结果的结构正确性。
 */
import { z } from 'zod';

// ============================================================
// SkillMdInfo — SkillMdParser 的输出类型
// ============================================================

/** SKILL.md 的单个二级标题分段 Zod Schema */
export const SkillMdSectionSchema = z.object({
  /** 二级标题文本（不含 ## 前缀） */
  heading: z.string(),
  /** 该标题下的正文内容（保留原始 Markdown 格式） */
  content: z.string(),
});

/** SKILL.md 的单个二级标题分段 */
export type SkillMdSection = z.infer<typeof SkillMdSectionSchema>;

/** SkillMdParser 的解析输出 Zod Schema */
export const SkillMdInfoSchema = z.object({
  /** 名称——从 frontmatter 的 name 字段提取，无 frontmatter 时从一级标题推断 */
  name: z.string(),
  /** 描述——从 frontmatter 的 description 字段提取，缺失时为空字符串 */
  description: z.string(),
  /** 版本号——从 frontmatter 的 version 字段提取，缺失时为 undefined */
  version: z.string().optional(),
  /** 一级标题文本——从 Markdown body 中第一个 # 标题提取 */
  title: z.string(),
  /** 二级标题分段数组——按文件中出现顺序排列 */
  sections: z.array(SkillMdSectionSchema),
});

/** SkillMdParser 的解析输出类型 */
export type SkillMdInfo = z.infer<typeof SkillMdInfoSchema>;

// ============================================================
// BehaviorInfo — BehaviorYamlParser 的输出类型
// ============================================================

/** 单个状态及其关联行为 Zod Schema */
export const BehaviorStateSchema = z.object({
  /** 状态名称——从 YAML key 或 Markdown 标题提取 */
  name: z.string(),
  /** 状态描述——从 YAML value 或 Markdown 段落提取 */
  description: z.string(),
  /** 行为列表——从 YAML 数组或 Markdown 列表项提取 */
  actions: z.array(z.string()),
});

/** 单个状态及其关联行为 */
export type BehaviorState = z.infer<typeof BehaviorStateSchema>;

/** BehaviorYamlParser 的解析输出 Zod Schema */
export const BehaviorInfoSchema = z.object({
  /** 状态-行为映射数组 */
  states: z.array(BehaviorStateSchema),
});

/** BehaviorYamlParser 的解析输出类型 */
export type BehaviorInfo = z.infer<typeof BehaviorInfoSchema>;

// ============================================================
// DockerfileInfo — DockerfileParser 的输出类型
// ============================================================

/** Dockerfile 的单条指令 Zod Schema */
export const DockerfileInstructionSchema = z.object({
  /** 指令类型（大写，如 RUN、COPY、ENV） */
  type: z.string(),
  /** 指令参数（已拼接多行续行） */
  args: z.string(),
});

/** Dockerfile 的单条指令 */
export type DockerfileInstruction = z.infer<typeof DockerfileInstructionSchema>;

/** Dockerfile 的单个构建阶段 Zod Schema */
export const DockerfileStageSchema = z.object({
  /** 基础镜像——FROM 指令的镜像名称（含 tag） */
  baseImage: z.string(),
  /** 阶段别名——FROM image AS alias 中的 alias，无则为 undefined */
  alias: z.string().optional(),
  /** 该阶段的指令列表（不含 FROM 本身，按出现顺序排列） */
  instructions: z.array(DockerfileInstructionSchema),
});

/** Dockerfile 的单个构建阶段 */
export type DockerfileStage = z.infer<typeof DockerfileStageSchema>;

/** DockerfileParser 的解析输出 Zod Schema */
export const DockerfileInfoSchema = z.object({
  /** 构建阶段数组——按 FROM 出现顺序排列 */
  stages: z.array(DockerfileStageSchema),
});

/** DockerfileParser 的解析输出类型 */
export type DockerfileInfo = z.infer<typeof DockerfileInfoSchema>;
