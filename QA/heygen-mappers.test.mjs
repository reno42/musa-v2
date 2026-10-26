// REQ-059 (bloque D) — Mapeos puros de HeyGen v3 (shared/heygenMappers.ts).
// Run with: node --experimental-strip-types --test QA/heygen-mappers.test.mjs
//
// Estos mapeos son el ÚNICO contrato entre el proxy del worker y la UI, así que
// se prueban acá sin red: ninguna llamada real a HeyGen, ninguna key. El poll
// (src/lib/heygen.ts) no es importable en node — lo que decide su corte es
// videoPhaseOf, y eso sí está cubierto abajo.
import assert from "node:assert/strict";
import test from "node:test";
import {
  HEYGEN_API_BASE,
  HEYGEN_ASPECT_RATIOS,
  HeygenMapError,
  SCRIPT_WORDS_PER_MIN,
  aspectForTakeFormat,
  buildAvatarVideoBody,
  buildDigitalTwinBody,
  buildScriptPrompt,
  countScriptWords,
  extractTextFromLlmResponse,
  heygenData,
  heygenErrorPayload,
  heygenList,
  isHeygenAspect,
  normalizeAccount,
  normalizeAvatarLooks,
  normalizeVideoList,
  normalizeVideoStatus,
  normalizeVoices,
  parseScriptsResponse,
  scriptEstimateSeconds,
  videoPhaseOf,
} from "../shared/heygenMappers.ts";

test("constantes: base oficial y whitelist de aspect", () => {
  assert.equal(HEYGEN_API_BASE, "https://api.heygen.com");
  assert.deepEqual([...HEYGEN_ASPECT_RATIOS], ["16:9", "9:16", "4:5", "5:4", "1:1", "auto"]);
  assert.equal(isHeygenAspect("9:16"), true);
  assert.equal(isHeygenAspect("3:2"), false);
  assert.equal(isHeygenAspect(null), false);
  assert.equal(aspectForTakeFormat("vertical"), "9:16");
});

// ── Sobre el envoltorio { code, data } ───────────────────────────────────────

test("heygenData desenvuelve; una lista arriba se normaliza a { items }", () => {
  assert.deepEqual(heygenData({ code: 0, data: { plan: "creator" } }), { plan: "creator" });
  assert.deepEqual(heygenData({ code: 0, data: [{ id: "a" }] }), { items: [{ id: "a" }] });
  assert.deepEqual(heygenData({ video_id: "v1" }), { video_id: "v1" });
  assert.deepEqual(heygenData(null), {});
  assert.deepEqual(heygenData("texto"), {});
});

