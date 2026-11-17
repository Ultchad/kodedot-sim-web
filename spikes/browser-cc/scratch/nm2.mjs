import fs from 'node:fs'; import { runLLVM } from '../build/yowasp/package/gen/bundle.js';
import { unpack } from '../lib/pack.js';
const L = unpack(new Uint8Array(fs.readFileSync('../build/site/cc/lib.pack')));
let out=''; const f=b=>{ if(b) out+=Buffer.from(b).toString(); };
try { await runLLVM(['nm','-A','/x.a'], {'x.a': L.get('dotcore/lib/libdotcore.a')}, {stdout:f,stderr:f,fetchProgress:()=>{}}); } catch(e){ console.log('err',e.code); }
console.log(out.split('\n').filter(l=>/wasi/.test(l)).slice(0,8).join('\n'));
