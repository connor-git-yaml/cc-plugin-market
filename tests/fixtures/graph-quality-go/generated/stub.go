package generated

// fixture 内 .gitignore:1 `generated/` 规则命中样本，供
// generic-language-skeleton-collector 断言该文件不进入 skeleton map。
// 本文件被该规则命中但须以 `git add -f` 维持 tracked——样本缺失时对应
// 负向断言会空洞通过（F253）。

func Noop() string {
	return "stub"
}
