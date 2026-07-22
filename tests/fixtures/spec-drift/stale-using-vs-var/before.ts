declare function acquire(): { [Symbol.dispose](): void };
export var anchored = acquire();
