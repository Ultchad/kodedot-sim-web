import fs from 'node:fs'; import path from 'node:path';
import { runClang, runLLVM } from '../build/yowasp/package/gen/bundle.js';
const CORE='/home/claude/wt/cc/runtime/parts/core', API='/home/claude/src/third/ArduinoCore-API/api';
import {loadTree} from '../lib/tree.mjs';
const tree={core: loadTree(CORE), api: {api: loadTree(API)}};
const flags=['-Os','-std=gnu++17','-fno-exceptions','-fno-rtti','-ffunction-sections','-fdata-sections','-Icore','-Iapi','-DARDUINO=10819','-DARDUINO_ARCH_ESP32','-DESP32','-DHOST','-Wno-main','--target=wasm32-wasip1'];
const objs={};
for (const [src,dir] of [['dotcore.cpp','core'],['Print','api/api'],['Stream','api/api'],['String','api/api'],['IPAddress','api/api'],['Common','api/api']]) {
  const file = dir==='core'? 'core/dotcore.cpp' : `api/api/${src}.cpp`;
  const t=performance.now();
  const r=await runClang(['clang++',...flags,'-c',file,'-o',src.replace('.cpp','')+'.o'], tree, {fetchProgress:()=>{}});
  console.log(file, Math.round(performance.now()-t),'ms', Object.keys(r).filter(k=>k.endsWith('.o')).map(k=>k+':'+r[k].length));
  Object.assign(objs, Object.fromEntries(Object.entries(r).filter(([k])=>k.endsWith('.o'))));
}
fs.mkdirSync('../build/exp',{recursive:true});
for (const [k,v] of Object.entries(objs)) fs.writeFileSync('../build/exp/'+k, v);
