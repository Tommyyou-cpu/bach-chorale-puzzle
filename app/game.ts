export const VOICES = ["soprano", "alto", "tenor", "bass"] as const;
export type VoiceKey = (typeof VOICES)[number];
export type Candidate = { id:string; audio:string; score:string; isOriginal:boolean };
export type Question = { id:string; title:string; bwv:string; measures:string; duration:number; bpm:number; source:string; sourceLabel:string; analysis:string; licenseNote:string; voices:Record<VoiceKey,Candidate[]> };
export type Selections = Record<string, Partial<Record<VoiceKey,string>>>;
export type Orders = Record<string, Record<VoiceKey,string[]>>;
export type GameState = { version:2; seed:number; current:number; submitted:boolean; selections:Selections; orders:Orders };

function mulberry32(seed:number){return()=>{let t=seed+=0x6d2b79f5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
export function buildOrders(questions:Question[],seed:number):Orders{
  const random=mulberry32(seed); const orders:Orders={};
  for(const q of questions){orders[q.id]={} as Record<VoiceKey,string[]>;for(const voice of VOICES){const ids=q.voices[voice].map(c=>c.id);for(let i=ids.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}orders[q.id][voice]=ids;}}
  return orders;
}
export function newGame(questions:Question[],seed=Date.now()):GameState{return{version:2,seed,current:0,submitted:false,selections:{},orders:buildOrders(questions,seed)}};
export function isComplete(state:GameState){return Object.values(state.orders).every((voiceOrders,qIndex)=>{const qid=Object.keys(state.orders)[qIndex];return VOICES.every(v=>Boolean(state.selections[qid]?.[v]));});}
export function scoreGame(questions:Question[],selections:Selections){let voices=0;let questionsCorrect=0;for(const q of questions){let correct=0;for(const voice of VOICES){const chosen=selections[q.id]?.[voice];if(q.voices[voice].find(c=>c.id===chosen)?.isOriginal){voices++;correct++;}}if(correct===4)questionsCorrect++;}return{voices,questions:questionsCorrect};}
export function candidateFor(q:Question,voice:VoiceKey,id?:string){return q.voices[voice].find(c=>c.id===id);}
