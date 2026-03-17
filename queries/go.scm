;; Go 查询规则
;; 用于提取函数声明、类型声明、import 语句等

;; 函数声明
(function_declaration
  name: (identifier) @export.name
  parameters: (parameter_list) @export.params
  result: (_)? @export.result) @export.function

;; 方法声明（含 receiver）
(method_declaration
  receiver: (parameter_list) @method.receiver
  name: (field_identifier) @method.name
  parameters: (parameter_list) @method.params
  result: (_)? @method.result) @method.declaration

;; struct 类型声明
(type_declaration
  (type_spec
    name: (type_identifier) @export.name
    type: (struct_type) @export.struct_body)) @export.struct

;; interface 类型声明
(type_declaration
  (type_spec
    name: (type_identifier) @export.name
    type: (interface_type) @export.interface_body)) @export.interface

;; 类型别名
(type_declaration
  (type_spec
    name: (type_identifier) @export.name
    type: (_) @export.alias_type)) @export.type_alias

;; 单行 import
(import_declaration
  (import_spec
    path: (interpreted_string_literal) @import.path)) @import.single

;; 分组 import
(import_declaration
  (import_spec_list
    (import_spec
      path: (interpreted_string_literal) @import.path)*)) @import.group

;; const 声明
(const_declaration
  (const_spec
    name: (identifier) @export.name)) @export.const

;; var 声明
(var_declaration
  (var_spec
    name: (identifier) @export.name)) @export.var
