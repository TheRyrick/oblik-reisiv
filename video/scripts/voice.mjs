#!/usr/bin/env node
/*
 * Озвучка українською через ElevenLabs (модель eleven_v3 — живі інтонації й паузи).
 * Ключ — у файлі video/.env рядком ELEVENLABS_API_KEY=... (файл не йде на гіт; ключ ніде не друкується).
 *
 *   node scripts/voice.mjs voices            — знайти українські голоси й записати проби в out/samples/
 *   node scripts/voice.mjs make <voice_id>   — озвучити весь текст із src/narration.json
 *   node scripts/voice.mjs update            — лише нові й змінені фрази тим самим голосом (економить кредити)
 *
 * Результат: public/owner/voice/<id>.mp3 + voice.json (тривалість кожної фрази) — відео підлаштовується саме.
 * У тексті можна ставити теги настрою англійською в дужках: [friendly], [excited], [warmly]…
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "owner", "voice");
const SAMPLES = path.join(ROOT, "out", "samples");
const API = "https://api.elevenlabs.io";
const MODEL = "eleven_v3";

function apiKey() {
  const env = path.join(ROOT, ".env");
  const fromFile = fs.existsSync(env)
    ? (fs.readFileSync(env, "utf8").match(/^\s*ELEVENLABS_API_KEY\s*=\s*["']?([^"'\s]+)/m) || [])[1]
    : "";
  const key = process.env.ELEVENLABS_API_KEY || fromFile;
  if (!key) {
    console.error("Немає ключа. Створи файл video/.env з рядком ELEVENLABS_API_KEY=твій_ключ");
    process.exit(2);
  }
  return key;
}
const KEY = apiKey();

async function api(pathname, init = {}) {
  const r = await fetch(API + pathname, { ...init, headers: { "xi-api-key": KEY, ...(init.headers || {}) } });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 400);
    throw Object.assign(new Error(`ElevenLabs ${r.status}: ${body}`), { status: r.status });
  }
  return r;
}

async function tts(voiceId, text, file) {
  const r = await api(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_192`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL, language_code: "uk", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

// Тривалість mp3 через ffprobe, який іде разом із Remotion
function seconds(file) {
  const cli = path.join(ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js");
  const out = execFileSync(process.execPath,
    [cli, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { cwd: ROOT, encoding: "utf8" });
  const s = parseFloat(out.trim().split(/\s+/).pop());
  if (!(s > 0)) throw new Error("Не вдалося виміряти " + file);
  return Math.round(s * 100) / 100;
}

const safe = (s) => s.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);

async function voices() {
  // Голоси з бібліотеки ElevenLabs, у яких рідна мова — українська
  const r = await api("/v1/shared-voices?page_size=30&language=uk&sort=usage_character_count_1y");
  const list = (await r.json()).voices || [];
  if (!list.length) { console.log("Українських голосів не знайдено."); return; }
  fs.mkdirSync(SAMPLES, { recursive: true });
  const text = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "narration.json"), "utf8")).intro;
  const picked = list.slice(0, 6);
  for (const v of picked) {
    const label = `${v.name} · ${v.gender || "?"} · ${v.age || ""} · ${v.use_case || ""}`.replace(/ · $/, "");
    const file = path.join(SAMPLES, `${safe(v.name)}.mp3`);
    try {
      await tts(v.voice_id, text, file);
    } catch (e) {
      // деякі голоси бібліотеки треба спершу додати собі в «My Voices»
      if (e.status !== 400 && e.status !== 404 && e.status !== 422) throw e;
      await api(`/v1/voices/add/${v.public_owner_id}/${v.voice_id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_name: v.name }),
      });
      await tts(v.voice_id, text, file);
    }
    console.log(`${v.voice_id}  ${label}\n   проба → ${file}`);
  }
}

async function make(voiceId) {
  if (!voiceId) { console.error("Вкажи голос: node scripts/voice.mjs make <voice_id>"); process.exit(2); }
  const lines = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "narration.json"), "utf8"));
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/\.(wav|mp3)$/.test(f)) fs.rmSync(path.join(OUT, f));
  const result = {};
  for (const [id, text] of Object.entries(lines)) {
    const file = path.join(OUT, id + ".mp3");
    await tts(voiceId, text, file);
    result[id] = seconds(file);
    console.log(`${id.padEnd(6)} ${result[id].toFixed(1)} с  ${text.slice(0, 60)}`);
  }
  fs.writeFileSync(path.join(OUT, "voice.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "voice-id.txt"), voiceId + "\n");
  fs.writeFileSync(path.join(OUT, "narration-done.json"), JSON.stringify(lines, null, 2) + "\n");
  console.log("Готово → " + OUT);
}

// Лише нові/змінені фрази: порівнюємо з narration-done.json (текст, який уже озвучено) — економить кредити
async function update() {
  const lines = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "narration.json"), "utf8"));
  const doneFile = path.join(OUT, "narration-done.json");
  const done = fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, "utf8")) : {};
  const voiceFile = path.join(OUT, "voice.json");
  const durs = fs.existsSync(voiceFile) ? JSON.parse(fs.readFileSync(voiceFile, "utf8")) : {};
  const voiceId = fs.readFileSync(path.join(OUT, "voice-id.txt"), "utf8").trim();
  const todo = Object.keys(lines).filter((id) => done[id] !== lines[id] || !fs.existsSync(path.join(OUT, id + ".mp3")));
  const chars = todo.reduce((a, id) => a + lines[id].length, 0);
  console.log(`Озвучую ${todo.length} фраз (~${chars} символів): ${todo.join(", ") || "нічого"}`);
  const result = {};
  for (const id of Object.keys(lines)) {
    if (todo.includes(id)) {
      const file = path.join(OUT, id + ".mp3");
      await tts(voiceId, lines[id], file);
      result[id] = seconds(file);
      done[id] = lines[id];
      fs.writeFileSync(doneFile, JSON.stringify(done, null, 2) + "\n");
      console.log(`${id.padEnd(9)} ${result[id].toFixed(1)} с  ${lines[id].slice(0, 60)}`);
    } else result[id] = durs[id];
  }
  // прибираємо фрази, яких більше немає в тексті
  for (const f of fs.readdirSync(OUT)) if (/\.mp3$/.test(f) && !(f.slice(0, -4) in lines)) fs.rmSync(path.join(OUT, f));
  for (const id of Object.keys(done)) if (!(id in lines)) delete done[id];
  fs.writeFileSync(doneFile, JSON.stringify(done, null, 2) + "\n");
  fs.writeFileSync(voiceFile, JSON.stringify(result, null, 2) + "\n");
  console.log("Готово → " + OUT);
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "voices") await voices();
  else if (cmd === "make") await make(arg);
  else if (cmd === "update") await update();
  else console.log("Команди: voices | make <voice_id> | update");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
