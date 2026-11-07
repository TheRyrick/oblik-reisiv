import { Composition } from "remotion";
import { TourVideo, durationOf, FPS, W, H } from "./Tour";
import { owner } from "./owner";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="OwnerGuide"
      component={TourVideo}
      defaultProps={{ g: owner }}
      durationInFrames={durationOf(owner)}
      fps={FPS}
      width={W}
      height={H}
    />
  );
};
