declare function acquire(): { [Symbol.dispose](): void };
export using anchored = acquire();
