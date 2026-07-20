package server

// F217 T026 — 语法错误样本文件，供 generic-language-skeleton-collector 单文件
// 解析失败不影响整体产出的测试断言（EC-14 兜底一致性）。

func ValidFunc() string {
	return "ok"
}

func BrokenFunc( {
	// 语法错误：括号未闭合
