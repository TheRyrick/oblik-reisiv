import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Audio } from "@remotion/media";
import { loadFont as loadOnest } from "@remotion/google-fonts/Onest";
import { loadFont as loadUnbounded } from "@remotion/google-fonts/Unbounded";

const { fontFamily: body } = loadOnest("normal", {
  weights: ["400", "500", "600"],
  subsets: ["cyrillic", "latin"],
});
const { fontFamily: display } = loadUnbounded("normal", {
  weights: ["600", "700"],
  subsets: ["cyrillic", "latin"],
});

// Кольори сайту
const C = {
  bg: "#12161b",
  ink: "#f4f5f7",
  muted: "#aeb6c2",
  signal: "#efba18",
  chrome: "#1c2128",
};

export const FPS = 30;
export const W = 1920;
export const H = 1080;
const SCENE = 135; // 4,5 с на крок
const INTRO = 120;
const OUTRO = 120;
const FADE = 15;

export type Rect = { x: number; y: number; w: number; h: number } | null;
export type Step = {
  img: string;
  title: string;
  text: string;
  rect?: Rect;
  tap?: boolean; // пульсуюче коло «натисни тут»
  then?: string; // після натискання показати другий кадр
  dur?: number;
};
export type TourConfig = {
  folder: string;
  size: { w: number; h: number };
  intro: { line1: string; line2: string; subtitle: string; note: string };
  outro: string[];
  steps: Step[];
  // озвучка: тривалість кожної фрази в секундах (0 — без звуку); файли — public/<folder>/voice/<id>.mp3
  voice: Record<string, number>;
};

// Звук починається трохи після появи сцени; сцена триває, поки звучить фраза (+ пауза)
const VOICE_START = 12;
const voiceId = (i: number) => `s${String(i + 1).padStart(2, "0")}`;
const fit = (g: TourConfig, id: string, base: number) => {
  const sec = g.voice[id] ?? 0;
  return sec > 0
    ? Math.max(base, VOICE_START + Math.ceil(sec * FPS) + 18)
    : base;
};
const introDur = (g: TourConfig) => fit(g, "intro", INTRO);
const outroDur = (g: TourConfig) => fit(g, "outro", OUTRO);
const stepDur = (g: TourConfig, i: number) =>
  fit(g, voiceId(i), g.steps[i].dur ?? SCENE);

export const durationOf = (g: TourConfig) =>
  introDur(g) +
  outroDur(g) +
  g.steps.reduce((n, _s, i) => n + stepDur(g, i), 0) -
  FADE * (g.steps.length + 1);

const Voice: React.FC<{ g: TourConfig; id: string }> = ({ g, id }) =>
  (g.voice[id] ?? 0) > 0 ? (
    <Sequence from={VOICE_START} layout="none" name={`Голос ${id}`}>
      <Audio src={staticFile(`${g.folder}/voice/${id}.mp3`)} />
    </Sequence>
  ) : null;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const lim = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

// ---------- Вікно браузера ----------
const SCREEN_W = 1300;
const BAR = 40;
const BOX_TOP = 200;

const Browser: React.FC<{
  screenH: number;
  left: number;
  top: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ screenH, left, top, style, children }) => (
  <div
    style={{
      position: "absolute",
      left,
      top,
      width: SCREEN_W,
      borderRadius: 18,
      overflow: "hidden",
      background: C.chrome,
      boxShadow: "0 40px 120px rgba(0,0,0,.6), 0 0 0 1.5px #2f3640",
      ...style,
    }}
  >
    <div
      style={{
        height: BAR,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 18px",
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <div
          key={c}
          style={{ width: 13, height: 13, borderRadius: "50%", background: c }}
        />
      ))}
      <div
        style={{
          marginLeft: 22,
          height: 26,
          padding: "0 16px",
          borderRadius: 8,
          background: "#262c35",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: body,
          fontSize: 15,
          color: C.muted,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 3,
            background: C.signal,
          }}
        />
        Облік рейсів
      </div>
    </div>
    <div
      style={{
        position: "relative",
        width: SCREEN_W,
        height: screenH,
        overflow: "hidden",
        background: C.bg,
      }}
    >
      {children}
    </div>
  </div>
);

