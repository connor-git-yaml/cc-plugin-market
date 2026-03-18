package main

import (
	"fmt"
	"os"
)

import "strings"

// Greeter 问候接口
type Greeter interface {
	Greet(name string) string
}

// Config 配置结构体
type Config struct {
	Host    string
	Port    int
	Debug   bool
}

// UserID 类型别名
type UserID = string

// MaxRetries 最大重试次数
const MaxRetries = 3

// Version 版本号
var Version = "1.0.0"

// NewConfig 创建默认配置
func NewConfig() *Config {
	return &Config{
		Host:  "localhost",
		Port:  8080,
		Debug: false,
	}
}

// Process 处理数据并返回结果和错误
func Process(data []byte) ([]byte, error) {
	return data, nil
}

func privateHelper() string {
	return "helper"
}
