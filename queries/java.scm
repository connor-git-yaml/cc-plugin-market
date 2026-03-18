;; Java 查询规则
;; 用于提取类声明、接口声明、枚举、record、import 语句等

;; 类声明
(class_declaration
  (modifiers)? @export.modifiers
  name: (identifier) @export.name
  type_parameters: (type_parameters)? @export.type_params
  superclass: (superclass)? @export.extends
  interfaces: (super_interfaces)? @export.implements) @export.class

;; 接口声明
(interface_declaration
  (modifiers)? @export.modifiers
  name: (identifier) @export.name
  type_parameters: (type_parameters)? @export.type_params) @export.interface

;; 枚举声明
(enum_declaration
  (modifiers)? @export.modifiers
  name: (identifier) @export.name) @export.enum

;; record 声明 (Java 16+)
(record_declaration
  (modifiers)? @export.modifiers
  name: (identifier) @export.name) @export.record

;; 方法声明
(method_declaration
  (modifiers)? @member.modifiers
  type: (_) @member.return_type
  name: (identifier) @member.name
  parameters: (formal_parameters) @member.params) @member.method

;; 字段声明
(field_declaration
  (modifiers)? @member.modifiers
  type: (_) @member.type
  declarator: (variable_declarator
    name: (identifier) @member.name)) @member.field

;; 构造器声明
(constructor_declaration
  (modifiers)? @member.modifiers
  name: (identifier) @member.name
  parameters: (formal_parameters) @member.params) @member.constructor

;; import 声明
(import_declaration
  (scoped_identifier) @import.path) @import.statement
