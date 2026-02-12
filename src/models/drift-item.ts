/**
 * DriftItem 和 DriftSummary 的 Zod Schema 定义
 * 漂移检测差异项与汇总统计
 */
import { z } from 'zod';

// --- 枚举 ---

export const SeveritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Severity = z.infer<typeof SeveritySchema>;

export const DriftCategorySchema = z.enum(['Interface', 'Behavior', 'Constraint']);
export type DriftCategory = z.infer<typeof DriftCategorySchema>;

export const ChangeTypeSchema = z.enum(['addition', 'removal', 'modification']);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const DetectedBySchema = z.enum(['structural', 'semantic']);
export type DetectedBy = z.infer<typeof DetectedBySchema>;

// --- 主实体 ---

/** 单个漂移差异项 */
export const DriftItemSchema = z.object({
  id: z.string().min(1),
  severity: SeveritySchema,
  category: DriftCategorySchema,
  changeType: ChangeTypeSchema,
  location: z.string().min(1),
  symbolName: z.string().nullable().optional(),
  description: z.string().min(1),
  oldValue: z.string().nullable().optional(),
  newValue: z.string().nullable().optional(),
  proposedUpdate: z.string().min(1),
  detectedBy: DetectedBySchema,
}).refine(
  // oldValue 和 newValue 不可同时为 null/undefined
  (data) => data.oldValue != null || data.newValue != null,
  { message: 'oldValue 和 newValue 不可同时为空' },
);
export type DriftItem = z.infer<typeof DriftItemSchema>;

/** 漂移汇总统计 */
export const DriftSummarySchema = z.object({
  totalChanges: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  removals: z.number().int().nonnegative(),
  modifications: z.number().int().nonnegative(),
});
export type DriftSummary = z.infer<typeof DriftSummarySchema>;
