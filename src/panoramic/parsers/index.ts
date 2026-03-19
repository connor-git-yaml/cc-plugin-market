/**
 * 非代码制品解析器模块 — 统一导出
 *
 * 导出内容：
 * - 全部输出类型和 Zod Schema（types.ts）
 * - AbstractArtifactParser 抽象基类
 * - AbstractConfigParser 配置解析器抽象基类
 * - CommentTracker 注释累积跟踪器
 * - SkillMdParser / BehaviorYamlParser / DockerfileParser 具体实现
 * - YamlConfigParser / EnvConfigParser / TomlConfigParser 配置解析器
 * - inferType / stripQuotes 辅助函数
 */

// 类型和 Schema
export type {
  SkillMdSection,
  SkillMdInfo,
  BehaviorState,
  BehaviorInfo,
  DockerfileInstruction,
  DockerfileStage,
  DockerfileInfo,
  ConfigEntry,
  ConfigEntries,
  ConfigValueType,
} from './types.js';

export {
  SkillMdSectionSchema,
  SkillMdInfoSchema,
  BehaviorStateSchema,
  BehaviorInfoSchema,
  DockerfileInstructionSchema,
  DockerfileStageSchema,
  DockerfileInfoSchema,
  ConfigEntrySchema,
  ConfigEntriesSchema,
  inferType,
  stripQuotes,
} from './types.js';

// 抽象基类
export { AbstractArtifactParser } from './abstract-artifact-parser.js';
export { AbstractConfigParser } from './abstract-config-parser.js';
export { CommentTracker } from './comment-tracker.js';

// 具体 Parser 实现
export { SkillMdParser } from './skill-md-parser.js';
export { BehaviorYamlParser } from './behavior-yaml-parser.js';
export { DockerfileParser } from './dockerfile-parser.js';

// 配置文件 Parser 实现
export type { YamlScalar, YamlValue, YamlObject, YamlArray } from './yaml-config-parser.js';
export { YamlConfigParser, parseYamlContent, parseYamlDocument } from './yaml-config-parser.js';
export { EnvConfigParser, parseEnvContent } from './env-config-parser.js';
export { TomlConfigParser, parseTomlContent } from './toml-config-parser.js';
