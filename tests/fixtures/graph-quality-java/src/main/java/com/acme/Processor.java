package com.acme;

/**
 * F217 图质量门 Java mini fixture — 顶层 interface。
 */
public interface Processor {
    void process(byte[] data);

    default String getLabel() {
        return "processor";
    }
}
