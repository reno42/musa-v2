"""
Musa Voz Backend — síntesis de clones de voz (Chatterbox) en Oracle ARM A1.
REQ-071 PENDIENTE 3.

Contrato (consumido por el worker CF musa-voz.mjs):
  GET  /health → {ok, engine, model}
  POST /sintetizar  Authorization: Bearer <MUSA_VOZ_BACKEND_SECRET>
       body: {texto, sampleBase64, mimeType, idioma}
       → 200 {audioBase64, mimeType:"audio/wav", engine, rtf}
       → 4xx/5xx {error, code}

Diseño:
- Zero-shot: el sample (10-25s recomendado) llega en el request, no se guarda.
- Motor configurable VOZ_ENGINE: chatterbox.cpp (GGUF, rápido) o python
  (resemble-ai/chatterbox, fallback). Cada request escribe a /tmp y limpia.
- Sin logs de texto ni de audio: solo métricas (chars, segundos, rtf).
"""
import base64
import os
import subprocess
import time
import tempfile
import shutil
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

SECRET = os.environ.get("MUSA_VOZ_BACKEND_SECRET", "")
ENGINE = os.environ.get("VOZ_ENGINE", "cpp")          # cpp | python
CPP_BIN = os.environ.get("VOZ_CPP_BIN", "/opt/voz/chatterbox.cpp/build/tts-cli")
CPP_MODEL_DIR = os.environ.get("VOZ_MODEL_DIR", "/opt/voz/models")
PYTHON_DIR = os.environ.get("VOZ_PYTHON_DIR", "/opt/voz/chatterbox-py")
MAX_CHARS = int(os.environ.get("VOZ_MAX_CHARS", "5000"))
MAX_SAMPLE_MB = 26

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("voz")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def _err(status: int, code: str, msg: str):
    return JSONResponse(status_code=status, content={"error": msg, "code": code})


@app.get("/health")
def health():
    return {"ok": True, "engine": ENGINE, "model": os.path.basename(CPP_MODEL_DIR)}


@app.post("/sintetizar")
async def sintetizar(req: Request):
    auth = req.headers.get("authorization", "")
    if not SECRET or auth != f"Bearer {SECRET}":
        return _err(401, "AUTH", "Bearer token inválido.")
    try:
        body = await req.json()
    except Exception:
        return _err(400, "VALIDATION", "JSON inválido.")
    texto = (body.get("texto") or "").strip()
    sample_b64 = body.get("sampleBase64") or ""
    mime = (body.get("mimeType") or "audio/mpeg").split(";")[0]
    idioma = (body.get("idioma") or "es").lower()
    if not texto:
        return _err(400, "VALIDATION", "texto vacío.")
    if len(texto) > MAX_CHARS:
        return _err(413, "TOO_LONG", f"Máximo {MAX_CHARS} chars.")
    if not sample_b64:
        return _err(400, "VALIDATION", "sampleBase64 vacío.")
    try:
        sample = base64.b64decode(sample_b64, validate=False)
    except Exception:
        return _err(400, "VALIDATION", "sampleBase64 no es base64 válido.")
    if len(sample) > MAX_SAMPLE_MB * 1024 * 1024:
        return _err(413, "TOO_LARGE", f"Sample supera {MAX_SAMPLE_MB} MB.")

    tmpdir = tempfile.mkdtemp(prefix="voz_")
    ref_path = os.path.join(tmpdir, "ref")
    out_path = os.path.join(tmpdir, "out.wav")
    t0 = time.time()
    try:
        with open(ref_path, "wb") as f:
            f.write(sample)
        ext = {"audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav",
               "audio/mp4": ".m4a", "audio/webm": ".webm", "audio/ogg": ".ogg"}.get(mime, "")
        if ext:
            os.rename(ref_path, ref_path + ext)
            ref_path = ref_path + ext

        if ENGINE == "cpp":
            _run_cpp(texto, ref_path, out_path, idioma)
        else:
            _run_python(texto, ref_path, out_path)

        if not os.path.exists(out_path) or os.path.getsize(out_path) < 800:
            return _err(502, "ENGINE_EMPTY", "El motor no produjo audio.")
        dur = _wav_seconds(out_path)
        wall = time.time() - t0
        rtf = round(wall / max(dur, 0.1), 2)
        with open(out_path, "rb") as f:
            audio = f.read()
        log.info("ok chars=%s dur=%.1fs wall=%.1fs rtf=%.2f bytes=%s",
                 len(texto), dur, wall, rtf, len(audio))
        return {
            "audioBase64": base64.b64encode(audio).decode("ascii"),
            "mimeType": "audio/wav",
            "engine": ENGINE,
            "rtf": rtf,
            "seconds": round(dur, 1),
        }
    except EngineError as e:
        log.error("engine fail: %s", str(e)[:300])
        return _err(502, "ENGINE_FAIL", str(e)[:300])
    except Exception as e:
        log.exception("internal")
        return _err(500, "INTERNAL", "Error interno del backend de voz.")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


