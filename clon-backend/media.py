"""media.py — preparación del clon (mejor cuadro + muestra de voz) y composición final con ffmpeg."""
from __future__ import annotations

import json
import os
import subprocess

import cv2
import numpy as np

FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")
TARGETS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}


class PrepError(Exception):
    """Error explicable a la persona (se muestra tal cual en Musa)."""


def run(cmd: list[str], timeout: int = 1800):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f"{os.path.basename(cmd[0])} rc={p.returncode}: {(p.stderr or p.stdout)[-400:]}")
    return p.stdout


def probe(path: str) -> dict:
    out = run([FFPROBE, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], timeout=60)
    return json.loads(out or "{}")


def has_audio(path: str) -> bool:
    return any(s.get("codec_type") == "audio" for s in probe(path).get("streams", []))


def duration(path: str) -> float:
    try:
        return float(probe(path).get("format", {}).get("duration") or 0)
    except Exception:
        return 0.0


def to_wav16k(src: str, dst: str):
    run([FFMPEG, "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-ar", "16000", "-vn", dst])


# ── Elección del mejor cuadro ──
def _score_frame(rgb: np.ndarray, face_pt5) -> tuple[float, dict]:
    pt5, mesh = face_pt5(rgb)
    if pt5 is None:
        return 0.0, {}
    h, w = rgb.shape[:2]
    eye_r, eye_l, nose, mouth_r, mouth_l = pt5
    eye_dist = float(np.linalg.norm(eye_l - eye_r))
    if eye_dist < 0.06 * w:
        return 0.0, {}
    # tamaño: cara ni diminuta ni cortada
    size = min(1.0, eye_dist / (0.16 * w))
    # frontalidad: nariz centrada entre los ojos y línea de ojos horizontal
    mid = (eye_r + eye_l) / 2
    yaw = abs(float(nose[0] - mid[0])) / eye_dist
    roll = abs(float(np.degrees(np.arctan2(eye_l[1] - eye_r[1], eye_l[0] - eye_r[0]))))
    frontal = max(0.0, 1 - yaw * 2.2) * max(0.0, 1 - roll / 25)
    # centrado horizontal en el cuadro
    center = max(0.0, 1 - abs(float(mid[0]) / w - 0.5) * 2)
    # ojos abiertos (alto/ancho del ojo en la malla 478: párpados 159/145 y 386/374)
    m = mesh[:, :2] * np.array([w, h])
    open_r = np.linalg.norm(m[159] - m[145]) / max(1e-3, np.linalg.norm(m[33] - m[133]))
    open_l = np.linalg.norm(m[386] - m[374]) / max(1e-3, np.linalg.norm(m[362] - m[263]))
    eyes = min(1.0, ((open_r + open_l) / 2) / 0.22)
    # boca cerrada o casi (mejor punto de partida para animar)
    mouth_open = np.linalg.norm(m[13] - m[14]) / max(1e-3, np.linalg.norm(m[61] - m[291]))
    mouth = max(0.2, 1 - mouth_open * 3)
    # nitidez de la zona de la cara
    x0, y0 = int(max(0, mid[0] - eye_dist * 1.6)), int(max(0, mid[1] - eye_dist * 1.6))
    x1, y1 = int(min(w, mid[0] + eye_dist * 1.6)), int(min(h, mid[1] + eye_dist * 2.2))
    gray = cv2.cvtColor(rgb[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY)
    sharp = min(1.0, float(cv2.Laplacian(gray, cv2.CV_64F).var()) / 180.0) if gray.size else 0.0
    score = size * 0.15 + frontal * 0.3 + center * 0.1 + eyes * 0.2 + mouth * 0.1 + sharp * 0.15
    return score, {"frontal": round(frontal, 3), "eyes": round(eyes, 3), "sharp": round(sharp, 3)}


def best_portrait(src: str, out_png: str, face_pt5, is_video: bool, max_side: int = 1080) -> dict:
    """Guarda el mejor cuadro (o la foto) como PNG; falla con mensaje claro si no hay cara."""
    candidates = []
    if is_video:
        cap = cv2.VideoCapture(src)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        step = max(1, int(fps / 3))  # ~3 cuadros por segundo
        limit = min(total or 10**9, int(fps * 90))
        idx = 0
        while idx < limit:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, bgr = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            s, info = _score_frame(rgb, face_pt5)
            if s > 0:
                candidates.append((s, idx, rgb, info))
            idx += step
        cap.release()
    else:
        bgr = cv2.imread(src, cv2.IMREAD_COLOR)
        if bgr is None:
            raise PrepError("No se pudo abrir la foto.")
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        s, info = _score_frame(rgb, face_pt5)
        if s > 0:
            candidates.append((s, 0, rgb, info))
    if not candidates:
        raise PrepError("No encontramos una cara clara y de frente. Graba de nuevo mirando a cámara, con buena luz y la cara completa en el cuadro.")
    score, idx, rgb, info = max(candidates, key=lambda c: c[0])
    if score < 0.45:
        raise PrepError("La cara no se ve lo bastante de frente o nítida. Graba de nuevo mirando a cámara, con buena luz y sin moverte tanto.")
    h, w = rgb.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1:
        rgb = cv2.resize(rgb, (int(w * scale) // 2 * 2, int(h * scale) // 2 * 2), interpolation=cv2.INTER_AREA)
    cv2.imwrite(out_png, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    return {"frame": idx, "faceScore": round(score, 3), **info}


def voice_sample(src: str, out_wav: str, max_s: int = 25) -> int:
    """Hasta 25 s de voz (sin silencios al inicio) a 24 kHz mono. Devuelve bytes o 0 si no hay voz útil."""
    if not has_audio(src):
        return 0
    run([FFMPEG, "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "24000",
         "-af", "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.3,loudnorm=I=-18:TP=-2",
         "-t", str(max_s), out_wav])
    if duration(out_wav) < 6:  # Chatterbox necesita >5 s de referencia
        return 0
    return os.path.getsize(out_wav)


def preview_jpg(png: str, out_jpg: str, side: int = 640):
    run([FFMPEG, "-loglevel", "error", "-y", "-i", png, "-vf", f"scale='min({side},iw)':-2", "-q:v", "3", out_jpg])


def compose(raw_mp4: str, aspect: str, out_mp4: str, poster_jpg: str, title: str = ""):
    """Lleva el render al formato pedido: fondo difuminado + persona centrada, H.264 + AAC, faststart."""
    tw, th = TARGETS.get(aspect, TARGETS["9:16"])
    fc = (f"[0:v]split=2[a][b];"
          f"[a]scale={tw}:{th}:force_original_aspect_ratio=increase,crop={tw}:{th},boxblur=28:2,eq=brightness=-0.06[bg];"
          f"[b]scale={tw}:{th}:force_original_aspect_ratio=decrease[fg];"
          f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]")
    run([FFMPEG, "-loglevel", "error", "-y", "-i", raw_mp4, "-filter_complex", fc, "-map", "[v]", "-map", "0:a?",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", "25",
         "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
         "-metadata", f"comment=Generado con IA en Musa · clon autorizado{(' · ' + title) if title else ''}",
         out_mp4])
    run([FFMPEG, "-loglevel", "error", "-y", "-ss", "0.8", "-i", out_mp4, "-frames:v", "1", "-q:v", "3", poster_jpg])
