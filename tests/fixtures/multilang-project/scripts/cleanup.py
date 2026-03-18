import shutil

def cleanup(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)