test("heygenList acepta el nombre de clave que HeyGen use hoy", () => {
  assert.deepEqual(heygenList({ data: { looks: [{ id: "l1" }] } }, "looks"), [{ id: "l1" }]);
  assert.deepEqual(heygenList({ data: { videos: [{ id: "v1" }] } }), [{ id: "v1" }]);
  assert.deepEqual(heygenList({ data: { results: [{ id: 1 }, { id: 2 }] } }), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(heygenList({ data: { items: [{ a: 1 }, { b: 2 }] } }), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(heygenList({}), []);
});

// ── Normalizadores ───────────────────────────────────────────────────────────

test("normalizeAccount: plan, créditos y email; nada inventado si faltan", () => {
  const full = normalizeAccount({
    data: { user_id: "u1", email: "a@b.c", plan: "creator", credits: { remaining_credits: 123.5 } },
  });
  assert.deepEqual(full, { userId: "u1", email: "a@b.c", plan: "creator", remainingCredits: 123.5 });

  // Alias: subscription.plan y remaining_credits plano.
  const alt = normalizeAccount({ data: { id: 7, subscription: { plan: "team" }, remaining_credits: "40" } });
  assert.equal(alt.userId, "7");
  assert.equal(alt.plan, "team");
  assert.equal(alt.remainingCredits, 40);
  assert.equal(alt.email, null);

  const vacio = normalizeAccount({});
  assert.equal(vacio.plan, null);
  assert.equal(vacio.remainingCredits, null);
});

test("normalizeAvatarLooks: el id del look es el avatar_id, y status manda", () => {
  const looks = normalizeAvatarLooks({
    data: {
      looks: [
        { id: "l1", name: "Clon mío", avatar_type: "avatar", group_id: "g1", preview_image_url: "https://x/1.png", status: "completed" },
        { look_id: "l2", title: "Entrenando", status: "Processing" },
        { name: "sin id se descarta" },
      ],
    },
  });
  assert.equal(looks.length, 2);
  assert.deepEqual(
    { id: looks[0].id, name: looks[0].name, ready: looks[0].ready, status: looks[0].status, groupId: looks[0].groupId },
    { id: "l1", name: "Clon mío", ready: true, status: "completed", groupId: "g1" },
  );
  // Lower-case normalizado y 'processing' NO es listo.
  assert.equal(looks[1].status, "processing");
  assert.equal(looks[1].ready, false);
  assert.equal(looks[1].name, "Entrenando");
  // Los looks de catálogo vienen sin status: se asumen listos.
  assert.equal(normalizeAvatarLooks({ data: { looks: [{ id: "l3" }] } })[0].ready, true);
});

test("normalizeVoices: voice_id o id, y se descartan las vacías", () => {
  const voices = normalizeVoices({
    data: {
      voices: [
        { voice_id: "v1", name: "Sofia", language: "es", gender: "female", preview_audio_url: "https://x/1.mp3" },
        { id: "v2" },
        { name: "sin id" },
      ],
    },
  });
  assert.equal(voices.length, 2);
  assert.deepEqual(voices[0], {
    voiceId: "v1",
    name: "Sofia",
    language: "es",
    gender: "female",
    previewAudioUrl: "https://x/1.mp3",
  });
  assert.equal(voices[1].name, "Sin nombre");
});

test("videoPhaseOf: enum oficial + sinónimos, y lo desconocido sigue procesando", () => {
  for (const s of ["completed", "success", "succeeded", "ready", "done"]) assert.equal(videoPhaseOf(s), "ready", s);
  for (const s of ["failed", "error", "cancelled", "canceled", "rejected"]) assert.equal(videoPhaseOf(s), "failed", s);
  for (const s of ["pending", "queued", "waiting", "submitted", "created"]) assert.equal(videoPhaseOf(s), "queued", s);
  for (const s of ["processing", "transforming", "rendering", "in_progress", "generating"]) assert.equal(videoPhaseOf(s), "processing", s);
  assert.equal(videoPhaseOf("PROCESSED?"), "processing");
  assert.equal(videoPhaseOf(null), "processing");
});

test("normalizeVideoStatus: la URL recién existe cuando el fase es ready", () => {
  const conUrl = { data: { video_id: "v1", status: "processing", video_url: "https://x/premature.mp4" } };
  const proc = normalizeVideoStatus(conUrl);
  assert.equal(proc.phase, "processing");
  assert.equal(proc.videoUrl, null, "no mostramos un render que HeyGen no confirmó");

  const done = normalizeVideoStatus({
    data: {
      video_id: "v1",
      status: "completed",
      video_url: "https://x/final.mp4",
      thumbnail_url: "https://x/t.jpg",
      captioned_video_url: "https://x/cap.mp4",
      subtitle_url: "https://x/s.vtt",
      duration: 42,
    },
  });
  assert.deepEqual(
    {
      phase: done.phase,
      videoUrl: done.videoUrl,
      thumbnailUrl: done.thumbnailUrl,
      captionedVideoUrl: done.captionedVideoUrl,
      subtitleUrl: done.subtitleUrl,
      durationSec: done.durationSec,
    },
    {
      phase: "ready",
      videoUrl: "https://x/final.mp4",
      thumbnailUrl: "https://x/t.jpg",
      captionedVideoUrl: "https://x/cap.mp4",
      subtitleUrl: "https://x/s.vtt",
      durationSec: 42,
    },
  );

  const fail = normalizeVideoStatus({ data: { status: "failed", error: { code: "render_error", message: "boom" } } });
  assert.equal(fail.phase, "failed");
  assert.equal(fail.errorCode, "render_error");
  assert.equal(fail.errorMessage, "boom");
});

test("normalizeVideoList: títulado, fase por ítem y sin id afuera", () => {
  const items = normalizeVideoList({
    data: {
      videos: [
        { video_id: "v1", title: "Spot", status: "completed", video_url: "https://x/1.mp4", created_at: "2026-10-26T10:00:00Z" },
        { id: "v2", status: "pending" },
        { status: "completed" },
      ],
    },
  });
  assert.equal(items.length, 2);
  assert.deepEqual(
    { videoId: items[0].videoId, title: items[0].title, phase: items[0].phase, url: items[0].videoUrl, createdAt: items[0].createdAt },
    { videoId: "v1", title: "Spot", phase: "ready", url: "https://x/1.mp4", createdAt: "2026-10-26T10:00:00Z" },
  );
  assert.equal(items[1].title, "Video");
  assert.equal(items[1].phase, "queued");
});

// ── Builders: validan ANTES de gastar un crédito ─────────────────────────────

test("buildAvatarVideoBody: body mínimo type avatar + script", () => {
  const body = buildAvatarVideoBody({ avatarId: "l1", script: "Hola" });
  assert.deepEqual(body, { type: "avatar", avatar_id: "l1", script: "Hola" });
  // Sin voice_id: HeyGen cae a la voz del clon, que es lo querido.
  assert.ok(!("voice_id" in body));
});

test("buildAvatarVideoBody: extras opcionales y recortes", () => {
  const body = buildAvatarVideoBody({
    avatarId: "l1",
    script: "  guion  ",
    aspectRatio: aspectForTakeFormat("portrait"),
    voiceId: "v9",
    title: "x".repeat(200),
    resolution: "1080p",
    outputFormat: "mp4",
  });
  assert.equal(body.script, "guion");
  assert.equal(body.aspect_ratio, "4:5");
  assert.equal(body.voice_id, "v9");
  assert.equal(body.title.length, 120);
  assert.equal(body.resolution, "1080p");
  assert.equal(body.output_format, "mp4");

  // output_format que no sea mp4/webm se ignora (no lo inventamos).
  const avi = buildAvatarVideoBody({ avatarId: "l1", script: "s", outputFormat: "avi" });
  assert.ok(!("output_format" in avi));
});

test("buildAvatarVideoBody: errores explícitos con código estable", () => {
  const cases = [
    [{ avatarId: "", script: "hola" }, "HEYGEN_AVATAR_REQUIRED"],
    [{ avatarId: "l1", script: "   " }, "HEYGEN_SCRIPT_REQUIRED"],
    [{ avatarId: "l1", script: "hola", aspectRatio: "3:2" }, "HEYGEN_ASPECT_INVALID"],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => buildAvatarVideoBody(input),
      err => err instanceof HeygenMapError && err.code === code && err.message.length > 5,
    );
  }
});

test("buildDigitalTwinBody: pide nombre y URL http(s) pública", () => {
  assert.deepEqual(
    buildDigitalTwinBody({ name: "Mi clon", videoUrl: "https://pub.r2/1.webm" }),
    { type: "digital_twin", name: "Mi clon", file: { type: "url", url: "https://pub.r2/1.webm" } },
  );
  assert.equal(buildDigitalTwinBody({ name: "n".repeat(200), videoUrl: "https://x/y" }).name.length, 80);
  assert.throws(() => buildDigitalTwinBody({ name: " ", videoUrl: "https://x/y" }), e => e.code === "HEYGEN_NAME_REQUIRED");
  // Un link de R2 sin firmar / relativo no sirve: HeyGen responde download_failed.
  assert.throws(() => buildDigitalTwinBody({ name: "c", videoUrl: "/api/x" }), e => e.code === "HEYGEN_SOURCE_URL_REQUIRED");
  assert.throws(() => buildDigitalTwinBody({ name: "c", videoUrl: "ftp://x/y" }), e => e.code === "HEYGEN_SOURCE_URL_REQUIRED");
});

// ── Errores de upstream ──────────────────────────────────────────────────────

test("heygenErrorPayload: cada fallo de HeyGen tiene código humano y estable", () => {
  assert.equal(heygenErrorPayload(401, { error: { code: "unauthorized", message: "bad key" } }).error, "HEYGEN_KEY_INVALID");
  assert.equal(heygenErrorPayload(403, {}).error, "HEYGEN_KEY_INVALID");
  assert.equal(heygenErrorPayload(402, { detail: "not enough credits" }).error, "HEYGEN_NO_CREDITS");
  assert.equal(heygenErrorPayload(200, { error: { code: "QUOTA_EXCEEDED" } }).error, "HEYGEN_NO_CREDITS");
  assert.equal(heygenErrorPayload(429, {}).error, "HEYGEN_RATE_LIMITED");
  assert.equal(heygenErrorPayload(404, { error: { message: "video not found" } }).error, "HEYGEN_NOT_FOUND");
  assert.equal(heygenErrorPayload(400, { error: { code: "download_failed" } }).error, "HEYGEN_DOWNLOAD_FAILED");
  assert.equal(heygenErrorPayload(503, {}).error, "HEYGEN_UPSTREAM");
  const generic = heygenErrorPayload(400, { error: { code: "avatar_unavailable", message: "el avatar no está listo" } });
  assert.equal(generic.error, "HEYGEN_AVATAR_UNAVAILABLE");
  assert.equal(generic.message, "el avatar no está listo");
  // Ningún mensaje puede filtrar la key.
  assert.ok(!JSON.stringify(heygenErrorPayload(401, { error: { message: "sk_secret123 rechazada" } })).includes("sk_secret123"));
});

// ── Guiones del LLM ──────────────────────────────────────────────────────────

test("buildScriptPrompt: tema, tono, techo de segundos y contrato JSON", () => {
  const p = buildScriptPrompt("lanzo mi marca de café", "cálido", 60);
  assert.ok(p.includes("lanzo mi marca de café"));
  assert.ok(p.includes("cálido"));
  assert.ok(p.includes("60 segundos"));
  assert.ok(p.includes('{"scripts":[{"title":"...","text":"..."}]}'));
  assert.ok(p.includes("TRES"));
  // El techo se acota al rango útil (ni 5 ni 900 segundos).
  assert.ok(buildScriptPrompt("t", null, 5).includes("15 segundos"));
  assert.ok(buildScriptPrompt("t", null, 900).includes("180 segundos"));
  assert.ok(!buildScriptPrompt("t", "   ", 45).includes("Tono pedido"));
});

test("parseScriptsResponse: JSON limpio, con cerca y con prosa alrededor", () => {
  const clean = parseScriptsResponse({ text: '{"scripts":[{"title":"A","text":"uno dos tres"},{"title":"B","text":"cuatro"}]}' });
  assert.equal(clean.length, 2);
  assert.deepEqual(clean[0], { title: "A", text: "uno dos tres", words: 3, estSeconds: scriptEstimateSeconds(3) });

  const fenced = parseScriptsResponse({ text: "Aquí tienes:\n```json\n[{\"title\":\"X\",\"script\":\"palabra otra\"}]\n```" });
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0].title, "X");
  assert.equal(fenced[0].text, "palabra otra");

  // Claves alternate y título ausente → numeración honesta, no centinela.
  const alt = parseScriptsResponse({ text: '{"guiones":[{"titulo":"Y","guion":"hola"}]}' });
  assert.deepEqual(alt, [{ title: "Y", text: "hola", words: 1, estSeconds: scriptEstimateSeconds(1) }]);
  const noTitle = parseScriptsResponse({ text: '{"scripts":[{"text":"solo texto"},{"text":"otro texto"}]}' });
  assert.deepEqual(noTitle.map(s => s.title), ["Guion 1", "Guion 2"]);
});