// Камера: плавно наближає підсвічене місце і тримає його ближче до центру
const useCamera = (rect: Rect, screenH: number) => {
  const frame = useCurrentFrame();
  const e = interpolate(frame, [12, 48], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const drift = interpolate(frame, [48, SCENE], [0, 0.03], clamp);
  const target = rect
    ? lim(0.62 / Math.max(rect.w, rect.h * 0.8), 1.06, 1.6)
    : 1.04;
  const z = 1 + (target - 1) * e + drift;
  const cx = rect ? rect.x + rect.w / 2 : 0.5;
  const cy = rect ? rect.y + rect.h / 2 : 0.5;
  const tx = lim(SCREEN_W / 2 - cx * SCREEN_W * z, SCREEN_W - SCREEN_W * z, 0);
  const ty = lim(screenH / 2 - cy * screenH * z, screenH - screenH * z, 0);
  return { z, tx, ty, cx, cy };
};

const Screen: React.FC<{ folder: string; step: Step; screenH: number }> = ({
  folder,
  step,
  screenH,
}) => {
  const frame = useCurrentFrame();
  const r = step.rect ?? null;
  const cam = useCamera(r, screenH);
  // другий кадр (наприклад, розрахунок після натискання)
  const thenOp = step.then ? interpolate(frame, [66, 78], [0, 1], clamp) : 0;
  return (
    <>
      <Img
        src={staticFile(`${folder}/${step.img}`)}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: SCREEN_W,
          height: screenH,
          transformOrigin: "0 0",
          transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.z})`,
        }}
      />
      {step.tap && r && thenOp < 1 ? (
        <Tap
          x={cam.tx + cam.cx * SCREEN_W * cam.z}
          y={cam.ty + cam.cy * screenH * cam.z}
          once={!!step.then}
          fadeOut={1 - thenOp}
        />
      ) : null}
      {step.then ? (
        <Img
          src={staticFile(`${folder}/${step.then}`)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: SCREEN_W,
            height: screenH,
            opacity: thenOp,
            // наближаємо вікно з розрахунком, щоб цифри було легко прочитати
            transformOrigin: "50% 20%",
            scale: String(
              interpolate(frame, [66, 78, 120], [1.02, 1, 1.38], {
                ...clamp,
                easing: Easing.inOut(Easing.cubic),
              }),
            ),
          }}
        />
      ) : null}
    </>
  );
};

// Пульсуюче коло «натисни тут»
const Tap: React.FC<{
  x: number;
  y: number;
  once: boolean;
  fadeOut: number;
}> = ({ x, y, once, fadeOut }) => {
  const frame = useCurrentFrame();
  const t = Math.max(0, frame - 46);
  const cycle = once ? Math.min(1, t / 26) : (t % 40) / 40;
  const visible = interpolate(frame, [40, 48], [0, 1], clamp) * fadeOut;
  const press = interpolate(cycle, [0, 0.15, 0.3], [1, 0.8, 1], clamp);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: x - 60,
          top: y - 60,
          width: 120,
          height: 120,
          borderRadius: "50%",
          border: `5px solid ${C.signal}`,
          opacity: visible * (1 - cycle),
          scale: String(0.5 + cycle * 0.9),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x - 28,
          top: y - 28,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(255,255,255,.85)",
          boxShadow: "0 6px 24px rgba(0,0,0,.45)",
          opacity: visible * 0.9,
          scale: String(press),
        }}
      />
    </>
  );
};

// ---------- Підписи ----------
const Caption: React.FC<{
  left: number;
  n: number;
  total: number;
  title: string;
  text: string;
}> = ({ left, n, total, title, text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const b = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  return (
    <div style={{ position: "absolute", left, right: left, top: 42 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 26 }}>
        <div
          style={{
            fontFamily: body,
            fontWeight: 600,
            fontSize: 26,
            color: C.signal,
            letterSpacing: 1,
            opacity: a,
            whiteSpace: "nowrap",
          }}
        >
          {n} / {total}
        </div>
        <div
          style={{
            fontFamily: display,
            fontWeight: 700,
            fontSize: 54,
            lineHeight: 1.1,
            color: C.ink,
            opacity: a,
            translate: `0 ${(1 - a) * 20}px`,
          }}
        >
          {title}
        </div>
      </div>
      <div
        style={{
          fontFamily: body,
          fontWeight: 500,
          fontSize: 32,
          whiteSpace: "nowrap",
          lineHeight: 1.3,
          color: C.muted,
          marginTop: 14,
          opacity: b,
          translate: `0 ${(1 - b) * 14}px`,
        }}
      >
        {text}
      </div>
    </div>
  );
};

const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(80% 70% at 50% 120%, rgba(239,186,24,.14), transparent 60%), ${C.bg}`,
    }}
  />
);

