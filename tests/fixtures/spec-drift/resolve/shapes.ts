/** resolve fixture：member 粒度引用（Class.method）MUST 被显式拒绝 */
export class Rectangle {
  constructor(private width: number, private height: number) {}

  area(): number {
    return this.width * this.height;
  }
}
