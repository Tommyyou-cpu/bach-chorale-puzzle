import fs from "node:fs";
const questions=JSON.parse(fs.readFileSync(new URL("../app/questions.generated.json",import.meta.url),"utf8"));
const voices=["soprano","alto","tenor","bass"];
let tracks=0;let combinations=0;
if(questions.length!==3)throw new Error("题目数应为 3");
for(const q of questions){
  for(const voice of voices){const options=q.voices[voice];if(options.length!==4)throw new Error(`${q.id}/${voice} 应有 4 个选项`);if(options.filter(x=>x.isOriginal).length!==1)throw new Error(`${q.id}/${voice} 原作选项必须唯一`);for(const option of options){for(const key of ["audio","score"]){const path=new URL(`../public${option[key]}`,import.meta.url);if(!fs.existsSync(path))throw new Error(`缺少资源 ${option[key]}`);}tracks++;}}
  combinations+=4**4;
}
console.log(JSON.stringify({questions:questions.length,tracks,combinations,scoreCases:{allCorrect:"3/12",allWrong:"0/0",partial:"0–3/0–12"}},null,2));
