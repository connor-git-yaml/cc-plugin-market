# Implementation Plan

1. 为 reverse-spec 新增 source-of-truth 合同，定义 canonical source、compatibility mirrors 与 metadata 同步边界
2. 将 `src/installer/skill-templates.ts` 改为从 `plugins/reverse-spec/skills/**` 直接加载 Skill 内容
3. 新增 mirror sync 脚本与 validator，确保 `src/skills-global/**`、`skills/**` 与 canonical source 可再生成且可校验
4. 将 validator 接入 `package.json` 与 `scripts/check-plugin-sync.sh`
5. 同步 README / plugin README / AGENTS 与 reverse-spec 产品事实层
6. 重生成 compatibility mirrors 与 reverse-spec 产品级 `_generated` 产物
7. 运行验证并回填 verification report
