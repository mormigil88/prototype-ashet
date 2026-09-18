import "./index.css";
import { Composition } from "remotion";
import { MyComposition } from "./Composition";
import { Day09, DAY09_TOTAL_FRAMES } from "./Day09";
import { Day10, DAY10_TOTAL_FRAMES } from "./Day10";
import { Day10Step2, DAY10_STEP2_TOTAL_FRAMES } from "./Day10Step2";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <Composition
        id="Day09"
        component={Day09}
        durationInFrames={DAY09_TOTAL_FRAMES}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="Day10"
        component={Day10}
        durationInFrames={DAY10_TOTAL_FRAMES}
        fps={24}
        width={1080}
        height={1920}
      />
      <Composition
        id="Day10Step2"
        component={Day10Step2}
        durationInFrames={DAY10_STEP2_TOTAL_FRAMES}
        fps={24}
        width={1080}
        height={1920}
      />
    </>
  );
};
