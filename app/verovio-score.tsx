"use client";
import { useEffect, useState } from "react";

const VOICE_NAMES=["女高音","女低音","男高音","男低音"];
const resolveAsset=(path:string)=>new URL(path.replace(/^\//,""),document.baseURI).toString();

async function combineParts(paths:string[]){
  const texts=await Promise.all(paths.map(async p=>{const r=await fetch(resolveAsset(p));if(!r.ok)throw new Error("乐谱文件加载失败");return r.text();}));
  const parser=new DOMParser(); const docs=texts.map(t=>parser.parseFromString(t,"application/xml")); const output=docs[0].cloneNode(true) as XMLDocument; const root=output.documentElement; root.querySelectorAll("part").forEach(n=>n.remove()); const list=root.querySelector("part-list")!; list.querySelectorAll("score-part").forEach(n=>n.remove());
  docs.forEach((doc,index)=>{const scorePart=doc.querySelector("score-part")!;const part=doc.querySelector("part")!;const id=`P${index+1}`;scorePart.setAttribute("id",id);scorePart.querySelector("part-name")!.textContent=VOICE_NAMES[index];part.setAttribute("id",id);list.appendChild(output.importNode(scorePart,true));root.appendChild(output.importNode(part,true));});
  return new XMLSerializer().serializeToString(output);
}

export function VerovioScore({paths,title}:{paths:string[];title:string}){
  const [svg,setSvg]=useState("");const [error,setError]=useState("");
  useEffect(()=>{let cancelled=false;let toolkit:{destroy:()=>void}|null=null;setSvg("");setError("");(async()=>{try{const [wasm,esm,xml]=await Promise.all([import("verovio/wasm"),import("verovio/esm"),combineParts(paths)]);const module=await wasm.default();const tk=new esm.VerovioToolkit(module);toolkit=tk;tk.setOptions({scale:36,pageWidth:2200,pageHeight:1450,adjustPageHeight:true,breaks:"auto",footer:"none",header:"none"});tk.loadData(xml);let pages="";for(let page=1;page<=tk.getPageCount();page++)pages+=tk.renderToSVG(page);if(!cancelled)setSvg(pages);}catch(e){if(!cancelled)setError(e instanceof Error?e.message:"乐谱渲染失败");}})();return()=>{cancelled=true;toolkit?.destroy();};},[paths.join("|")]);
  return <div className="score-wrap" aria-label={`${title}五线谱`}>{error?<p className="score-status">{error}</p>:svg?<div className="score-svg" dangerouslySetInnerHTML={{__html:svg}}/>:<p className="score-status">正在雕刻乐谱……</p>}</div>;
}
