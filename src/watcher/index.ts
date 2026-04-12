/**
 * watcher 模块公开 API 导出
 */
export { FileWatcher, classifyChange, loadIgnorePatterns, CATEGORY_LABEL } from './file-watcher.js';
export type { FileChangeEvent, WatchOptions, ChangeCategory } from './file-watcher.js';
