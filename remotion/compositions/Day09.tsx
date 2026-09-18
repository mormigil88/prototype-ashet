import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";

const TURQUOISE = "#0FB5AE";
const TURQUOISE_DARK = "#0A8F89";
const INK = "#0E2A2A";

const FONT =
  "'Helvetica Neue', Arial, 'Noto Sans', sans-serif";

// ---------- Caption ----------

const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        top: undefined,
      }}
    >
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
            fontSize: 58,
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
      src={staticFile("day-09/logo.png")}
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

// ---------- Scene 1: Hook ----------

const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const badgeOpacity = interpolate(frame, [20, 35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
          transform: `scale(${0.85 + scale * 0.15})`,
          opacity: interpolate(frame, [0, 10], [0, 1], {
            extrapolateRight: "clamp",
          }),
          width: "92%",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: 60,
            lineHeight: 1.2,
            color: "white",
            textShadow: "0 6px 24px rgba(0,0,0,0.25)",
            whiteSpace: "nowrap",
          }}
        >
          Oddiy dars va qiziqarli dars
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: 60,
            lineHeight: 1.2,
            color: "white",
            textShadow: "0 6px 24px rgba(0,0,0,0.25)",
            whiteSpace: "nowrap",
          }}
        >
          o'rtasidagi farq
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "28%",
          display: "flex",
          gap: 28,
          opacity: badgeOpacity,
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 34,
            color: TURQUOISE_DARK,
            background: "white",
            borderRadius: 999,
            padding: "12px 26px",
          }}
        >
          😴 Zerikarli
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 34,
            color: "white",
            background: "rgba(255,255,255,0.18)",
            border: "3px solid white",
            borderRadius: 999,
            padding: "12px 26px",
          }}
        >
          ✨ Qiziqarli
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 2: Diptych pan (bored -> curious) ----------

const DiptychPan: React.FC<{ segmentFrames: number }> = ({
  segmentFrames,
}) => {
  const frame = useCurrentFrame();

  // Pan from top half (0..1 -> 0) to bottom half (1 -> -50%) around the midpoint,
  // with a smooth ease-in-out transition, then continue slow zoom throughout.
  const mid = segmentFrames / 2;
  const panWindow = 30; // ~1s transition around the midpoint
  const panProgress = interpolate(
    frame,
    [mid - panWindow / 2, mid + panWindow / 2],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    },
  );
  const translateY = interpolate(panProgress, [0, 1], [0, -50]);

  const zoom = 1 + interpolate(frame, [0, segmentFrames], [0, 0.08], {
    extrapolateRight: "clamp",
  });

  const badgeOpacityTop = interpolate(frame, [10, 25, mid - 15, mid], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const badgeOpacityBottom = interpolate(
    frame,
    [mid, mid + 20, segmentFrames - 15, segmentFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: INK }}>
      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "200%",
          transform: `translateY(${translateY}%) scale(${zoom})`,
          transformOrigin: "center center",
        }}
      >
        <Img
          src={staticFile("day-09/scene-a-diptych.png")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          top: "12%",
          left: "8%",
          opacity: badgeOpacityTop,
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 32,
          color: INK,
          background: "white",
          borderRadius: 999,
          padding: "10px 22px",
        }}
      >
        📖 10 marta takrorlash
      </div>

      <div
        style={{
          position: "absolute",
          top: "12%",
          left: "8%",
          opacity: badgeOpacityBottom,
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 32,
          color: "white",
          background: TURQUOISE_DARK,
          borderRadius: 999,
          padding: "10px 22px",
        }}
      >
        🎨 Rasmni tanlash
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 3: motion-graphic cards assembling a sentence ----------

const CARD_DATA = [
  { emoji: "🧒", label: "Bola", color: "#0FB5AE" },
  { emoji: "🏃", label: "Yuguradi", color: "#F2A93B" },
  { emoji: "🏡", label: "Uyga", color: "#E85D75" },
];

