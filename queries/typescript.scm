;; TypeScript 查询规则
;; 用于提取导出声明、类定义、接口、类型别名、import 语句等

;; 导出函数声明
(export_statement
  declaration: (function_declaration
    name: (identifier) @export.name) @export.function) @export.statement

;; 导出类声明
(export_statement
  declaration: (class_declaration
    name: (type_identifier) @export.name) @export.class) @export.statement

;; 导出接口声明
(export_statement
  declaration: (interface_declaration
    name: (type_identifier) @export.name) @export.interface) @export.statement

;; 导出类型别名
(export_statement
  declaration: (type_alias_declaration
    name: (type_identifier) @export.name) @export.type) @export.statement

;; 导出枚举
(export_statement
  declaration: (enum_declaration
    name: (identifier) @export.name) @export.enum) @export.statement

;; 导出 const/let 变量
(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @export.name))) @export.variable

;; export default
(export_statement
  "default" @export.default) @export.default_statement

;; re-export
(export_statement
  source: (string) @export.source) @export.reexport

;; import 语句
(import_statement
  source: (string) @import.source) @import.statement

;; import type
(import_statement
  "type" @import.type_only
  source: (string) @import.source) @import.type_statement
