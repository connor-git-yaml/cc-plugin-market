export function authMiddleware(req: any) {
  return req.headers.authorization;
}
