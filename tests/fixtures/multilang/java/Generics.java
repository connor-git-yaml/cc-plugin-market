package com.example.generics;

import java.util.List;
import java.util.Comparator;

/**
 * 泛型类测试
 */
public class Container<T extends Comparable<T>> {
    private T value;

    public Container(T value) {
        this.value = value;
    }

    public T getValue() {
        return value;
    }

    public <U> Container<U> map(java.util.function.Function<T, U> mapper) {
        return null;
    }
}

interface Repository<T, ID> {
    Optional<T> findById(ID id);
    List<T> findAll();
    T save(T entity);
}