test("parseScriptsResponse: Anthropic content[] y OpenAI choices[] también", () => {
  const anthropic = parseScriptsResponse({ content: [{ type: "text", text: '{"scripts":[{"text":"a b"}]}' }] });
  assert.equal(anthropic[0].text, "a b");
  const openai = parseScriptsResponse({ choices: [{ message: { content: '{"scripts":[{"text":"c d e"}]}' } }] });
  assert.equal(openai[0].words, 3);
});

test("parseScriptsResponse: basura o guiones vacíos lanzan, no devuelven texto roto", () => {
  for (const raw of [{}, "no hay json", { text: "Lo siento, no puedo." }, { text: '{"scripts":[]}' }, { text: '{"scripts":[{"text":"   "}]}' }]) {
    assert.throws(() => parseScriptsResponse(raw), err => err instanceof HeygenMapError && err.code === "HEYGEN_SCRIPTS_UNPARSEABLE", String(JSON.stringify(raw)));
  }
  // Tope de 6: el modelo podría traer de más y la UI muestra tres.
  const many = parseScriptsResponse({ text: JSON.stringify({ scripts: Array.from({ length: 12 }, (_, i) => ({ text: `t${i}` })) }) });
  assert.equal(many.length, 6);
});

test("extractTextFromLlmResponse: las tres formas conocidas y nada más", () => {
  assert.equal(extractTextFromLlmResponse({ text: "plano" }), "plano");
  assert.equal(extractTextFromLlmResponse({ content: "string" }), "string");
  assert.equal(extractTextFromLlmResponse({ content: [{ text: "p" }, { text: "q" }] }), "p\nq");
  assert.equal(extractTextFromLlmResponse({ choices: [{ message: { content: "oai" } }] }), "oai");
  assert.equal(extractTextFromLlmResponse({ nonsense: 1 }), "");
  assert.equal(extractTextFromLlmResponse(null), "");
});

test("countScriptWords / scriptEstimateSeconds: mismo ritmo que el teleprompter", () => {
  assert.equal(SCRIPT_WORDS_PER_MIN, 150);
  assert.equal(countScriptWords(""), 0);
  assert.equal(countScriptWords("  a  b  "), 2);
  assert.equal(scriptEstimateSeconds(150), 60);
  assert.equal(scriptEstimateSeconds(0), 0);
});
