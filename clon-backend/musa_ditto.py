"""musa_ditto.py — Ditto (Ant Group, Apache-2.0) en CPU con ONNX Runtime, listo para Musa.

Cambios sobre el upstream (antgroup/ditto-talkinghead), sin tocar sus archivos:
1. Configuración sin pickle: se carga desde ditto_cfg.json + ditto_cfg.npz (convertidos
   una vez con tools/cfg_to_npz.py y un deserializador restringido).
2. Sin InsightFace (pesos no comerciales): el primer recorte de la cara usa 5 puntos
   derivados de MediaPipe Face Mesh (blaze_face + face_mesh, Apache-2.0), que Ditto
   ya incluye. landmark203 (LivePortrait, MIT) sigue refinando igual que el original.
3. Todo en CPU; los modelos ONNX vienen del repack voxta/ditto-talkinghead-onnx
   (warp con GridSample opset 20 para ORT, decoder fp16).
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import time

import numpy as np

DITTO_DIR = os.environ.get("DITTO_DIR", "/opt/musa-clon/ditto")
MODEL_DIR = os.environ.get("DITTO_MODEL_DIR", "/opt/musa-clon/models")
CFG_PREFIX = os.environ.get("DITTO_CFG", os.path.join(os.path.dirname(__file__), "ditto_cfg"))
THREADS = int(os.environ.get("MUSA_CLON_THREADS", str(os.cpu_count() or 4)))

if DITTO_DIR not in sys.path:
    sys.path.insert(0, DITTO_DIR)

ONNX = {
    "landmark203_cfg": "landmark203.onnx",
    "appearance_extractor_cfg": "appearance_extractor.onnx",
    "motion_extractor_cfg": "motion_extractor.onnx",
    "stitch_network_cfg": "stitch_network.onnx",
    "warp_network_cfg": "warp_network_opset20.onnx",
    "decoder_cfg": "decoder_fp16.onnx",
    "hubert_cfg": "hubert.onnx",
}


def _restore(node, arrays):
    if isinstance(node, dict):
        if set(node.keys()) == {"__nd__"}:
            return arrays[node["__nd__"]]
        return {k: _restore(v, arrays) for k, v in node.items()}
    if isinstance(node, list):
        return [_restore(v, arrays) for v in node]
    return node


def load_cfg() -> dict:
    with open(CFG_PREFIX + ".json", encoding="utf-8") as f:
        tree = json.load(f)
    arrays = dict(np.load(CFG_PREFIX + ".npz", allow_pickle=False))
    return _restore(tree, arrays)


def musa_parse_cfg(_cfg_pkl, data_root, replace_cfg=None):
    """Reemplazo de core.atomic_components.cfg.parse_cfg: mismo retorno, sin pickle, solo ONNX/CPU."""
    cfg = load_cfg()
    base = cfg["base_cfg"]
    a2m = cfg["audio2motion_cfg"]
    default_kwargs = cfg["default_kwargs"]

    def p(name):
        return os.path.join(data_root, name)

    for key, fname in ONNX.items():
        base.setdefault(key, {})
        base[key]["model_path"] = p(fname)
        base[key]["device"] = "cpu"
    # InsightFace se reemplaza (ver _crop); sus entradas quedan vacías y nunca se cargan
    base["insightface_det_cfg"] = {"model_path": "", "device": "cpu"}
    base["landmark106_cfg"] = {"model_path": "", "device": "cpu"}
    base["landmark478_cfg"] = {
        "blaze_face_model_path": p("blaze_face.onnx"),
        "face_mesh_model_path": p("face_mesh.onnx"),
        "device": "cpu",
    }
    a2m["model_path"] = p("lmdm_v0.4_hubert.onnx")
    a2m["device"] = "cpu"

    avatar_registrar_cfg = {k: base[k] for k in [
        "insightface_det_cfg", "landmark106_cfg", "landmark203_cfg",
        "landmark478_cfg", "appearance_extractor_cfg", "motion_extractor_cfg"]}
    condition_handler_cfg = {k: a2m[k] for k in ["use_emo", "use_sc", "use_eye_open", "use_eye_ball", "seq_frames"]}
    lmdm_cfg = {k: a2m[k] for k in ["model_path", "device", "motion_feat_dim", "audio_feat_dim", "seq_frames"]}
    wav2feat_cfg = {"w2f_cfg": base["hubert_cfg"], "w2f_type": "hubert"}
    return [avatar_registrar_cfg, condition_handler_cfg, lmdm_cfg, base["stitch_network_cfg"],
            base["warp_network_cfg"], base["decoder_cfg"], wav2feat_cfg, default_kwargs]


# Índices de MediaPipe Face Mesh (478) para 5 puntos: ojo der., ojo izq., nariz, comisuras
_MP_EYE_R = (33, 133)
_MP_EYE_L = (362, 263)
_MP_NOSE = 1
_MP_MOUTH = (61, 291)


def mp_pt5(mesh_norm: np.ndarray, w: int, h: int) -> np.ndarray:
    """mesh normalizado (478,3) → 5 puntos en píxeles con el orden de parse_pt2_from_pt5."""
    m = mesh_norm.reshape(-1, 3)[:, :2] * np.array([w, h], dtype=np.float32)
    eye_r = (m[_MP_EYE_R[0]] + m[_MP_EYE_R[1]]) / 2
    eye_l = (m[_MP_EYE_L[0]] + m[_MP_EYE_L[1]]) / 2
    return np.stack([eye_r, eye_l, m[_MP_NOSE], m[_MP_MOUTH[0]], m[_MP_MOUTH[1]]], 0).astype(np.float32)


def _blend_numpy(mask_warped, frame_warped, frame_rgb, result):
    """Misma mezcla que blend_images_cy (Cython) en numpy: sin compilador ni pyximport."""
    m = mask_warped[..., None]
    np.copyto(result, np.clip(m * frame_warped + (1.0 - m) * frame_rgb, 0, 255).astype(np.uint8))


def _patch_ditto():
    """Aplica los reemplazos sobre los módulos del upstream (una sola vez)."""
    import types
    if "core.utils.blend" not in sys.modules:
        import core.utils  # noqa: F401, E402  (paquete padre)
        blend = types.ModuleType("core.utils.blend")
        blend.blend_images_cy = _blend_numpy
        sys.modules["core.utils.blend"] = blend
    import stream_pipeline_offline as spo  # noqa: E402
    from core.atomic_components import source2info as s2i  # noqa: E402
    from core.utils.crop import crop_image  # noqa: E402

    if getattr(s2i.Source2Info, "_musa_patched", False):
        return spo

    spo.parse_cfg = musa_parse_cfg

    def __init__(self, insightface_det_cfg, landmark106_cfg, landmark203_cfg, landmark478_cfg,
                 appearance_extractor_cfg, motion_extractor_cfg):
        self.landmark203 = s2i.Landmark203(**landmark203_cfg)
        self.landmark478 = s2i.Landmark478(**landmark478_cfg)
        self.appearance_extractor = s2i.AppearanceExtractor(**appearance_extractor_cfg)
        self.motion_extractor = s2i.MotionExtractor(**motion_extractor_cfg)

    def _crop(self, img, last_lmk=None, **kwargs):
        if last_lmk is None:
            mesh = self.landmark478.get(img)
            if mesh is None:
                return None
            lmk_for_track = mp_pt5(np.asarray(mesh), img.shape[1], img.shape[0])
        else:
            lmk_for_track = last_lmk
        crop_dct = crop_image(img, lmk_for_track, dsize=self.landmark203.dsize, scale=1.5, vy_ratio=-0.1, pt_crop_flag=False)
        lmk203 = self.landmark203(crop_dct["img_crop"], crop_dct["M_c2o"])
        ret = crop_image(img, lmk203, dsize=512, scale=kwargs.get("crop_scale", 2.3),
                         vx_ratio=kwargs.get("crop_vx_ratio", 0), vy_ratio=kwargs.get("crop_vy_ratio", -0.125),
                         flag_do_rot=kwargs.get("crop_flag_do_rot", True), pt_crop_flag=False)
        return ret["img_crop"], ret["M_c2o"], lmk203

    s2i.Source2Info.__init__ = __init__
    s2i.Source2Info._crop = _crop
    s2i.Source2Info._musa_patched = True
    return spo


_SDK = None


def sdk():
    """StreamSDK cargado una vez por proceso (los modelos tardan ~10-20 s en abrir)."""
    global _SDK
    if _SDK is None:
        try:
            import onnxruntime as ort
            ort.set_default_logger_severity(3)
        except Exception:
            pass
        os.environ.setdefault("OMP_NUM_THREADS", str(THREADS))
        spo = _patch_ditto()
        _SDK = spo.StreamSDK("musa-sin-pickle", MODEL_DIR)
    return _SDK


def render(source_path: str, audio_wav16k: str, out_mp4: str, sampling_timesteps: int = 25,
           on_progress=None) -> float:
    """Genera el video con labios y cabeza animados. Devuelve los segundos de audio.

    sampling_timesteps: pasos de difusión del movimiento (50 en el upstream; 25 mantiene la
    calidad y casi duplica la velocidad en CPU).
    """
    import librosa

    s = sdk()
    tmp_mp4 = out_mp4 + ".tmp.mp4"
    s.setup(source_path, tmp_mp4, sampling_timesteps=sampling_timesteps, max_size=1080)
    audio, _ = librosa.core.load(audio_wav16k, sr=16000)
    seconds = len(audio) / 16000.0
    n_frames = math.ceil(seconds * 25)
    s.setup_Nd(N_d=n_frames, fade_in=-1, fade_out=-1, ctrl_info={})

    stop = {"v": False}
    if on_progress:
        import threading

        def _watch():
            while not stop["v"]:
                done = getattr(getattr(s, "writer_pbar", None), "n", 0) or 0
                on_progress(min(95, int(100 * done / max(1, n_frames))))
                time.sleep(4)
        threading.Thread(target=_watch, daemon=True).start()

    aud_feat = s.wav2feat.wav2feat(audio)
    s.audio2motion_queue.put(aud_feat)
    s.close()
    stop["v"] = True

    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", s.tmp_output_path, "-i", audio_wav16k,
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", out_mp4], check=True)
    for f in (s.tmp_output_path, tmp_mp4):
        try:
            os.remove(f)
        except OSError:
            pass
    return seconds


def face_pt5(img_rgb: np.ndarray):
    """5 puntos de la cara principal (o None) — lo usa la preparación para elegir cuadro."""
    s = sdk()
    mesh = s.avatar_registrar.source2info.landmark478.get(img_rgb)
    if mesh is None:
        return None, None
    mesh = np.asarray(mesh).reshape(-1, 3)
    return mp_pt5(mesh, img_rgb.shape[1], img_rgb.shape[0]), mesh
