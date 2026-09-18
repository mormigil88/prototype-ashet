import { AbsoluteFill, OffthreadVideo, Sequence, staticFile } from "remotion";

// Step 2 check: real footage only, no audio, no captions, no graphics.
// Each clip plays at its exact native length (121 frames) — no transform,
// no zoom, no freeze. Black filler after covers the remaining runway so the
// user can judge the raw cut-to-cut motion in isolation before anything
// else gets layered on top.
const CLIP_FRAMES = 121;
const VIDEO_A = CLIP_FRAMES;
const VIDEO_B = CLIP_FRAMES;
const VIDEO_C = CLIP_FRAMES;
const REAL_FOOTAGE_END = VIDEO_A + VIDEO_B + VIDEO_C; // 363
const TOTAL_FRAMES = 716; // matches planned final runtime (~29.8s @ 24fps)

// OffthreadVideo, not Video: the source clips have a single keyframe for the
// whole 121-frame GOP (Kling export), and <Video>'s browser <video>-tag seek
// is not frame-accurate against a long inter-frame-only GOP — it can hand
// back a neighboring frame instead of the exact one requested. OffthreadVideo
// uses Remotion's dedicated native extractor instead, which decodes exact
// frames.
const RawVideo: React.FC<{ src: string }> = ({ src }) => (
  <AbsoluteFill style={{ background: "black" }}>
    <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  </AbsoluteFill>
);

export const Day10Step2: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Sequence from={0} durationInFrames={VIDEO_A}>
        <RawVideo src={staticFile("day-10/clip-a-24fps-original.mp4")} />
      </Sequence>
      <Sequence from={VIDEO_A} durationInFrames={VIDEO_B}>
        <RawVideo src={staticFile("day-10/clip-b-24fps-original.mp4")} />
      </Sequence>
      <Sequence from={VIDEO_A + VIDEO_B} durationInFrames={VIDEO_C}>
        <RawVideo src={staticFile("day-10/clip-c-24fps-original.mp4")} />
      </Sequence>
      {/* remaining runway: plain black, no filler content yet */}
      <Sequence from={REAL_FOOTAGE_END} durationInFrames={TOTAL_FRAMES - REAL_FOOTAGE_END}>
        <AbsoluteFill style={{ backgroundColor: "black" }} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const DAY10_STEP2_TOTAL_FRAMES = TOTAL_FRAMES;
