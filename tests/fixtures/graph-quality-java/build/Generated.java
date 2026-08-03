package build;

// 内置忽略目录命中样本（build/ 在 JavaLanguageAdapter.defaultIgnoreDirs
// 中，walkFiles 目录级剪枝直接跳过），与仓库根 .gitignore:7 `build/` 规则无关
// （ignore oracle 的 gitignoreCheck 只读 fixture 自身 .gitignore，不读根
// .gitignore）。本文件被根 .gitignore 规则命中但须以 `git add -f` 维持
// tracked——样本缺失时对应负向断言会空洞通过（F253）。

/**
 * F217 图质量门 Java mini fixture — 内置忽略目录样本（含可提取方法）。
 */
public class Generated {
    public String noop() {
        return "generated";
    }
}
