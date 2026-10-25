import {BrandMark} from './BrandMark';

export type LaunchProps = {seconds:number;width:number;height:number;dark:boolean;reducedMotion:boolean;background?:string};
const progress=(time:number,start:number,end:number)=>Math.max(0,Math.min(1,(time-start)/(end-start)));
const quadratic=(x:number)=>x<.5?2*x*x:1-2*(1-x)*(1-x);
// Evaluate CSS cubic-bezier(.45,0,.2,1) without a video runtime.
function curve(x:number){
  let low=0,high=1;
  for(let i=0;i<16;i++){
    const t=(low+high)/2,u=1-t;
    const point=3*u*u*t*.45+3*u*t*t*.2+t*t*t;
    if(point<x)low=t;else high=t;
  }
  const t=(low+high)/2;
  return 3*(1-t)*t*t+t*t*t;
}
export function Launch({seconds,width,height,dark=false,reducedMotion=false,background}:LaunchProps) {
  // Complete removal on the final frame: no invisible layer or focus target remains.
  if (seconds >= (reducedMotion ? .22 : 1.28)) return null;
  return <div data-testid="launch-overlay" aria-hidden="true" style={{
    position:'absolute',inset:0,display:'flex',flexDirection:'column',
    background:background ?? (dark ? '#18171b' : '#fffcfd'), alignItems:'center', justifyContent:'center', pointerEvents:'none',
    opacity:1-quadratic(progress(seconds,reducedMotion?0:.94,reducedMotion?.22:1.28)),
  }}>
    <div>
      <BrandMark size={Math.min(156, Math.max(100,width*.30),height*.35)}
        rotation={reducedMotion?0:90*curve(progress(seconds,.16,.78))}
        morph={reducedMotion?0:curve(progress(seconds,.31,.85))}/>
    </div>
  </div>;
}
