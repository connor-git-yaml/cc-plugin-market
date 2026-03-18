package visibility

// PublicFunc 公开函数
func PublicFunc() string {
	return "public"
}

// PublicStruct 公开结构体
type PublicStruct struct {
	PublicField  string
	privateField int
}

func privateFunc() string {
	return "private"
}

type privateStruct struct {
	field string
}
