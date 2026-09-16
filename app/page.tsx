"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Headphones, LoaderCircle, Pause, Play, RefreshCw, RotateCcw, Volume2, VolumeX } from "lucide-react";
import rawQuestions from "./questions.generated.json";
import { candidateFor, Candidate, DecoyType, GameState, isComplete, isOriginalSelection, newGame, Question, restoreGame, scoreGame, VOICES, VoiceKey } from "./game";
import { useAudioPlayer } from "./use-audio-player";
import { VerovioScore } from "./verovio-score";

const questions=rawQuestions as Question[];
const STORAGE_KEY="bach-puzzle-state-v3";
const LEGACY_STORAGE_KEY="bach-puzzle-state-v2";
const VOICE_META:Record<VoiceKey,{name:string;short:string}>={soprano:{name:"女高音",short:"S"},alto:{name:"女低音",short:"A"},tenor:{name:"男高音",short:"T"},bass:{name:"男低音",short:"B"}};
const LETTERS=["A","B","C","D"];
const DECOY_LABELS:Record<DecoyType,string>={original:"巴赫原作","voice-leading":"声部进行干扰",harmony:"和声走向干扰",mixed:"和声与声部进行混合干扰"};
const AUDIO_ERROR_LABELS={network:"网络加载失败",decode:"音频解码失败",playback:"浏览器播放受限",unsupported:"浏览器不支持"} as const;

function savedState(){try{for(const key of [STORAGE_KEY,LEGACY_STORAGE_KEY]){const raw=localStorage.getItem(key);if(!raw)continue;const parsed=JSON.parse(raw);if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))return parsed;}}catch{}return undefined;}
function safeState():GameState{if(typeof window==="undefined")return newGame(questions,20260916);return restoreGame(questions,savedState());}
function revealDetails(candidate:Candidate|undefined){if(!candidate)return{type:"未找到所选项",reason:"该选项已不在当前题目中。"};const explanation=candidate.explanation?.trim();return{type:DECOY_LABELS[candidate.decoyType]||"干扰声部",reason:explanation||(candidate.isOriginal?"这条声部属于本题的巴赫原作。":"这是一条为听辨设置的替代声部。")};}

