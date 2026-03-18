package com.example;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 基础 Java 类
 */
public class Basic {
    private String name;
    protected int age;
    public static final String VERSION = "1.0";

    public Basic(String name, int age) {
        this.name = name;
        this.age = age;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    private void helper() {
        // 私有方法
    }
}

interface Processor {
    void process(byte[] data);
    default String getName() {
        return "processor";
    }
}

enum Status {
    ACTIVE,
    INACTIVE,
    PENDING
}
