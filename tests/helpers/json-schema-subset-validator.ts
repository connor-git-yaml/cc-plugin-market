/**
 * 手写的 **JSON Schema 子集**递归校验器（F249 T029）。
 *
 * 为什么不引入 `ajv`：本仓库的零新增依赖约束（Constitution VIII / plan Technical Context）。
 * 为什么必须递归而非"顶层 key 集合子集判断"：`graph-quality-report.schema.json` 把
 * `additionalProperties: false` 挂在**每一层**对象上，`staleReasons` 这类新增字段的契约风险
 * 恰恰发生在嵌套的 `$defs.GraphFreshnessVerdict` 里——只比顶层 key 集合的话，"新增字段没登记
 * 进 schema"这个本需求最核心的风险点根本检测不到。
 *
 * 支持的关键字（恰好覆盖该 schema 实际用到的集合，不多做）：
 * `$ref`（仅本地 `#/$defs/X`）/ `type`（含联合数组、`integer` 与 `number` 的区分）/ `enum` /
 * `properties` / `required` / `additionalProperties: false` / `items` / `minimum` / `maximum`。
 *
 * 显式不支持（该 schema 未使用，遇到即忽略）：`format`、`oneOf`/`anyOf`/`allOf`、
 * `patternProperties`、远程 `$ref`、`additionalProperties` 为 schema 对象的形态。
 * **遇到不认识的关键字不会静默放行结构错误**——不认识的只是"不额外施加约束"，已支持的关键字
 * 仍逐层强制。
 */

/** 一条校验失败：`path` 为 JSON Pointer 风格的定位串，便于失败输出直接指出出错字段。 */
export interface SchemaViolation {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: SchemaViolation[];
}

type JsonSchema = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * own property 判定（W-006）：一律用它，**不用** `key in obj`。
 *
 * `in` 会命中原型链，于是 `Object.prototype` 上的名字（`constructor`/`toString`/`valueOf`/
 * `hasOwnProperty`…）在任何字面量对象上都"存在"。后果有两个方向且都是假绿：
 * ① `additionalProperties: false` 检查里 `key in properties` 会把实例上名为 `constructor`
 *    的**未登记字段**判成"已登记"，直接放过契约违规；
 * ② `required` 检查里 `key in value` 会把名为 `toString` 的**缺失必填字段**判成"存在"。
 */
function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** 解析本地 `$ref`（形如 `#/$defs/GraphFreshnessVerdict`）；无法解析即抛错（schema 自身有问题）。 */
function resolveRef(root: JsonSchema, ref: string): JsonSchema {
  if (!ref.startsWith('#/')) {
    throw new Error(`不支持的 $ref（仅支持本地引用）: ${ref}`);
  }
  const segments = ref.slice(2).split('/');
  let current: unknown = root;
  for (const segment of segments) {
    if (!isPlainObject(current)) {
      throw new Error(`$ref 解析失败（中途遇到非对象）: ${ref}`);
    }
    current = current[segment];
  }
  if (!isPlainObject(current)) {
    throw new Error(`$ref 指向的目标不是 schema 对象: ${ref}`);
  }
  return current;
}

/** JSON 实例的类型名（对齐 JSON Schema 的 `type` 取值，`integer` 由调用方额外判定）。 */
function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === 'integer') {
    return typeof value === 'number' && Number.isInteger(value);
  }
  if (expected === 'number') {
    return typeof value === 'number';
  }
  return jsonTypeOf(value) === expected;
}

/**
 * 按 schema 递归校验 value。
 *
 * @param value 待校验实例
 * @param schema 该层的 schema 节点
 * @param root 根 schema（供 `$ref` 解析）
 * @param path 当前实例路径（错误定位用）
 */
function validateNode(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  violations: SchemaViolation[],
): void {
  if (typeof schema['$ref'] === 'string') {
    validateNode(value, resolveRef(root, schema['$ref']), root, path, violations);
    return;
  }

  // ── type ──
  const expectedType = schema['type'];
  if (typeof expectedType === 'string') {
    if (!matchesType(value, expectedType)) {
      violations.push({ path, message: `type 期望 ${expectedType}，实际 ${jsonTypeOf(value)}` });
      return; // 类型都不对，继续按该类型的关键字校验只会产出噪声
    }
  } else if (Array.isArray(expectedType)) {
    const candidates = expectedType.filter((t): t is string => typeof t === 'string');
    if (!candidates.some((t) => matchesType(value, t))) {
      violations.push({
        path,
        message: `type 期望 ${candidates.join('|')}，实际 ${jsonTypeOf(value)}`,
      });
      return;
    }
  }

  // ── enum ──
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.includes(value)) {
    violations.push({
      path,
      message: `enum 不含该值: ${JSON.stringify(value)}（允许值 ${JSON.stringify(enumValues)}）`,
    });
  }

  // ── minimum / maximum（仅数值）──
  if (typeof value === 'number') {
    const minimum = schema['minimum'];
    if (typeof minimum === 'number' && value < minimum) {
      violations.push({ path, message: `小于 minimum ${minimum}: ${value}` });
    }
    const maximum = schema['maximum'];
    if (typeof maximum === 'number' && value > maximum) {
      violations.push({ path, message: `大于 maximum ${maximum}: ${value}` });
    }
  }

  // ── 对象：required / additionalProperties / properties 递归 ──
  if (isPlainObject(value)) {
    const properties = isPlainObject(schema['properties']) ? schema['properties'] : {};

    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key !== 'string') continue;
        if (!hasOwn(value, key)) {
          violations.push({ path, message: `缺少 required 字段: ${key}` });
        }
      }
    }

    if (schema['additionalProperties'] === false) {
      for (const key of Object.keys(value)) {
        if (!hasOwn(properties, key)) {
          violations.push({
            path,
            message: `additionalProperties:false 但出现未登记字段: ${key}`,
          });
        }
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (!hasOwn(value, key)) continue; // 可选字段缺席由 required 负责，不在此报错
      if (!isPlainObject(childSchema)) continue;
      validateNode(value[key], childSchema, root, `${path}/${key}`, violations);
    }
  }

  // ── 数组：items 逐元素递归 ──
  if (Array.isArray(value) && isPlainObject(schema['items'])) {
    const itemSchema = schema['items'];
    value.forEach((item, index) => {
      validateNode(item, itemSchema, root, `${path}/${index}`, violations);
    });
  }
}

/**
 * 递归校验 `value` 是否符合 `schema`。
 *
 * 返回全部违规（而非首个）——契约测试失败时一次看清所有偏差，比逐个修更快收敛。
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchema): ValidationResult {
  const violations: SchemaViolation[] = [];
  validateNode(value, schema, schema, '', violations);
  return { valid: violations.length === 0, violations };
}
