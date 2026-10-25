import {useId} from 'react';
import {interpolatePath} from '@remotion/paths';
import {PALETTE, PLAY_UP_PATH, V_PATH} from './brand';

export function BrandMark({morph=0, rotation=0, size=144, tile=false}: {morph?:number;rotation?:number;size?:number;tile?:boolean}) {
  const id = useId().replace(/:/g, '');
  return <svg data-testid="brand-mark" width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" style={{display:'block',overflow:'visible',width:size,height:size}}>
    <defs>
      <linearGradient id={`${id}-pink`} x1="45" y1="40" x2="199" y2="211" gradientUnits="userSpaceOnUse" gradientTransform={`rotate(${-rotation} 128 128)`}>
        <stop stopColor={PALETTE.light}/><stop offset=".48" stopColor={PALETTE.mid}/><stop offset="1" stopColor={PALETTE.deep}/>
      </linearGradient>
      <linearGradient id={`${id}-fold`} x1="70" y1="56" x2="156" y2="198" gradientUnits="userSpaceOnUse"><stop stopColor="#fff" stopOpacity=".28"/><stop offset="1" stopColor="#e52e77" stopOpacity=".24"/></linearGradient>
      <linearGradient id={`${id}-tile`} x2=".6" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor="#fff0f5"/></linearGradient>
    </defs>
    {tile && <rect x="2" y="2" width="252" height="252" rx="60" fill={`url(#${id}-tile)`} stroke="#fce3ec"/>}
    <g transform={`rotate(${rotation} 128 128)`} data-rotation={rotation} data-morph={morph}>
      <path d={interpolatePath(morph, V_PATH, PLAY_UP_PATH)} fill={`url(#${id}-pink)`}/>
      <path d="M55 46 C43 46 37 58 43 70 L94 182 C100 196 112 204 128 204 C144 204 156 196 162 182 C147 190 140 177 134 163 L94 60 C90 51 84 46 75 46 Z" fill={`url(#${id}-fold)`} opacity={Math.max(0, 1-morph*2)}/>
    </g>
  </svg>;
}
