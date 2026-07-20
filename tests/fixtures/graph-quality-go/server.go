// Package server —— F217 图质量门 Go mini fixture。
package server

// Server 表示一个最小 HTTP 服务器抽象。
type Server struct {
	addr string
}

// NewServer 是一个包级函数（package 级 func）。
func NewServer(addr string) *Server {
	return &Server{addr: addr}
}

// Start 是 Server 的显式 receiver method。
func (s *Server) Start() error {
	return nil
}

// Stop 是 Server 的另一个显式 receiver method。
func (s *Server) Stop() error {
	return nil
}