export default function Home(){
  const [state,setState]=useState<GameState>(()=>newGame(questions,20260916));const [ready,setReady]=useState(false);const [message,setMessage]=useState("");const [loop,setLoop]=useState(false);const [muted,setMuted]=useState([false,false,false,false]);const [scoreMode,setScoreMode]=useState<"chosen"|"original">("chosen");const headingRef=useRef<HTMLHeadingElement>(null);const player=useAudioPlayer();
  useEffect(()=>{setState(safeState());setReady(true);},[]);useEffect(()=>{if(ready)localStorage.setItem(STORAGE_KEY,JSON.stringify(state));},[state,ready]);useEffect(()=>{player.stop();setMuted([false,false,false,false]);},[state.current,state.submitted]);
  const question=questions[state.current];const selections=state.selections[question.id]||{};const selectedCount=VOICES.filter(v=>selections[v]).length;const complete=isComplete(state);const score=useMemo(()=>scoreGame(questions,state.selections),[state.selections]);
  const ordered=(voice:VoiceKey)=>{const candidates=state.orders[question.id]?.[voice]?.map(id=>candidateFor(question,voice,id)).filter((candidate):candidate is Candidate=>Boolean(candidate));return candidates?.length===question.voices[voice].length?candidates:question.voices[voice];};
  const chosenCandidates=VOICES.map(v=>candidateFor(question,v,selections[v])).filter(Boolean);
  const originalCandidates=VOICES.map(v=>question.voices[v].find(c=>c.isOriginal)!);
  const allOriginal=VOICES.every(v=>isOriginalSelection(question,v,selections[v]));
  const playPaths=(paths:string[],label:string,withMute=false,fallbackPaths?:Array<string|undefined>)=>player.play({paths,fallbackPaths,label,loop,muted:withMute?muted:undefined});
  const choose=(voice:VoiceKey,id:string)=>{player.stop();setMessage("");setState(s=>({...s,selections:{...s.selections,[question.id]:{...s.selections[question.id],[voice]:id}}}));};
  const go=(index:number)=>{setState(s=>({...s,current:index}));requestAnimationFrame(()=>headingRef.current?.focus());};
  const submit=()=>{if(!complete){setMessage("还有声部没有选择。完成全部 12 个选择后才能揭晓。");return;}player.stop();setState(s=>({...s,submitted:true,current:0}));setMessage("");setTimeout(()=>headingRef.current?.focus(),0);};
  const reset=()=>{player.stop();setState(previous=>newGame(questions,Date.now(),previous.orders));setMessage("已重新洗牌，开始新的挑战。");setScoreMode("chosen");};
  const currentScoreCandidates=scoreMode==="chosen"?chosenCandidates:originalCandidates;
  const currentScorePaths=currentScoreCandidates.map(c=>c!.score);
  const currentScoreCandidateIds=currentScoreCandidates.map(c=>c!.id);

  return <main className="site-shell">
    <header className="masthead"><div className="brand-mark" aria-hidden="true">♩</div><div><p className="eyebrow">THE BACH PUZZLE</p><h1>拼出巴赫</h1></div><p className="byline">一场四声部盲听实验<br/>田清新 · 制作</p></header>
    {!state.submitted&&<section className="intro"><div><p className="kicker">四个声部 · 十六个选项 · 一首真正的巴赫</p><h2>你能听出，哪四条旋律<br/>曾在三百年前同时响起吗？</h2></div><div className="listening-note"><Headphones size={22} strokeWidth={1.5}/><span>建议佩戴耳机<br/><small>3 道题 · 约 6 分钟</small></span></div></section>}

    {state.submitted?<>
      <section className="results-hero"><p className="kicker">挑战结果</p><h2 ref={headingRef} tabIndex={-1}>你拼对了 <em>{score.questions}</em> 首圣咏</h2><p>共找到 <strong>{score.voices}</strong> / 12 条巴赫原作声部。现在，让乐谱告诉你差异在哪里。</p><button className="reset-button" onClick={reset}><RotateCcw size={17}/>重新挑战</button></section>
      <div className="result-tabs" role="tablist" aria-label="选择结果题目">{questions.map((q,i)=><button role="tab" aria-selected={state.current===i} className={state.current===i?"active":""} onClick={()=>go(i)} key={q.id}>第 {i+1} 题</button>)}</div>
      <article className="reveal-card">
        <div className="reveal-heading"><div><p>{question.bwv} · {question.measures}</p><h3>{question.title}</h3></div><span className={allOriginal?"seal correct":"seal"}>{allOriginal?"完整拼对":"查看差异"}</span></div>
        <div className="answer-grid">{VOICES.map(voice=>{const order=ordered(voice);const chosen=selections[voice];const chosenCandidate=candidateFor(question,voice,chosen);const correct=question.voices[voice].find(c=>c.isOriginal)!;const chosenLetter=LETTERS[order.findIndex(c=>c.id===chosen)]||"—";const correctLetter=LETTERS[order.findIndex(c=>c.id===correct.id)]||"—";const ok=chosen===correct.id;const details=revealDetails(chosenCandidate);return <div className={`answer-row ${ok?"right":"wrong"}`} key={voice}><span className="answer-voice" aria-hidden="true">{VOICE_META[voice].short}</span><div className="answer-copy"><strong>{VOICE_META[voice].name}</strong><p>你选 {chosenLetter} · 原作 {correctLetter}</p><dl className="answer-explanation"><div><dt>所选类型</dt><dd>{details.type}</dd></div><div><dt>选择原因</dt><dd>{details.reason}</dd></div>{!ok&&<div className="answer-original"><dt>正确项</dt><dd>巴赫原作（选项 {correctLetter}）</dd></div>}</dl></div><span className="answer-status" role="img" aria-label={ok?"回答正确":"回答不正确"}>{ok?<Check aria-hidden="true" size={16}/>:<span aria-hidden="true">×</span>}</span></div>})}</div>
        <div className="compare-controls"><button onClick={()=>playPaths(chosenCandidates.map(c=>c!.audio),"你的组合",true,chosenCandidates.map(c=>c!.audioFallback))} disabled={player.loading}><Play size={16} fill="currentColor"/>听你的组合</button><button onClick={()=>playPaths(originalCandidates.map(c=>c.audio),"巴赫原作",true,originalCandidates.map(c=>c.audioFallback))} disabled={player.loading}><Play size={16} fill="currentColor"/>听巴赫原作</button></div>
        <div className="score-tabs" role="tablist" aria-label="乐谱对照"><button role="tab" aria-selected={scoreMode==="chosen"} onClick={()=>setScoreMode("chosen")} className={scoreMode==="chosen"?"active":""}>你的组合谱</button><button role="tab" aria-selected={scoreMode==="original"} onClick={()=>setScoreMode("original")} className={scoreMode==="original"?"active":""}>巴赫原谱</button></div>
        <VerovioScore paths={currentScorePaths} title={scoreMode==="chosen"?"你的组合":"巴赫原谱"} questionId={question.id} candidateIds={currentScoreCandidateIds}/>
        <div className="analysis"><h4>听辨线索</h4><p>{question.analysis}</p><p className="source-note">{question.licenseNote} <a href={question.source} target="_blank" rel="noreferrer">{question.sourceLabel} ↗</a></p></div>
      </article>
    </>:<section className="quiz-card" aria-label="四声部拼图">
      <div className="quiz-topline"><span>QUESTION <strong>{String(state.current+1).padStart(2,"0")}</strong> / 03</span><span>本题已选 {selectedCount} / 4</span></div><div className="rule" style={{"--progress":`${((state.current+selectedCount/4)/3)*100}%`} as React.CSSProperties}/>
      <div className="question-copy"><p>第 {state.current+1} 题</p><h3 ref={headingRef} tabIndex={-1}>从每个声部中，选出你认为属于巴赫的旋律</h3><span>点击 ▶ 单独试听；点击字母区域做出选择。</span></div>
      <div className="voice-stack">{VOICES.map((voice,voiceIndex)=><fieldset className="voice-row" key={voice}><legend><span>{String(voiceIndex+1).padStart(2,"0")}</span>{VOICE_META[voice].name}</legend><div className="option-grid">{ordered(voice).map((candidate,index)=>{const selected=selections[voice]===candidate.id;return <div className={`option-card ${selected?"selected":""}`} key={candidate.id}><button className="listen-button" onClick={()=>playPaths([candidate.audio],`${VOICE_META[voice].name}选项 ${LETTERS[index]}`,false,[candidate.audioFallback])} aria-label={`试听${VOICE_META[voice].name}选项 ${LETTERS[index]}`}><Play size={16} fill="currentColor"/></button><button className="choose-button" role="radio" aria-checked={selected} onClick={()=>choose(voice,candidate.id)}><span>{LETTERS[index]}</span><small>{selected?<><Check size={13}/>已选择</>:"选择此旋律"}</small></button></div>})}</div></fieldset>)}</div>
      <div className="question-nav"><button disabled={state.current===0} onClick={()=>go(state.current-1)}><ChevronLeft size={17}/>上一题</button><div aria-label="题目进度">{questions.map((q,i)=><button aria-label={`第 ${i+1} 题${VOICES.every(v=>state.selections[q.id]?.[v])?"，已完成":""}`} className={i===state.current?"active":""} onClick={()=>go(i)} key={q.id}>{i+1}</button>)}</div>{state.current<2?<button onClick={()=>go(state.current+1)}>下一题<ChevronRight size={17}/></button>:<button className="submit-button" onClick={submit} disabled={!complete}>提交并揭晓</button>}</div>
      <p className="status-message" aria-live="polite">{message||(!complete?"完成全部三题后即可揭晓，提交前可随时修改。":"12 个声部已选齐，可以提交。")}</p>
    </section>}

    <footer>© 2026 田清新 · 乐谱由 Verovio 渲染 · 音乐素材与方法说明见揭晓页</footer>
    {((!state.submitted&&selectedCount===4)||player.label)&&<div className="ensemble-bar"><div className="ensemble-title">{player.loading?<LoaderCircle className="spin" size={20}/>:<Volume2 size={20}/>}<span>{player.label||"当前合奏"}<small role={player.error?"alert":"status"} aria-live="polite">{player.error?`${AUDIO_ERROR_LABELS[player.error.kind]}：${player.error.message}`:`${Math.round(player.progress*100)}% · ${loop?"循环开启":"单次播放"}`}</small></span></div><div className="bar-actions"><button className={loop?"active":""} onClick={()=>setLoop(v=>!v)} aria-pressed={loop}><RefreshCw size={16}/><span>循环</span></button>{!state.submitted&&VOICES.map((voice,i)=><button key={voice} className={muted[i]?"muted":""} aria-label={`${muted[i]?"取消静音":"静音"}${VOICE_META[voice].name}`} onClick={()=>{const next=muted.map((m,x)=>x===i?!m:m);setMuted(next);player.updateMuted(next);}}>{muted[i]?<VolumeX size={15}/>:VOICE_META[voice].short}</button>)}{player.playing?<button className="primary" onClick={player.pause}><Pause size={17} fill="currentColor"/>暂停</button>:player.error?<button className="primary" onClick={player.retry} disabled={player.loading}><RefreshCw size={17}/>重试音频</button>:player.label?<button className="primary" onClick={player.resume}><Play size={17} fill="currentColor"/>继续</button>:!state.submitted&&selectedCount===4?<button className="primary" onClick={()=>playPaths(chosenCandidates.map(c=>c!.audio),"当前合奏",true,chosenCandidates.map(c=>c!.audioFallback))}><Play size={17} fill="currentColor"/>播放合奏</button>:null}</div></div>}
  </main>;
}
