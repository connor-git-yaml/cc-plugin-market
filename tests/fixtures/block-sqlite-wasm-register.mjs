/**
 * 经 node --import 预加载：把上面的 resolve hook 注册进模块解析链。
 * 用法：node --import ./tests/fixtures/block-sqlite-wasm-register.mjs dist/cli/index.js <args>
 */
import { register } from 'node:module';
register('./block-sqlite-wasm-hook.mjs', import.meta.url);
