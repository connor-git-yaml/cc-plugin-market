from .helpers import validate_token

class AuthService:
    def verify(self, token: str) -> bool:
        return validate_token(token)
