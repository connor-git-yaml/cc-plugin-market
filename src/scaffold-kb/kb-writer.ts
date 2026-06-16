/**
 * F192 — KB 多文件近似原子落盘（C-5）。build 与 ingest 共用，杜绝部分替换半成品。
 *
 * 先写全部 .tmp；commit 阶段对每个 target 先备份 .bak 再 rename；任一 rename 失败 →
 * 回滚已替换 target（恢复 .bak）+ 清理 .tmp。
 */

import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface KbArtifact {
  name: string;
  data: string | Uint8Array;
}

/** 原子写一组 KB 产物文件到 outputPath（全部成功或全部回滚） */
export function writeKbArtifactsAtomic(outputPath: string, files: KbArtifact[]): void {
  mkdirSync(outputPath, { recursive: true });
  // 唯一后缀降低并发 .tmp/.bak 撞名窗口（W5；完整并发安全需 lock，CLI 层避免同路径并发）
  const uniq = `${process.pid}.${Date.now()}`;
  // 状态机区分 backedUp（target→bak 已做）/ replaced（tmp→target 已做），
  // 使"已备份但 tmp rename 失败"的窗口也能正确回滚（C-3）。
  const state = files.map((f) => ({
    tmp: join(outputPath, `${f.name}.${uniq}.tmp`),
    bak: join(outputPath, `${f.name}.${uniq}.bak`),
    target: join(outputPath, f.name),
    data: f.data,
    backedUp: false,
    replaced: false,
  }));
  try {
    for (const w of state) writeFileSync(w.tmp, w.data);
    for (const w of state) {
      if (existsSync(w.target)) {
        renameSync(w.target, w.bak);
        w.backedUp = true; // 在 tmp→target 之前记录，确保后续失败能恢复
      }
      renameSync(w.tmp, w.target);
      w.replaced = true;
    }
    for (const w of state) if (w.backedUp) rmSync(w.bak, { force: true });
  } catch (err) {
    for (const w of state) {
      if (w.replaced) {
        try {
          rmSync(w.target, { force: true });
        } catch {
          /* ignore */
        }
      }
      if (w.backedUp) {
        try {
          renameSync(w.bak, w.target); // backedUp 即恢复，无论 replaced（C-3 缺口修复）
        } catch {
          /* ignore */
        }
      }
    }
    for (const w of state) {
      try {
        rmSync(w.tmp, { force: true });
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}
