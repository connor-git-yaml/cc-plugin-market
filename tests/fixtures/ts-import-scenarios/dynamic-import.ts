// fixture: 动态 import() 调用（FR-28 / AC-11，importType='dynamic'）
export async function loadBaz() {
  const mod = await import('./baz');
  return mod;
}
