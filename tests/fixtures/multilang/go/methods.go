package server

import "net/http"

// Server HTTP 服务器
type Server struct {
	addr    string
	handler http.Handler
}

// NewServer 创建服务器
func NewServer(addr string) *Server {
	return &Server{addr: addr}
}

// Start 启动服务器
func (s *Server) Start() error {
	return http.ListenAndServe(s.addr, s.handler)
}

// Stop 停止服务器
func (s *Server) Stop() error {
	return nil
}

// GetAddr 获取地址（值接收者）
func (s Server) GetAddr() string {
	return s.addr
}

// SetHandler 设置处理器
func (s *Server) SetHandler(h http.Handler) {
	s.handler = h
}
