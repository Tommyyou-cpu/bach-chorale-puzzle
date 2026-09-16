"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type PlayRequest={paths:string[];label:string;loop?:boolean;muted?:boolean[]};
const resolveAsset=(path:string)=>new URL(path.replace(/^\//,""),document.baseURI).toString();

export function useAudioPlayer(){
  const context=useRef<AudioContext|null>(null); const cache=useRef(new Map<string,AudioBuffer>()); const sources=useRef<AudioBufferSourceNode[]>([]); const gains=useRef<GainNode[]>([]); const started=useRef(0); const offset=useRef(0); const duration=useRef(0); const request=useRef<PlayRequest|null>(null); const timer=useRef<number|null>(null);
  const [playing,setPlaying]=useState(false); const [loading,setLoading]=useState(false); const [progress,setProgress]=useState(0); const [label,setLabel]=useState(""); const [error,setError]=useState("");
  const clearTimer=()=>{if(timer.current!==null){cancelAnimationFrame(timer.current);timer.current=null;}};
  const stopNodes=()=>{sources.current.forEach(s=>{try{s.stop();}catch{}});sources.current=[];gains.current=[];};
  const tick=useCallback(()=>{if(!context.current||!request.current)return;const elapsed=context.current.currentTime-started.current+offset.current;const pos=request.current.loop&&duration.current?elapsed%duration.current:Math.min(elapsed,duration.current);setProgress(duration.current?pos/duration.current:0);if(elapsed>=duration.current&&!request.current.loop){setPlaying(false);setProgress(1);clearTimer();return;}timer.current=requestAnimationFrame(tick);},[]);
  const ensure=async(paths:string[])=>{const ctx=context.current??new AudioContext();context.current=ctx;if(ctx.state==="suspended")await ctx.resume();return Promise.all(paths.map(async path=>{const url=resolveAsset(path);if(cache.current.has(url))return cache.current.get(url)!;const response=await fetch(url);if(!response.ok)throw new Error("音频资源加载失败");const buffer=await ctx.decodeAudioData(await response.arrayBuffer());cache.current.set(url,buffer);return buffer;}));};
  const start=async(req:PlayRequest,startOffset=0)=>{setError("");setLoading(true);stopNodes();clearTimer();try{const buffers=await ensure(req.paths);const ctx=context.current!;request.current=req;duration.current=Math.min(...buffers.map(b=>b.duration));const safeOffset=Math.max(0,Math.min(startOffset,Math.max(0,duration.current-.001)));offset.current=safeOffset;started.current=ctx.currentTime+.04;sources.current=buffers.map((buffer,index)=>{const source=ctx.createBufferSource();const gain=ctx.createGain();source.buffer=buffer;source.loop=Boolean(req.loop);source.loopEnd=duration.current;gain.gain.value=req.muted?.[index]?0:1;source.connect(gain).connect(ctx.destination);source.start(started.current,safeOffset);gains.current.push(gain);return source;});setLabel(req.label);setProgress(safeOffset/duration.current);setPlaying(true);timer.current=requestAnimationFrame(tick);}catch(e){setError(e instanceof Error?e.message:"无法播放音频");setPlaying(false);}finally{setLoading(false);}};
  const play=useCallback((req:PlayRequest)=>{void start(req,0);},[]);
  const pause=useCallback(()=>{if(!playing||!context.current)return;offset.current=Math.max(0,Math.min(duration.current,context.current.currentTime-started.current+offset.current));stopNodes();clearTimer();setPlaying(false);},[playing]);
  const resume=useCallback(()=>{if(request.current)void start(request.current,offset.current);},[]);
  const stop=useCallback(()=>{stopNodes();clearTimer();offset.current=0;duration.current=0;request.current=null;setPlaying(false);setProgress(0);setLabel("");},[]);
  const updateMuted=useCallback((muted:boolean[])=>{if(request.current)request.current={...request.current,muted};gains.current.forEach((g,i)=>g.gain.value=muted[i]?0:1);},[]);
  useEffect(()=>()=>{stopNodes();clearTimer();const ctx=context.current;if(ctx&&ctx.state!=="closed")void ctx.close();},[]);
  return{play,pause,resume,stop,updateMuted,playing,loading,progress,label,error};
}
