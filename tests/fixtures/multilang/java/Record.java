package com.example.records;

import java.time.LocalDate;

/**
 * Java 16+ Record 类型测试
 */
public record Point(int x, int y) {
    public double distance(Point other) {
        return Math.sqrt(Math.pow(x - other.x, 2) + Math.pow(y - other.y, 2));
    }
}

record Person(String name, LocalDate birthDate) {}
