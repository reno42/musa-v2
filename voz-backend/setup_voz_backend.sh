# Musa Voz Backend — deploy en Oracle A1 (Ubuntu 24.04 ARM)
# Uso: bash setup_voz_backend.sh   (como root o con sudo -E)
set -euo pipefail

echo "== 1. paquetes base =="
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip build-essential cmake git curl ffmpeg >/dev/null

echo "== 2. chatterbox.cpp (GGUF, CPU ARM) =="
# El build requiere scripts/setup-ggml.sh (clona ggml al pin + parches) — verificado
# contra el README del upstream. Binario final: build/tts-cli.
mkdir -p /opt/voz/models /opt/voz
if [ ! -x /opt/voz/chatterbox.cpp/build/tts-cli ]; then
  git clone --depth 1 https://github.com/gianni-cor/chatterbox.cpp /opt/voz/chatterbox.cpp
  cd /opt/voz/chatterbox.cpp
  ./scripts/setup-ggml.sh
  cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
  cmake --build build -j"$(nproc)"
fi

echo "== 3. modelos GGUF (Chatterbox Multilingual Q4_0: 344MB + 685MB) =="
# No hay releases precompilados: los GGUF se convierten desde los pesos HF
# (ResembleAI/chatterbox ~3GB) con los scripts del repo. Requiere venv python.
cd /opt/voz/chatterbox.cpp
if [ ! -s /opt/voz/models/chatterbox-t3-mtl-q4_0.gguf ]; then
  python3 -m venv venv-conv
  ./venv-conv/bin/pip install -q torch torchaudio huggingface_hub
  ./venv-conv/bin/python scripts/convert-t3-mtl-to-gguf.py  --quant q4_0 --out /opt/voz/models/chatterbox-t3-mtl-q4_0.gguf
  ./venv-conv/bin/python scripts/convert-s3gen-to-gguf.py --variant mtl --quant q4_0 --out /opt/voz/models/chatterbox-s3gen-mtl-q4_0.gguf
  rm -rf venv-conv
fi
ls -la /opt/voz/models

echo "== 4. venv FastAPI + systemd =="
python3 -m venv /opt/voz/venv
/opt/voz/venv/bin/pip install -q fastapi uvicorn[standard]
cat >/etc/systemd/system/musa-voz.service <<UNIT
[Unit]
Description=Musa Voz backend (Chatterbox)
After=network-online.target

[Service]
ExecStart=/opt/voz/venv/bin/uvicorn service:app --host 0.0.0.0 --port 8787 --workers 1
WorkingDirectory=/opt/voz
Environment=MUSA_VOZ_BACKEND_SECRET=__SECRET__
Environment=VOZ_ENGINE=cpp
Environment=VOZ_CPP_BIN=/opt/voz/chatterbox.cpp/build/chatterbox
Environment=VOZ_MODEL_DIR=/opt/voz/models
Restart=always
RestartSec=8
MemoryMax=8G
Nice=-5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now musa-voz
sleep 3
curl -s http://127.0.0.1:8787/health && echo && echo "DEPLOY OK"
