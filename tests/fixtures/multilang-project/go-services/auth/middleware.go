package auth

func Validate(token string) bool {
	return len(token) > 10
}
