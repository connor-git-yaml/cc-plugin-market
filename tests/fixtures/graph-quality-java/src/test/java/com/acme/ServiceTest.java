package com.acme;

/**
 * F217 T025 — 测试文件样本，符合 JavaLanguageAdapter.getTestPatterns()
 * （filePattern: /^(.*Test|Test.*|.*Tests|.*IT)\.java$/，testDirs: ['src/test/java']）。
 */
public class ServiceTest {
    public void testGetName() {
        Service service = new Service("demo");
        assert service.getName().equals("demo");
    }
}
