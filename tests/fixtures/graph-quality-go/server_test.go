package server

// F217 T026 — 测试文件样本，符合 GoLanguageAdapter.getTestPatterns()
// （filePattern: /^.*_test\.go$/，testDirs: []）。

func TestNewServer() bool {
	s := NewServer("localhost:8080")
	return s != nil
}
