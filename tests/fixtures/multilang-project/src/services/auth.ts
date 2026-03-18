export class AuthService {
  verify(token: string): boolean {
    return token.length > 0;
  }
}
