export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export interface GenericService<T extends Record<string, unknown>> {
  get(id: string): Promise<T | null>;
  list(filter?: Partial<T>): Promise<T[]>;
  create(data: Omit<T, 'id'>): Promise<T>;
}

export abstract class BaseRepository<T, ID = string> {
  abstract findById(id: ID): Promise<T | null>;
  abstract save(entity: T): Promise<T>;

  async findOrThrow(id: ID): Promise<T> {
    const entity = await this.findById(id);
    if (!entity) throw new Error('Not found');
    return entity;
  }
}

export const createHandler = <T>(fn: (req: Request) => Promise<T>): Handler<T> => {
  return { handle: fn };
};

interface Handler<T> {
  handle: (req: Request) => Promise<T>;
}
