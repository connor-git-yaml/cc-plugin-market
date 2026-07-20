# Feature 214 equivalence-matrix fixture — Python class + 顶层函数
class Model:
    def forward(self, x):
        return x

    @property
    def shape(self):
        return (1,)


def main():
    return Model()