// ---------- Заставка і фінал ----------
const Logo: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.28,
      background: C.signal,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <svg
      width={size * 0.6}
      height={size * 0.6}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#1b1606"
      strokeWidth={2.2}
      strokeLinecap="round"
    >
      <path d="M4.5 21 9.5 3" />
      <path d="M19.5 21 14.5 3" />
      <path d="M12 21V3" strokeDasharray="3.2 3.2" />
    </svg>
  </div>
);

const Intro: React.FC<{ g: TourConfig; screenH: number }> = ({
  g,
  screenH,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 14 } });
  const b = spring({ frame: frame - 10, fps, config: { damping: 200 } });
  const c = spring({ frame: frame - 20, fps, config: { damping: 200 } });
  const d = spring({ frame: frame - 24, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", left: 140, width: 720, top: 230 }}>
        <div style={{ scale: String(a), transformOrigin: "left center" }}>
          <Logo size={120} />
        </div>
        <div
          style={{
            fontFamily: display,
            fontWeight: 700,
            fontSize: 92,
            lineHeight: 1.05,
            color: C.ink,
            marginTop: 50,
            opacity: b,
            translate: `0 ${(1 - b) * 40}px`,
          }}
        >
          {g.intro.line1}
          <br />
          <span style={{ color: C.signal }}>{g.intro.line2}</span>
        </div>
        <div
          style={{
            fontFamily: body,
            fontWeight: 500,
            fontSize: 40,
            color: C.muted,
            marginTop: 34,
            opacity: c,
          }}
        >
          {g.intro.subtitle}
        </div>
        <div
          style={{
            fontFamily: body,
            fontSize: 32,
            lineHeight: 1.4,
            color: C.muted,
            marginTop: 20,
            opacity: c * 0.85,
          }}
        >
          {g.intro.note}
        </div>
      </div>
      <Browser
        screenH={screenH}
        left={960}
        top={200}
        style={{
          opacity: d,
          translate: `${(1 - d) * 200}px 0`,
          transformOrigin: "0 50%",
          transform: "perspective(2400px) rotateY(-14deg) scale(.86)",
        }}
      >
        <Img
          src={staticFile(`${g.folder}/00-home.png`)}
          style={{ width: SCREEN_W, height: screenH }}
        />
      </Browser>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ lines: string[] }> = ({ lines }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 14 } });
  const b = spring({ frame: frame - 10, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ scale: String(a) }}>
          <Logo size={140} />
        </div>
        <div
          style={{
            fontFamily: display,
            fontWeight: 700,
            fontSize: 96,
            color: C.ink,
            marginTop: 50,
            opacity: b,
          }}
        >
          Готово!
        </div>
        <div
          style={{
            fontFamily: body,
            fontWeight: 500,
            fontSize: 42,
            lineHeight: 1.4,
            color: C.muted,
            marginTop: 24,
            textAlign: "center",
            opacity: b,
          }}
        >
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- Відео ----------
export const TourVideo: React.FC<{ g: TourConfig }> = ({ g }) => {
  const screenH = Math.round((SCREEN_W * g.size.h) / g.size.w);
  const left = (W - SCREEN_W) / 2;
  const items: React.ReactNode[] = [
    <TransitionSeries.Sequence
      key="intro"
      name="Заставка"
      durationInFrames={introDur(g)}
    >
      <Intro g={g} screenH={screenH} />
      <Voice g={g} id="intro" />
    </TransitionSeries.Sequence>,
  ];
  g.steps.forEach((s, i) => {
    items.push(
      <TransitionSeries.Transition
        key={`t${i}`}
        presentation={fade()}
        timing={linearTiming({ durationInFrames: FADE })}
      />,
      <TransitionSeries.Sequence
        key={`s${i}`}
        name={s.title}
        durationInFrames={stepDur(g, i)}
      >
        <Voice g={g} id={voiceId(i)} />
        <AbsoluteFill>
          <Backdrop />
          <Browser screenH={screenH} left={left} top={BOX_TOP}>
            <Screen folder={g.folder} step={s} screenH={screenH} />
          </Browser>
          <Caption
            left={left}
            n={i + 1}
            total={g.steps.length}
            title={s.title}
            text={s.text}
          />
        </AbsoluteFill>
      </TransitionSeries.Sequence>,
    );
  });
  items.push(
    <TransitionSeries.Transition
      key="tend"
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />,
    <TransitionSeries.Sequence
      key="outro"
      name="Фінал"
      durationInFrames={outroDur(g)}
    >
      <Outro lines={g.outro} />
      <Voice g={g} id="outro" />
    </TransitionSeries.Sequence>,
  );
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <TransitionSeries>{items}</TransitionSeries>
    </AbsoluteFill>
  );
};
