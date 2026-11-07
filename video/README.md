# Відео-навчалка для власника

Горизонтальне відео 1920×1080 (~3,5 хв) «Огляд сайту для власника», як на екрані компʼютера.
Зроблене на [Remotion](https://remotion.dev). У кадрах — лише **тестові** дані (`tools/video-data.js`),
справжня база не використовується.

## Як оновити відео після змін на сайті

```bash
# 1) нові кадри з сайту (з кореня проєкту)
node tools/video-capture.js

# 2) озвучка українською (ElevenLabs) — з папки video/, ключ у video/.env: ELEVENLABS_API_KEY=...
#    текст — у src/narration.json
node scripts/voice.mjs voices          # проби українських голосів → out/samples/
node scripts/voice.mjs make <voice_id> # озвучити все
node scripts/voice.mjs update          # лише нові/змінені фрази (економить кредити)

# 3) перегляд у браузері
cd video && npm i && npm run dev

# 4) готовий файл → video/out/owner-guide.mp4
npx remotion render OwnerGuide out/owner-guide.mp4 --codec=h264 --crf=22
```

Підписи кроків — у `src/owner.ts`, текст озвучки — у `src/narration.json`, вигляд — у `src/Tour.tsx`.

Ліцензія Remotion безкоштовна для фізичних осіб і компаній до 3 працівників
(<https://remotion.pro/license>).
