// Contract stub: the explorable 3D headquarters. Replaced by the real three.js view.
export interface HQ3DViewProps {
  /** Room to fly to (or cut to, with reduced motion) when it changes. */
  focusRoomId?: string | null;
  onFocusDone?: () => void;
}
export default function HQ3DView(_props: HQ3DViewProps) {
  return <div className="hq3d" role="application" aria-label="3D headquarters">3D headquarters</div>;
}
