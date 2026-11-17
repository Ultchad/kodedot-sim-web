import fs from 'node:fs'; import path from 'node:path';
import { runClang, runLLVM } from '../build/yowasp/package/gen/bundle.js';
import {loadTree} from '../lib/tree.mjs';
import {inoToCpp} from '/home/claude/wt/cc/tools/dblib/part/ino2cpp.mjs';
const CORE='/home/claude/wt/cc/runtime/parts/core', API='/home/claude/src/third/ArduinoCore-API/api';
const tree={core: loadTree(CORE), api: {api: loadTree(API)}};
const ino=fs.readFileSync(process.argv[2],'utf8');
tree['sketch.cpp']=inoToCpp(ino,'main.ino');
import {fieldsHeader} from '../lib/part-glue.mjs';
tree['dotbench_fields.h']=fieldsHeader(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
const flags=['-Os','-std=gnu++17','-fno-exceptions','-fno-rtti','-ffunction-sections','-fdata-sections','-Icore','-Iapi','-I.','-DARDUINO=10819','-DARDUINO_ARCH_ESP32','-DESP32','-DHOST','-Wno-main','--target=wasm32-wasip1'];
let t=performance.now();
let r=await runClang(['clang++',...flags,'-c','sketch.cpp','-o','sketch.o'], tree, {fetchProgress:()=>{}});
console.log('compile', Math.round(performance.now()-t));
const o=r['sketch.o'];
const objs={}; for (const n of ['dotcore','Print','Stream','String','IPAddress','Common']) objs[n+'.o']=fs.readFileSync('../build/exp/'+n+'.o');
t=performance.now();
try {
 r=await runClang(['clang++','--target=wasm32-wasip1','-mexec-model=reactor','-Wl,--no-entry','-Wl,--export=dp_start','-Wl,--gc-sections','sketch.o',...Object.keys(objs),'-o','out.wasm'], {'sketch.o':o,...objs}, {fetchProgress:()=>{}});
 console.log('link', Math.round(performance.now()-t), r['out.wasm'].length);
 fs.writeFileSync('../build/exp/out.wasm', r['out.wasm']);
} catch(e){ console.log('link failed', e.message, e.files && Object.keys(e.files)); }
