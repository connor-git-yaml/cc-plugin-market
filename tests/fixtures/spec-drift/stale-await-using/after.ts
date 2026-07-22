declare function acquire(): { [Symbol.asyncDispose](): PromiseLike<void> };
export await using anchored = acquire();
