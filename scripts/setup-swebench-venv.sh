#!/usr/bin/env bash
# F187：一次性 bootstrap Python venv 安装 SWE-Bench 官方 harness。
# venv 与 Node.js 生态隔离，不入库（.gitignore 覆盖 scripts/.swebench-venv/）。
# 幂等：重复跑只在缺失时创建 venv，已装则跳过 pip install。
set -euo pipefail

# 优先 python3.12（host python3.14 过新，swebench 依赖 datasets 等可能未适配）
PYTHON="${SWEBENCH_PYTHON:-python3.12}"
VENV="${SWEBENCH_VENV:-scripts/.swebench-venv}"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "[setup-swebench-venv] 未找到 ${PYTHON} ，请安装 Python 3.11/3.12 或设 SWEBENCH_PYTHON" >&2
  exit 1
fi

if [ ! -x "$VENV/bin/python" ]; then
  echo "[setup-swebench-venv] 创建 venv: ${VENV} ( $("${PYTHON}" --version) )"
  "$PYTHON" -m venv "$VENV"
fi

# swebench 已装则跳过（幂等）
if "$VENV/bin/python" -c "import swebench" >/dev/null 2>&1; then
  echo "[setup-swebench-venv] swebench 已安装，跳过 pip install"
else
  echo "[setup-swebench-venv] 安装 swebench（含 docker SDK / datasets，首次较慢）..."
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet swebench
fi

echo "[setup-swebench-venv] ready: $VENV"
"$VENV/bin/python" -c "import swebench; print('swebench', getattr(swebench,'__version__','?'))"
