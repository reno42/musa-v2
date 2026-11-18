"""engine.py — motor de clones de Musa (REQ-072). Corre en Oracle A1 (o en cualquier CPU).

Modelo pull: pide trabajo a Musa, procesa y sube el resultado con URLs firmadas.
No abre puertos ni guarda llaves de Supabase; solo necesita:
  MUSA_API                  https://musa-v2.renzo-08c.workers.dev
  MUSA_CLON_ENGINE_SECRET   el mismo secreto del worker
  MUSA_CLON_WORKER          nombre de esta máquina (por defecto el hostname)
"""
from __future__ import annotations

import os
import platform
import shutil
import socket
import tempfile
import threading
import time
import traceback

import requests

import media

API = os.environ.get("MUSA_API", "https://musa-v2.renzo-08c.workers.dev").rstrip("/")
SECRET = os.environ.get("MUSA_CLON_ENGINE_SECRET", "")
WORKER = os.environ.get("MUSA_CLON_WORKER", socket.gethostname())[:60]
POLL_S = int(os.environ.get("MUSA_CLON_POLL", "12"))
STEPS = int(os.environ.get("MUSA_CLON_STEPS", "25"))
VERSION = "musa-clon-engine/1.0 ditto-onnx-cpu"
INFO = {"version": VERSION, "cpu": platform.machine(), "threads": os.cpu_count()}


def api(path: str, body: dict, timeout: int = 60) -> dict:
    r = requests.post(f"{API}/api/musa-clon/engine/{path}", json={"worker": WORKER, **body},
                      headers={"Authorization": f"Bearer {SECRET}"}, timeout=timeout)
    if r.status_code >= 400:
        raise RuntimeError(f"API {path} {r.status_code}: {r.text[:200]}")
    return r.json()


def download(url: str, dst: str):
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dst, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)


def upload(url: str, src: str, mime: str):
    with open(src, "rb") as f:
        r = requests.put(url, data=f, headers={"Content-Type": mime}, timeout=600)
    if r.status_code >= 300:
        raise RuntimeError(f"PUT {r.status_code}: {r.text[:200]}")


class Heartbeat:
    """Reporta avance cada 20 s para que la cola sepa que el trabajo sigue vivo."""

    def __init__(self, job_id: str):
        self.job_id, self.progress, self.stop = job_id, 1, False
        threading.Thread(target=self._loop, daemon=True).start()

    def set(self, p: int):
        self.progress = max(self.progress, int(p))

    def _loop(self):
        while not self.stop:
            try:
                api("progress", {"jobId": self.job_id, "progress": self.progress, "info": INFO}, timeout=20)
            except Exception as e:  # noqa: BLE001
                print("heartbeat:", e, flush=True)
            for _ in range(20):
                if self.stop:
                    return
                time.sleep(1)


def is_video(path: str) -> bool:
    return any(s.get("codec_type") == "video" and s.get("codec_name") not in ("png", "mjpeg", "webp")
               for s in media.probe(path).get("streams", [])) and media.duration(path) > 0.5


def do_prepare(job: dict, clone: dict, inputs: dict, outputs: dict, hb: Heartbeat, tmp: str) -> dict:
    import musa_ditto
    src = os.path.join(tmp, "source")
    download(inputs["source"], src)
    hb.set(10)
    video = clone.get("source_kind") == "take" or is_video(src)
    portrait = os.path.join(tmp, "portrait.png")
    info = media.best_portrait(src, portrait, musa_ditto.face_pt5, is_video=video)
    hb.set(60)
    upload(outputs["portrait"], portrait, "image/png")
    prev = os.path.join(tmp, "preview.jpg")
    media.preview_jpg(portrait, prev)
    upload(outputs["preview"], prev, "image/jpeg")
    result = {**info, "bytes": os.path.getsize(portrait) + os.path.getsize(prev)}
    if video and outputs.get("voice_sample"):
        wav = os.path.join(tmp, "voz.wav")
        nbytes = media.voice_sample(src, wav)
        if nbytes:
            upload(outputs["voice_sample"], wav, "audio/wav")
            result.update({"voiceId": outputs["voice_id"], "voiceBytes": nbytes, "idioma": "es"})
            result["bytes"] += nbytes
    hb.set(95)
    return result


def do_render(job: dict, clone: dict, inputs: dict, outputs: dict, hb: Heartbeat, tmp: str) -> dict:
    import musa_ditto
    portrait = os.path.join(tmp, "portrait.png")
    audio = os.path.join(tmp, "audio")
    download(inputs["portrait"], portrait)
    download(inputs["audio"], audio)
    wav = os.path.join(tmp, "audio16k.wav")
    media.to_wav16k(audio, wav)
    hb.set(5)
    raw = os.path.join(tmp, "raw.mp4")
    t0 = time.time()
    seconds = musa_ditto.render(portrait, wav, raw, sampling_timesteps=STEPS,
                                on_progress=lambda p: hb.set(5 + int(p * 0.85)))
    hb.set(92)
    out = os.path.join(tmp, "final.mp4")
    poster = os.path.join(tmp, "poster.jpg")
    media.compose(raw, job.get("aspect") or "9:16", out, poster, title=clone.get("name") or "")
    upload(outputs["video"], out, "video/mp4")
    upload(outputs["poster"], poster, "image/jpeg")
    wall = time.time() - t0
    print(f"render ok: {seconds:.1f}s de video en {wall:.0f}s (x{wall / max(seconds, 0.1):.1f})", flush=True)
    return {"seconds": round(seconds, 2), "wall": round(wall, 1), "bytes": os.path.getsize(out) + os.path.getsize(poster)}


def loop():
    if not SECRET:
        raise SystemExit("Falta MUSA_CLON_ENGINE_SECRET")
    print(f"{VERSION} · {WORKER} · {API}", flush=True)
    import musa_ditto
    musa_ditto.sdk()  # carga los modelos una vez antes de aceptar trabajo
    print("modelos listos", flush=True)
    while True:
        try:
            claim = api("claim", {"info": INFO})
        except Exception as e:  # noqa: BLE001
            print("claim:", e, flush=True)
            time.sleep(POLL_S * 2)
            continue
        job = claim.get("job")
        if not job:
            time.sleep(POLL_S)
            continue
        print(f"job {job['id']} {job['kind']} (intento {job.get('attempts')})", flush=True)
        hb = Heartbeat(job["id"])
        tmp = tempfile.mkdtemp(prefix="clon_")
        try:
            fn = do_prepare if job["kind"] == "prepare" else do_render
            result = fn(job, claim.get("clone") or {}, claim.get("inputs") or {}, claim.get("outputs") or {}, hb, tmp)
            hb.stop = True
            api("complete", {"jobId": job["id"], "result": result})
        except media.PrepError as e:
            hb.stop = True
            api("fail", {"jobId": job["id"], "error": str(e), "retry": False})
        except Exception as e:  # noqa: BLE001
            hb.stop = True
            traceback.print_exc()
            transitorio = isinstance(e, (requests.RequestException, TimeoutError))
            try:
                api("fail", {"jobId": job["id"], "error": "El motor falló procesando el video. " + str(e)[:200], "retry": transitorio})
            except Exception as e2:  # noqa: BLE001
                print("fail:", e2, flush=True)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    loop()