class EngineError(Exception):
    pass


def _run_cpp(texto: str, ref: str, out: str, idioma: str):
    """tts-cli (chatterbox.cpp) con GGUF multilingual Q4_0. Flags verificados
    contra el README: --model (T3), --s3gen-gguf, --reference-audio (>5s mono),
    --language tier-1, --out. El binario resamplea/downmixa el ref solo."""
    model_t3 = _find_model(["t3-mtl", "t3_mtl"], CPP_MODEL_DIR)
    model_s3 = _find_model(["s3gen-mtl", "s3gen_mtl"], CPP_MODEL_DIR)
    cmd = [
        CPP_BIN,
        "--model", model_t3,
        "--s3gen-gguf", model_s3,
        "--reference-audio", ref,
        "--text", texto,
        "--language", idioma if idioma in ("es","en","fr","de","it","pt","nl","pl","tr","sv","da","fi","no","el","ms","sw","ar","ko") else "es",
        "--out", out,
    ]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if p.returncode != 0:
        raise EngineError(f"tts-cli rc={p.returncode}: {(p.stderr or p.stdout)[:280]}")


def _run_python(texto: str, ref: str, out: str):
    """Fallback: librería python oficial (archivada, estable) en venv dedicado."""
    venv_py = os.path.join(PYTHON_DIR, "venv", "bin", "python")
    if not os.path.exists(venv_py):
        raise EngineError("venv python chatterbox no encontrado")
    script = (
        "import torchaudio as ta;from chatterbox.mtl_tts import ChatterboxMultilingualTTS;"
        f"m=ChatterboxMultilingualTTS.from_pretrained(device='cpu', t3_model='v3');"
        f"w=m.generate({texto!r}, audio_prompt_path={ref!r}, language_id='es');"
        f"ta.save({out!r}, w, m.sr)"
    )
    p = subprocess.run([venv_py, "-c", script], capture_output=True, text=True,
                       timeout=1800, cwd=PYTHON_DIR)
    if p.returncode != 0:
        raise EngineError(f"python chatterbox rc={p.returncode}: {(p.stderr or p.stdout)[:280]}")


def _find_model(tag_list: list, directory: str) -> str:
    best = None
    for name in sorted(os.listdir(directory)):
        low = name.lower()
        if any(t in low for t in tag_list) and low.endswith(".gguf"):
            best = os.path.join(directory, name)
    if not best:
        raise EngineError(f"modelo GGUF {tag_list} no encontrado en {directory}")
    return best


def _wav_seconds(path: str) -> float:
    import wave
    try:
        with wave.open(path, "rb") as w:
            return w.getnframes() / float(w.getframerate() or 24000)
    except Exception:
        return os.path.getsize(path) / 48000.0  # aprox 24kHz mono 16-bit
