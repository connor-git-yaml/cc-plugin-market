/**
 * 示例模块：用户认证服务
 * 用于 Golden Master 测试的固定输入
 */

/** 用户角色枚举 */
export enum UserRole {
  Admin = 'admin',
  Editor = 'editor',
  Viewer = 'viewer',
}

/** 用户数据接口 */
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  lastLogin: Date | null;
}

/** 认证令牌接口 */
export interface AuthToken {
  token: string;
  expiresAt: Date;
  userId: string;
  refreshToken: string;
}

/** 认证配置 */
export interface AuthConfig {
  /** 令牌过期时间（秒） */
  tokenTTL: number;
  /** 刷新令牌过期时间（秒） */
  refreshTTL: number;
  /** 最大登录尝试次数 */
  maxAttempts: number;
  /** 锁定时间（分钟） */
  lockoutMinutes: number;
}

/** 登录请求参数 */
export interface LoginRequest {
  email: string;
  password: string;
}

/** 登录响应 */
export interface LoginResponse {
  success: boolean;
  token?: AuthToken;
  error?: string;
}

import { createHash } from 'node:crypto';

// 默认配置
const DEFAULT_CONFIG: AuthConfig = {
  tokenTTL: 3600,
  refreshTTL: 86400,
  maxAttempts: 5,
  lockoutMinutes: 30,
};

// 内存存储（简化版）
const users = new Map<string, User & { passwordHash: string }>();
const loginAttempts = new Map<string, { count: number; lastAttempt: Date }>();

/**
 * 密码哈希
 * @param password - 明文密码
 * @returns SHA-256 哈希
 */
export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

/**
 * 注册新用户
 * @param name - 用户名
 * @param email - 邮箱
 * @param password - 密码
 * @param role - 角色，默认 Viewer
 * @returns 创建的用户（不含密码）
 * @throws 如果邮箱已注册
 */
export function registerUser(
  name: string,
  email: string,
  password: string,
  role: UserRole = UserRole.Viewer,
): User {
  // 检查重复
  for (const [, u] of users) {
    if (u.email === email) {
      throw new Error(`邮箱 ${email} 已注册`);
    }
  }

  const id = createHash('md5').update(email).digest('hex');
  const user: User & { passwordHash: string } = {
    id,
    name,
    email,
    role,
    createdAt: new Date(),
    lastLogin: null,
    passwordHash: hashPassword(password),
  };

  users.set(id, user);

  const { passwordHash: _, ...safeUser } = user;
  return safeUser;
}

/**
 * 用户登录
 * @param request - 登录请求
 * @param config - 认证配置
 * @returns 登录响应
 */
export function login(
  request: LoginRequest,
  config: AuthConfig = DEFAULT_CONFIG,
): LoginResponse {
  const { email, password } = request;

  // 检查锁定
  const attempts = loginAttempts.get(email);
  if (attempts && attempts.count >= config.maxAttempts) {
    const lockoutEnd = new Date(
      attempts.lastAttempt.getTime() + config.lockoutMinutes * 60 * 1000,
    );
    if (new Date() < lockoutEnd) {
      return { success: false, error: '账户已锁定，请稍后再试' };
    }
    // 锁定已过期，重置
    loginAttempts.delete(email);
  }

  // 查找用户
  let foundUser: (User & { passwordHash: string }) | undefined;
  for (const [, u] of users) {
    if (u.email === email) {
      foundUser = u;
      break;
    }
  }

  if (!foundUser) {
    recordFailedAttempt(email);
    return { success: false, error: '邮箱或密码错误' };
  }

  // 验证密码
  if (foundUser.passwordHash !== hashPassword(password)) {
    recordFailedAttempt(email);
    return { success: false, error: '邮箱或密码错误' };
  }

  // 成功 — 清除失败记录
  loginAttempts.delete(email);
  foundUser.lastLogin = new Date();

  // 生成令牌
  const token: AuthToken = {
    token: createHash('sha256')
      .update(`${foundUser.id}-${Date.now()}`)
      .digest('hex'),
    expiresAt: new Date(Date.now() + config.tokenTTL * 1000),
    userId: foundUser.id,
    refreshToken: createHash('sha256')
      .update(`refresh-${foundUser.id}-${Date.now()}`)
      .digest('hex'),
  };

  return { success: true, token };
}

/**
 * 验证令牌是否有效
 * @param token - 认证令牌
 * @returns 是否有效
 */
export function validateToken(token: AuthToken): boolean {
  return new Date() < token.expiresAt;
}

/**
 * 检查用户权限
 * @param user - 用户
 * @param requiredRole - 所需角色
 * @returns 是否具备权限
 */
export function hasPermission(user: User, requiredRole: UserRole): boolean {
  const hierarchy: Record<UserRole, number> = {
    [UserRole.Viewer]: 0,
    [UserRole.Editor]: 1,
    [UserRole.Admin]: 2,
  };
  return hierarchy[user.role] >= hierarchy[requiredRole];
}

// 内部辅助函数
function recordFailedAttempt(email: string): void {
  const current = loginAttempts.get(email);
  if (current) {
    current.count++;
    current.lastAttempt = new Date();
  } else {
    loginAttempts.set(email, { count: 1, lastAttempt: new Date() });
  }
}
