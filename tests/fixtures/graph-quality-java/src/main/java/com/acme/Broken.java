package com.acme;

/**
 * F217 T025 — 语法错误样本文件，供 generic-language-skeleton-collector 单文件解析
 * 失败不影响整体产出的测试断言（EC-14 兜底一致性）。
 */
public class Broken {
    public String valid() {
        return "ok";
    }

    public void broken( {
        // 语法错误：括号未闭合
}
