;; Python 查询规则
;; 用于提取函数定义、类定义、import 语句、装饰器等

;; 顶层函数定义
(function_definition
  name: (identifier) @export.name) @export.function

;; 异步函数定义
(function_definition
  "async" @export.async
  name: (identifier) @export.name) @export.async_function

;; 类定义
(class_definition
  name: (identifier) @export.name
  superclasses: (argument_list)? @export.bases) @export.class

;; import 语句
(import_statement
  name: (dotted_name) @import.module) @import.statement

;; from...import 语句
(import_from_statement
  module_name: (dotted_name)? @import.module
  module_name: (relative_import)? @import.relative
  name: (dotted_name) @import.name) @import.from_statement

;; 装饰器
(decorated_definition
  (decorator) @decorator
  definition: (_) @decorated.definition) @decorated

;; 类型注解
(type
  (identifier) @type.name) @type.annotation
