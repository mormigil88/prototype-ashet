import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  Easing,
} from "remotion";
import React from "react";
import "./index.css";

// ── Editorial Reel — 9:16 vertical video template ──────────────────────────────
// Kimi pipeline: design-spec → content-audit → render → MP4
// Props match editorial-renderer content mapping

export type EditorialReelProps = {
  // Content
  headline?: string;
  bodyText?: string;
  ctaText?: string;
  accentText?: string;
  // Background
  backgroundImage?: string;  // path to bg image in remotion/assets/
  backgroundColor?: string;   // fallback color
  // Branding
  logoImage?: string;        // path to logo
  // Style
  durationInSeconds?: number;
  palette?: {
    background?: string;
    primary?: string;
    secondary?: string;
    accent?: string;
    text?: string;
  };
};

const FONT = "'Helvetica Neue', Arial, 'Noto Sans', sans-serif";

const EditorialReel: React.FC<EditorialReelProps> = ({
  headline = "Заголовок",
  bodyText = "",
  ctaText = "Сохранить",
  accentText = "",
  backgroundImage,
  backgroundColor = "#0A0A0A",
  logoImage,
  durationInSeconds = 15,
  palette = {},
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bg = palette.background || backgroundColor;
  const textColor = palette.text || "#FFFFFF";
  const accent = palette.accent || "#0FB5AE";

  // ── Animations ──────────────────────────────────────────────────────────────
  const titleIn = spring({ frame, from: 0, to: 1, config: { damping: 200 } });
  const fadeIn  = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const slideUp = interpolate(frame, [0, 30], [40, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: bg, fontFamily: FONT }}>
      {/* Background image or gradient */}
      {backgroundImage ? (
        <Img
          src={require("./assets/" + backgroundImage)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: `linear-gradient(135deg, ${bg} 0%, #1a1a2e 100%)`,
          }}
        />
      )}

      {/* Dark overlay */}
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.45)" }} />

      {/* Accent line */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-start",
          alignItems: "flex-start",
          paddingTop: 120,
          paddingLeft: 60,
          paddingRight: 60,
        }}
      >
        <div
          style={{
            width: 60,
            height: 4,
            backgroundColor: accent,
            opacity: fadeIn,
            transform: `scaleX(${fadeIn})`,
            transformOrigin: "left",
          }}
        />
      </AbsoluteFill>

      {/* Logo */}
      {logoImage && (
        <AbsoluteFill
          style={{
            justifyContent: "flex-start",
            alignItems: "flex-end",
            paddingTop: 60,
            paddingRight: 60,
          }}
        >
          <Img
            src={require("./assets/" + logoImage)}
            style={{ width: 80, height: 80, objectFit: "contain", opacity: fadeIn }}
          />
        </AbsoluteFill>
      )}

      {/* Main content */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: 60,
          transform: `translateY(${slideUp}px)`,
          opacity: titleIn,
        }}
      >
        {/* Accent text */}
        {accentText && (
          <div
            style={{
              color: accent,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
              marginBottom: 24,
              opacity: fadeIn,
            }}
          >
            {accentText}
          </div>
        )}

        {/* Headline */}
        <div
          style={{
            color: textColor,
            fontSize: 72,
            fontWeight: 800,
            lineHeight: 1.1,
            textAlign: "center",
            marginBottom: 32,
            textShadow: "0 2px 20px rgba(0,0,0,0.5)",
          }}
        >
          {headline}
        </div>

        {/* Body text */}
        {bodyText && (
          <div
            style={{
              color: textColor,
              fontSize: 32,
              fontWeight: 400,
              lineHeight: 1.5,
              textAlign: "center",
              opacity: interpolate(frame, [15, 30], [0, 1], { extrapolateRight: "clamp" }),
              maxWidth: 900,
            }}
          >
            {bodyText}
          </div>
        )}

        {/* CTA */}
        {ctaText && (
          <div
            style={{
              marginTop: 48,
              paddingVertical: 16,
              paddingHorizontal: 48,
              backgroundColor: accent,
              color: "#000",
              fontSize: 28,
              fontWeight: 700,
              borderRadius: 8,
              opacity: interpolate(frame, [30, 45], [0, 1], { extrapolateRight: "clamp" }),
            }}
          >
            {ctaText}
          </div>
        )}
      </AbsoluteFill>

      {/* Bottom gradient */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <div
          style={{
            height: 200,
            background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export default EditorialReel;
