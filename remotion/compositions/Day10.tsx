import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  Video,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const TURQUOISE = "#0FB5AE";
const TURQUOISE_DARK = "#0A8F89";
const INK = "#0E2A2A";

const FONT = "'Helvetica Neue', Arial, 'Noto Sans', sans-serif";

// ---------- Caption ----------

const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          bottom: "24%",
          width: "88%",
          textAlign: "center",
          opacity,
        }}
      >
        <span
          style={{
            display: "inline",
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 54,
            lineHeight: 1.25,
            color: "white",
            background: "rgba(14,42,42,0.55)",
            padding: "10px 22px",
            borderRadius: 18,
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {text}
        </span>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Logo ----------

const Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 0.9], {
    extrapolateRight: "clamp",
  });
  return (
    <Img
      src={staticFile("day-10/logo.png")}
      style={{
        position: "absolute",
        top: 48,
        right: 48,
        width: "9%",
        opacity,
        borderRadius: 999,
      }}
    />
  );
};

// ---------- Real-footage scene ----------
// Plays the clip at its exact natural length — no freeze-hold, no pan, no zoom.
// Every previous attempt to stretch these clips past their real ~149 frames
// (frozen-frame hold, punch-in reframe, Ken Burns zoom) read as artificial —
// a still image being nudged around is not real motion, and it showed. This
// version only ever displays genuine, continuous, unmodified video motion.
const VideoScene: React.FC<{ src: string }> = ({ src }) => {
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: INK }}>
      <Video src={src} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0) 62%, rgba(10,20,20,0.5) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// ---------- Myth-busting graphic scene: 3 badges (instruction / speech / confidence) ----------

const BADGES = [
  { emoji: "📋", label: "Yo'riqnomani tushunish" },
  { emoji: "🗣️", label: "Gapira olish" },
  { emoji: "💪", label: "Ishonch bilan javob" },
];

const Badge: React.FC<{ index: number; entranceFrame: number }> = ({ index, entranceFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - entranceFrame;
  const s = spring({ frame: local, fps, config: { damping: 12, mass: 0.7 } });
  const translateY = interpolate(s, [0, 1], [80, 0]);
  const opacity = interpolate(local, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const badge = BADGES[index];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        width: "78%",
        background: "white",
        borderRadius: 20,
        padding: "20px 28px",
        boxShadow: "0 14px 30px rgba(0,0,0,0.25)",
        transform: `translateY(${translateY}px)`,
        opacity,
      }}
    >
      <div style={{ fontSize: 48 }}>{badge.emoji}</div>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 32, color: INK }}>
        {badge.label}
      </div>
    </div>
  );
};

const MythBustScene: React.FC<{ segmentFrames: number }> = ({ segmentFrames }) => {
  const frame = useCurrentFrame();
  const entrances = [8, 32, 56];
  // Safe to zoom here — this is rendered graphics, not AI video pixels, so
  // there's no fine-detail "boiling" for a zoom to magnify.
  const zoom = 1 + interpolate(frame, [0, segmentFrames], [0, 0.05], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${TURQUOISE_DARK} 0%, ${TURQUOISE} 100%)`,
        justifyContent: "center",
        alignItems: "center",
        gap: 22,
        transform: `scale(${zoom})`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "14%",
          width: "84%",
          textAlign: "center",
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 36,
          color: "white",
          opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        Tayyorgarlikda muhimi:
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {BADGES.map((_, i) => (
          <Badge key={i} index={i} entranceFrame={entrances[i]} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---------- CTA scene (share, not sell) ----------

const CtaScene: React.FC<{ segmentFrames: number }> = ({ segmentFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 11, mass: 0.7 } });
  const translateY = interpolate(s, [0, 1], [50, 0]);
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const iconSpring = spring({ frame: frame - 10, fps, config: { damping: 10 } });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${TURQUOISE} 0%, ${TURQUOISE_DARK} 100%)`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          opacity,
          transform: `translateY(${translateY}px)`,
          width: "84%",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 64, transform: `scale(${iconSpring})` }}>📤</div>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: 48,
            lineHeight: 1.25,
            color: "white",
            textShadow: "0 6px 24px rgba(0,0,0,0.25)",
          }}
        >
          Maktabga ko'chayotgan oilaga yuboring
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Root composition ----------

