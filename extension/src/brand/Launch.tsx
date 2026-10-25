import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {BrandMark} from './BrandMark';

export type LaunchProps = {dark:boolean; reducedMotion:boolean; background?:string};
const clamp = {extrapolateLeft:'clamp', extrapolateRight:'clamp'} as const;
export function Launch({dark=false, reducedMotion=false, background}:LaunchProps) {
  const frame = useCurrentFrame();
  const {fps,width,height} = useVideoConfig();
  const seconds = frame / fps;
  // Complete removal on the final frame: no invisible layer or focus target remains.
  if (seconds >= (reducedMotion ? .22 : 1.28)) return null;
  const curve = Easing.bezier(.45,0,.2,1);
  return <AbsoluteFill data-testid="launch-overlay" aria-hidden="true" style={{
    background:background ?? (dark ? '#18171b' : '#fffcfd'), alignItems:'center', justifyContent:'center', pointerEvents:'none',
    opacity:interpolate(seconds, reducedMotion ? [0,.22] : [.94,1.28], [1,0],{...clamp,easing:Easing.inOut(Easing.quad)}),
  }}>
    <div>
      <BrandMark size={Math.min(156, Math.max(100,width*.30),height*.35)}
        rotation={reducedMotion ? 0 : interpolate(seconds,[.16,.78],[0,90],{...clamp,easing:curve})}
        morph={reducedMotion ? 0 : interpolate(seconds,[.31,.85],[0,1],{...clamp,easing:curve})}/>
    </div>
  </AbsoluteFill>;
}
