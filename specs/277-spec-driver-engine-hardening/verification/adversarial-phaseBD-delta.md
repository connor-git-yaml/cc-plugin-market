# Phase B + D 对抗修订 delta 复验

- 复验对象：commit ② 前，针对 `adversarial-phaseBD-epsilon.md`（ε-C1 / ε-C2）与 `adversarial-phaseBD-gamma.md`（γ-C1 / γ-C2 / γ-C3）五条 CRITICAL 的修订
- 修法依据：`verification/fix-phaseBD-brief.md`（编排器拍板）
- 基线 commit：`4255212c`
- 复验模式：只读 + 微探针（未跑 `repo:check` / `vitest` / `test:plugins`，编排器后台占用）
- 判定档位：实质已修 / 仅措辞变动 / 未修

## 复验表

| ID | 判定 | 依据 |
|----|------|------|
| ε-C1 | 实质已修 | `adversarial-phaseBD-delta-a.md`（步骤 8 经合并律路由；N-1 交叉引用同批补） |
| ε-C2 | 实质已修 | `adversarial-phaseBD-delta-a.md`（既有词表 → 态映射表） |
| γ-C1 | 实质已修 | `adversarial-phaseBD-delta-b.md`（块 5 三段接线；R-1 / R-2 残留同批补） |
| γ-C2 | 实质已修 | `adversarial-phaseBD-delta-b.md`（白名单 4 → 7，语义条改「逻辑，不论载体」；缺口 6 条同批补齐至 13） |
| γ-C3 | 实质已修 | `adversarial-phaseBD-delta-a.md`（「类别存疑」第 9 取值 + spec-review 抽检；N-2「制品」界定同批补） |

## 修复新引入的缺陷

- delta-A：N-1（W）步骤 8 首行缺 smoke 例外交叉引用；N-2（W）「制品」未界定可自指；N-3（I）。
- delta-B：R-1（W）三份 SKILL 旧三步块并存旧模板；R-2（W）四份装配行未列冻结值；白名单缺口 6 条。
- **处置**：N-1 / N-2 / R-1 / R-2 / 白名单 6 条全部同批修（spec 修订记录 31–35）；N-3 登记不修。

## 结论

两路复验一致：5 ÷ 5 CRITICAL 实质已修，建议「可提交，先做小修」——小修已全部落地并再生。分拆为两路（delta-a 三条 / delta-b 两条）是为了避开单路复验子代理的 600 s 停摆，两路各自独立读盘、未共享结论。