// Composition now runs at the clips' NATIVE 24fps (see Root.tsx) — zero fps
// conversion of any kind, so no minterpolate, no frame duplication, nothing
// that can introduce artifacts. This turned out to be the actual root cause
// of the persistent shimmer: minterpolate's optical-flow interpolation (used
// to force the 24fps clips into a 30fps timeline) was itself "melting" fine
// hair detail — the untouched source was always clean (confirmed by the user
// watching the raw files directly). Real video only covers the first ~15s;
// graphics cover the rest. Captions are deliberately decoupled from the
// visual cuts below — they just keep following the voiceover's word pace.
const CLIP_FRAMES = 121; // true native length of the untouched Kling clips
const VIDEO_A = CLIP_FRAMES;
const VIDEO_B = CLIP_FRAMES;
const VIDEO_C = CLIP_FRAMES;
const GRAPHIC_START = VIDEO_A + VIDEO_B + VIDEO_C; // 363
const MYTH_BUST = 240; // 363 - 603
const CTA = 113; // 603 - 716

// Caption track, rescaled ×24/30 from the 30fps timing so real-world seconds
// stay the same as before (this composition is now 24fps, not 30fps).
const CAP1A = 98; // "Yaxshi baho — rus maktabiga tayyor degani emas."
const CAP1B = 83; // "Baho faqat fanni qanchalik bilishini ko'rsatadi."
const CAP2A = 70; // "Lekin ko'chib borishda muhimi boshqa —"
const CAP2B = 153; // "bola yo'riqnomani tushunishi, gapira olishi va ishonch bilan javob berishi kerak."
const CAP3A = 70; // "Ko'p bolalar besh baho oladi,"
const CAP3B = 98; // "lekin yangi maktabda birinchi kunidayoq adashib qoladi."
const CAP4 = 83; // "Shuning uchun tayyorgarlik faqat baholarda emas."
const CAP5 = 61; // "Maktabga ko'chayotgan oilaga yuboring."

export const Day10: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Audio src={staticFile("day-10/voiceover.mp3")} />

      {/* Visual track */}
      <Sequence from={0} durationInFrames={VIDEO_A}>
        <VideoScene src={staticFile("day-10/clip-a.mp4")} />
      </Sequence>
      <Sequence from={VIDEO_A} durationInFrames={VIDEO_B}>
        <VideoScene src={staticFile("day-10/clip-b.mp4")} />
      </Sequence>
      <Sequence from={VIDEO_A + VIDEO_B} durationInFrames={VIDEO_C}>
        <VideoScene src={staticFile("day-10/clip-c.mp4")} />
      </Sequence>
      <Sequence from={GRAPHIC_START} durationInFrames={MYTH_BUST}>
        <MythBustScene segmentFrames={MYTH_BUST} />
      </Sequence>
      <Sequence from={GRAPHIC_START + MYTH_BUST} durationInFrames={CTA}>
        <CtaScene segmentFrames={CTA} />
      </Sequence>

      {/* Caption track */}
      <Sequence from={0} durationInFrames={CAP1A}>
        <Caption text="Yaxshi baho — rus maktabiga tayyor degani emas." />
      </Sequence>
      <Sequence from={CAP1A} durationInFrames={CAP1B}>
        <Caption text="Baho faqat fanni qanchalik bilishini ko'rsatadi." />
      </Sequence>
      <Sequence from={CAP1A + CAP1B} durationInFrames={CAP2A}>
        <Caption text="Lekin ko'chib borishda muhimi boshqa —" />
      </Sequence>
      <Sequence from={CAP1A + CAP1B + CAP2A} durationInFrames={CAP2B}>
        <Caption text="bola yo'riqnomani tushunishi, gapira olishi va ishonch bilan javob berishi kerak." />
      </Sequence>
      <Sequence from={CAP1A + CAP1B + CAP2A + CAP2B} durationInFrames={CAP3A}>
        <Caption text="Ko'p bolalar besh baho oladi," />
      </Sequence>
      <Sequence from={CAP1A + CAP1B + CAP2A + CAP2B + CAP3A} durationInFrames={CAP3B}>
        <Caption text="lekin yangi maktabda birinchi kunidayoq adashib qoladi." />
      </Sequence>
      <Sequence
        from={CAP1A + CAP1B + CAP2A + CAP2B + CAP3A + CAP3B}
        durationInFrames={CAP4}
      >
        <Caption text="Shuning uchun tayyorgarlik faqat baholarda emas." />
      </Sequence>
      <Sequence
        from={CAP1A + CAP1B + CAP2A + CAP2B + CAP3A + CAP3B + CAP4}
        durationInFrames={CAP5}
      >
        <Caption text="Maktabga ko'chayotgan oilaga yuboring." />
      </Sequence>

      <Sequence from={20} durationInFrames={GRAPHIC_START + MYTH_BUST + CTA - 20}>
        <Logo />
      </Sequence>
    </AbsoluteFill>
  );
};

export const DAY10_TOTAL_FRAMES = GRAPHIC_START + MYTH_BUST + CTA;
