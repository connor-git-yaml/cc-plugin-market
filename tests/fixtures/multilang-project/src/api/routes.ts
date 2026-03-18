import { authMiddleware } from './middleware';

export function setupRoutes() {
  return { middleware: authMiddleware };
}
