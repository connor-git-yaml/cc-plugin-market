// Feature 214 equivalence-matrix fixture — TS 两 class 同名 member（A.render / B.render 负例）
export class A {
  render(): string {
    return 'a';
  }
}

export class B {
  render(): string {
    return 'b';
  }
}

export function helper(): number {
  return 42;
}
