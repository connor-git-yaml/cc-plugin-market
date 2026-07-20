package vendor

// F217 T026 — 内置忽略目录命中样本（vendor/ 在 BUILTIN_IGNORE_DIRS 中），供
// generic-language-skeleton-collector 断言该文件不进入 skeleton map。

func Noop() {}
