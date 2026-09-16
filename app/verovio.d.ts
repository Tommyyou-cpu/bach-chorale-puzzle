declare module "verovio/wasm" { const createVerovioModule:(options?:unknown)=>Promise<unknown>; export default createVerovioModule; }
declare module "verovio/esm" { export class VerovioToolkit { constructor(module:unknown); setOptions(options:Record<string,unknown>):void; loadData(data:string):boolean; renderToSVG(page:number):string; getPageCount():number; destroy():void; } }
