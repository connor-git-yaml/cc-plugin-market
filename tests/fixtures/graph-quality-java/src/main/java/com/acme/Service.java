package com.acme;

/**
 * F217 图质量门 Java mini fixture — 顶层 class（含 >=2 method）。
 */
public class Service {
    private String name;

    public Service(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
