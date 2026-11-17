import fs from 'node:fs'; import { runLLVM } from '../build/yowasp/package/gen/bundle.js';
let out=''; const f=b=>{ if(b) out+=Buffer.from(b).toString(); };
const p=process.argv[2];
try { await runLLVM(['nm','-A',...process.argv.slice(3),'/x.a'], {'x.a': fs.readFileSync(p)}, {stdout:f,stderr:f,fetchProgress:()=>{}}); } catch(e){ console.log('err',e.code); }
console.log(out);
