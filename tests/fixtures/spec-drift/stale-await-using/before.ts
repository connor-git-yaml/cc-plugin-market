declare function acquire(): { [Symbol.asyncDispose](): PromiseLike<void> };
export using anchored = acquire();
