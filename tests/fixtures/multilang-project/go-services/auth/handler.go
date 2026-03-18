package auth

import "./middleware"

func HandleAuth(token string) bool {
	return middleware.Validate(token)
}
