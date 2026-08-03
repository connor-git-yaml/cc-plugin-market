// #3 genericAdapters 大小写变体样本（.JAVA）——Java/Go 采集面是大小写不敏感的，
// 该样本证明 extname().toLowerCase() 语义在护栏 fixture 里被真实覆盖。
// 禁止在同目录新增 foo.java（大小写不敏感 FS 会静默覆盖），见本 fixture 的 README.md。
package guardrail;

public class Foo {
    public String name() {
        return "foo";
    }
}
