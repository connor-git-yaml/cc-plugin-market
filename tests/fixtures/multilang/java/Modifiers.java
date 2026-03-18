package com.example.modifiers;

public abstract class AbstractService {
    public abstract void execute();

    protected void setup() {}

    private void cleanup() {}

    static void staticHelper() {}
}

final class FinalService extends AbstractService {
    @Override
    public void execute() {}
}