const SentenceCard: React.FC<{ index: number; entranceFrame: number }> = ({
  index,
  entranceFrame,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - entranceFrame;
  const s = spring({
    frame: local,
    fps,
    config: { damping: 12, mass: 0.7 },
  });
  const translateY = interpolate(s, [0, 1], [220, 0]);
  const opacity = interpolate(local, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const card = CARD_DATA[index];

  return (
    <div
      style={{
        width: 220,
        height: 260,
        borderRadius: 28,
        background: "white",
        boxShadow: "0 18px 40px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        transform: `translateY(${translateY}px) scale(${0.9 + s * 0.1})`,
        opacity,
        border: `6px solid ${card.color}`,
      }}
    >
      <div style={{ fontSize: 96 }}>{card.emoji}</div>
      <div
        style={{
          marginTop: 14,
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 30,
          color: INK,
        }}
      >
        {card.label}
      </div>
    </div>
  );
};

const SentenceBuildScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrances = [10, 35, 60];
  const checkFrame = 100;
  const checkS = spring({
    frame: frame - checkFrame,
    fps,
    config: { damping: 10 },
  });
  const checkOpacity = interpolate(frame, [checkFrame, checkFrame + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${TURQUOISE_DARK} 0%, ${TURQUOISE} 100%)`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "16%",
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 40,
          color: "white",
          opacity: interpolate(frame, [0, 12], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Bola o'zi jumla tuzadi
      </div>
      <div style={{ display: "flex", gap: 26 }}>
        {CARD_DATA.map((_, i) => (
          <SentenceCard key={i} index={i} entranceFrame={entrances[i]} />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "40%",
          fontSize: 70,
          transform: `scale(${checkS})`,
          opacity: checkOpacity,
        }}
      >
        ✅
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 4: success photo + CTA ----------

const SuccessCta: React.FC<{ segmentFrames: number; ctaStartFrame: number }> = ({
  segmentFrames,
  ctaStartFrame,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = 1 + interpolate(frame, [0, segmentFrames], [0, 0.1], {
    extrapolateRight: "clamp",
  });

  const ctaLocal = frame - ctaStartFrame;
  const ctaSpring = spring({
    frame: ctaLocal,
    fps,
    config: { damping: 11, mass: 0.7 },
  });
  const ctaOpacity = interpolate(ctaLocal, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ctaTranslate = interpolate(ctaSpring, [0, 1], [60, 0]);

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: INK }}>
      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          transform: `scale(${zoom})`,
          transformOrigin: "center center",
        }}
      >
        <Img
          src={staticFile("day-09/scene-c-success.png")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(10,20,20,0.55) 100%)",
        }}
      />

      {ctaLocal >= 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "24%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18,
            opacity: ctaOpacity,
            transform: `translateY(${ctaTranslate}px)`,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 800,
              fontSize: 44,
              color: "white",
              textAlign: "center",
              textShadow: "0 4px 16px rgba(0,0,0,0.4)",
            }}
          >
            Qaysi usul bolangizga mos?
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: 999,
                background: "white",
                color: TURQUOISE_DARK,
                fontFamily: FONT,
                fontWeight: 900,
                fontSize: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
              }}
            >
              1
            </div>
            <div
              style={{
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: 40,
                color: "white",
                alignSelf: "center",
              }}
            >
              yoki
            </div>
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: 999,
                background: TURQUOISE,
                color: "white",
                fontFamily: FONT,
                fontWeight: 900,
                fontSize: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                border: "4px solid white",
              }}
            >
              2
            </div>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------- Root composition ----------

const S1 = 125; // 0.00 - 4.16s hook
const S2A = 188; // 4.16 - 10.44s bored (part of diptych pan)
const S2B = 163; // 10.44 - 15.88s curious (part of diptych pan)
const S2 = S2A + S2B; // full diptych scene length
const S3 = 272; // 15.88 - 24.92s sentence build
const S4 = 175; // 24.92 - 30.75s success + CTA (CTA badge appears ~1.2s in)

export const Day09: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Audio src={staticFile("day-09/voiceover.mp3")} />

      <Sequence from={0} durationInFrames={S1}>
        <HookScene />
      </Sequence>

      <Sequence from={S1} durationInFrames={S2}>
        <DiptychPan segmentFrames={S2} />
      </Sequence>
      <Sequence from={S1} durationInFrames={S2A}>
        <Caption text="Birinchi bola bir xil so'zni o'n marta takrorlaydi va tezda zerikadi." />
      </Sequence>
      <Sequence from={S1 + S2A} durationInFrames={S2B}>
        <Caption text="Ikkinchi bola rangli rasmni tanlaydi va o'zi jumla tuzadi." />
      </Sequence>

      <Sequence from={S1 + S2} durationInFrames={S3}>
        <SentenceBuildScene />
      </Sequence>
      <Sequence from={S1 + S2} durationInFrames={140}>
        <Caption text="Ikkalasi ham bir xil vaqt sarflaydi," />
      </Sequence>
      <Sequence from={S1 + S2 + 140} durationInFrames={S3 - 140}>
        <Caption text="lekin natija boshqacha — tushunib gapiradi." />
      </Sequence>

      <Sequence from={S1 + S2 + S3} durationInFrames={S4}>
        <SuccessCta segmentFrames={S4} ctaStartFrame={36} />
      </Sequence>

      <Sequence from={20} durationInFrames={S1 + S2 + S3 + S4 - 20}>
        <Logo />
      </Sequence>
    </AbsoluteFill>
  );
};

export const DAY09_TOTAL_FRAMES = S1 + S2 + S3 + S4;
