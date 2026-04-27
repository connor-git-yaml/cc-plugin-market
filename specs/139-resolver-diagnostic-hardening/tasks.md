# Tasks — 139

## Part A — hint 多 mode
- [x] resolver.mjs hint 检测改用 .filter()+Set 收集所有命中 mode

## Part B — loader-error 拓展
- [x] resolver.mjs 步骤 4 后增加注入路径专用的"非对象返回"判断

## Tests
- [x] T2-X 增强（含"命中 mode: fix"）
- [x] T2-Z 新增（多 mode hint）
- [x] T1-Y 新增（注入返 5 种非对象类型）
- [x] T1-Y-precision 新增（注入返 `{}` 不误伤）

## 验证
- [x] node --test 33/33 通过
- [x] npx vitest run 零失败
- [x] npm run build 零错
- [x] npm run repo:check 全绿
- [ ] Codex 对抗审查
