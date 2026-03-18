;; JavaScript 查询规则
;; 基本与 TypeScript 相同，但不含 interface、type_alias、enum

;; 导出函数声明
(export_statement
  declaration: (function_declaration
    name: (identifier) @export.name) @export.function) @export.statement

;; 导出类声明
(export_statement
  declaration: (class_declaration
    name: (identifier) @export.name) @export.class) @export.statement

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
