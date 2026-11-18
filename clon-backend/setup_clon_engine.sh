#!/usr/bin/env bash
# Musa — motor de clones (REQ-072) en Oracle A1 (Ubuntu 22.04/24.04 ARM64) o cualquier Linux x86_64.
# Uso:  sudo MUSA_CLON_ENGINE_SECRET=... bash setup_clon_engine.sh
# Convive con musa-voz (Chatterbox, REQ-071) en la misma VM. No abre puertos: el motor pide trabajo a Musa.
set -euo pipefail

: "${MUSA_CLON_ENGINE_SECRET:?Falta MUSA_CLON_ENGINE_SECRET (el mismo secreto del worker)}"
MUSA_API="${MUSA_API:-https://musa-v2.renzo-08c.workers.dev}"
BASE=/opt/musa-clon
DITTO_COMMIT=c3e47eee2e626500017a0556b470d6d4182f85e8   # antgroup/ditto-talkinghead (Apache-2.0)
HF=https://huggingface.co/voxta/ditto-talkinghead-onnx/resolve/main   # repack ONNX (Apache-2.0)
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== 1. paquetes del sistema =="
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip git ffmpeg curl libgl1 libglib2.0-0 >/dev/null

echo "== 2. código de Ditto (fijado) + motor de Musa =="
mkdir -p "$BASE/models"
if [ ! -d "$BASE/ditto/.git" ]; then
  git clone -q https://github.com/antgroup/ditto-talkinghead "$BASE/ditto"
fi
git -C "$BASE/ditto" fetch -q --depth 1 origin "$DITTO_COMMIT" || true
git -C "$BASE/ditto" checkout -q "$DITTO_COMMIT"
install -m 0644 "$SRC_DIR"/engine.py "$SRC_DIR"/media.py "$SRC_DIR"/musa_ditto.py "$SRC_DIR"/ditto_cfg.json "$SRC_DIR"/ditto_cfg.npz "$BASE"/

echo "== 3. modelos ONNX (sin InsightFace: el recorte usa MediaPipe, Apache-2.0), verificados por SHA-256 =="
cd "$BASE/models"
while read -r f sha; do
  [ -z "$f" ] && continue
  for intento in 1 2 3; do
    if [ -s "$f" ] && [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$sha" ]; then break; fi
    rm -f "$f"; curl -fsSL --retry 4 -o "$f" "$HF/$f" || true
  done
  [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$sha" ] || { echo "ERROR: $f no coincide con su SHA-256 (descarga corrupta)"; exit 1; }
  echo "ok $f"
done <<'SHAS'
appearance_extractor.onnx 9f5823888fc155209d69cf5b3ad69502c553eaa500d28f07fd39a340bc5b7eb6
blaze_face.onnx 9b217128f6b66f7e11dc3673c22be250d72f68f507430817d0754ef1451eb609
decoder_fp16.onnx a6bbd61ca614966a3cbb46dd6f2b8e81af804e5d2b199e314d37ee3f492c8092
face_mesh.onnx bbbb49fac007b7cde79b478c680d171969f23f53ae6cdaf6a3b4264fa18c8479
hubert.onnx 327a5b90c0bfb9df251c9af91d0bea5e6284dbb0a4d02814f1d3ace6b4c2b5aa
landmark203.onnx babb139e95a783f0df5d296fc069badc4c7fcdacca0d202b21bcd409dfd2f556
lmdm_v0.4_hubert.onnx ea6664518746a1c2e13db496ffe97216da715742be83e069a02cc86873c6dcfc
motion_extractor.onnx 91bd0c05e9fa2cb4918d32cfe547db1d3f3fbbf79713ffbe207670f422e069a1
stitch_network.onnx d3629a08268f1125d60c194e6dbd495126424e8de1112f2fc368170660dde043
warp_network_opset20.onnx 1d08e0b26c8826953d6fdb6bba4196bf6e514a3173e259a8ac06eae7becff099
SHAS
for f in LICENSE NOTICE; do [ -s "$f" ] || curl -fsSL --retry 4 -o "$f" "$HF/$f"; done
ls -la "$BASE/models"

echo "== 4. entorno Python =="
python3 -m venv "$BASE/venv"
"$BASE/venv/bin/pip" install -q --upgrade pip
"$BASE/venv/bin/pip" install -q torch --index-url https://download.pytorch.org/whl/cpu
"$BASE/venv/bin/pip" install -q -r "$SRC_DIR/requirements.txt"

echo "== 5. servicio systemd =="
cat >/etc/musa-clon.env <<ENV
MUSA_API=$MUSA_API
MUSA_CLON_ENGINE_SECRET=$MUSA_CLON_ENGINE_SECRET
MUSA_CLON_WORKER=$(hostname)-a1
DITTO_DIR=$BASE/ditto
DITTO_MODEL_DIR=$BASE/models
DITTO_CFG=$BASE/ditto_cfg
MUSA_CLON_STEPS=25
OMP_NUM_THREADS=$(nproc)
ENV
chmod 600 /etc/musa-clon.env
cat >/etc/systemd/system/musa-clon.service <<UNIT
[Unit]
Description=Musa · motor de clones (Ditto ONNX CPU)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/musa-clon.env
WorkingDirectory=$BASE
ExecStart=$BASE/venv/bin/python -u $BASE/engine.py
Restart=always
RestartSec=10
Nice=10
MemoryMax=14G

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now musa-clon
sleep 25
systemctl --no-pager status musa-clon | head -12
journalctl -u musa-clon --no-pager -n 20
echo "LISTO: el motor aparece como encendido en Crear › Clones IA (GET /api/musa-clon/estado)."
