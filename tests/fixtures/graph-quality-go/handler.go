package server

// Handler 是一个顶层 interface。
type Handler interface {
	Handle(req string) string
}

// HandlerFunc 是一个顶层 type alias（函数类型）。
type HandlerFunc func(req string) string
