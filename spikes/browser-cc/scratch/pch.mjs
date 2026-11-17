import fs from 'node:fs'; import { runLLVM } from '../build/yowasp/package/gen/bundle.js';
import { unpack, toTree } from '../lib/pack.js';
import { cc1Args, runTool, compileCpp, getFile } from '../lib/cc-driver.js';
import { inoToCpp } from '../../../tools/dblib/part/ino2cpp.mjs';
import { fieldsHeader } from '../lib/part-glue.mjs';
const S='../build/site/cc/'; const tree={}; toTree(unpack(new Uint8Array(fs.readFileSync(S+'inc.pack'))),tree);
const dir='/home/claude/wt/cc/parts/esp32-blink-echo'; const m=JSON.parse(fs.readFileSync(dir+'/manifest.json','utf8'));
const files={dotcore:tree.dotcore,'sketch.cpp':inoToCpp(fs.readFileSync(dir+'/src/main.ino','utf8'),'main.ino'),gen:{'dotbench_fields.h':fieldsHeader(m)},pch:{'all.h':'#include <Arduino.h>\n#include <Wire.h>\n#include <SPI.h>\n#include <Preferences.h>\n#include <dotbench.h>\n'}};
const time=async(label,f)=>{ const t=[]; for(let i=0;i<4;i++){ const a=performance.now(); await f(); t.push(Math.round(performance.now()-a)); } console.log(label.padEnd(28), t.join(' ')); };
await time('no pch', ()=>compileCpp(runLLVM,files,{src:'/sketch.cpp',out:'/sketch.o',incs:['/gen']}));
// build pch
const a=cc1Args({src:'/pch/all.h',out:'/pch/all.pch',incs:['/gen']}); a[a.indexOf('-emit-obj')]='-emit-pch'; a.splice(a.indexOf('-x')+1,1,'c++-header');
let r=await runTool(runLLVM,a,files); console.log('pch build', r.ok, r.stderr.slice(0,300)); 
const pch=getFile(r.files,'/pch/all.pch'); console.log('pch bytes', pch?.length);
files.pch['all.pch']=pch;
const b=cc1Args({src:'/sketch.cpp',out:'/sketch.o',incs:['/gen']}); b.splice(b.indexOf('-o'),0,'-include-pch','/pch/all.pch');
await time('with pch', async()=>{ const r=await runTool(runLLVM,b,files); if(!r.ok) throw new Error(r.stderr); });
