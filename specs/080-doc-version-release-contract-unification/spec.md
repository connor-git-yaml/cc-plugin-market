# Feature Spec: 080-doc-version-release-contract-unification

**Feature Branch**: `080-doc-version-release-contract-unification`  
**Created**: 2026-04-05  
**Status**: Implemented  
**Input**: “统一文档、版本与发布合同；减少多处手工维护，并把 README / plugin metadata / product facts 拉回单链路”

## 用户故事

### US1: 单一 release contract

作为仓库维护者，我希望 reverse-spec 与 spec-driver 的版本、plugin metadata、marketplace entry、README release 文案和产品级 release 文案都由一个显式合同驱动，这样版本 bump 不需要同时手改多处文件。

### US2: 可校验的 release drift

作为提交者，我希望仓库在 pre-commit / 手动校验时能发现 release contract 与 package/plugin/README/current-spec/product-mapping 之间的漂移，这样不会再把版本或描述漂移带进主线。

### US3: 产品事实层同步

作为产品文档维护者，我希望产品级 `current-spec.md` 与 `product-mapping.yaml` 至少保留稳定的“发布版本”与产品描述同步点，这样机器生成产物和人工事实正文不会长期脱节。

## 功能需求

- **FR-001**: 系统 MUST 提供 repo 级 release contract，作为 reverse-spec / spec-driver 发布元数据的 canonical source。
- **FR-002**: 系统 MUST 提供 release sync 脚本，至少同步 `package.json`、`package-lock.json`、两份 `plugin.json`、`.claude-plugin/marketplace.json`、插件 README release 文案、`current-spec.md` release 行和 `product-mapping.yaml` 产品描述。
- **FR-003**: 系统 MUST 提供 release validator，检测 release contract 与上述同步点是否一致。
- **FR-004**: 仓库级 `check-plugin-sync.sh` MUST 接入 release contract 校验。
- **FR-005**: `AGENTS.md` 与 `CLAUDE.md` MUST 通过共享文档片段声明 release contract 的 source-of-truth 与同步命令。
- **FR-006**: 系统 SHOULD 减少 README 中不必要的硬编码版本文本，把版本信息收敛到受控 release 行或可再生成位置。
- **FR-007**: `reverse-spec` 与 `spec-driver` 的产品活文档 MUST 显式包含稳定的 `发布版本` 行。

## 非目标

- 不构建完整发布流水线或 npm 发布自动化
- 不把所有历史 spec 文档中的旧版本号全部批量替换
- 不改变 marketplace 仓库本身的分发模型

## 验收标准

1. 更新 `contracts/release-contract.yaml` 后，运行一次 sync 就能同步所有受控版本/描述目标。
2. 手工制造任一目标文件漂移后，validator 能明确报错。
3. `README.md`、插件 README 与产品级 `current-spec.md` 不再依赖分散的当前版本硬编码。
