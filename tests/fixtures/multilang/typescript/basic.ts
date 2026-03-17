import { readFile } from 'fs/promises';
import type { Buffer } from 'buffer';
import path from 'path';

export function greet(name: string): string {
  return `Hello, ${name}`;
}

export async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}

export class UserService {
  private users: Map<string, User> = new Map();

  constructor(private readonly db: Database) {}

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  static create(db: Database): UserService {
    return new UserService(db);
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export type UserID = string;

export enum Role {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}

export const MAX_RETRIES = 3;
export let mutableConfig = { debug: false };

export default function main(): void {
  console.log('main');
}

interface Database {
  query(sql: string): Promise<any>;
}
