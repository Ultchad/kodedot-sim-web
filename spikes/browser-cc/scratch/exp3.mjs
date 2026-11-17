import { runLLVM } from '../build/yowasp/package/gen/bundle.js';
let out=[]; const cap=b=>{ if(b) out.push(Buffer.from(b)); };
const flags=['-Os','-std=gnu++17','-fno-exceptions','-fno-rtti','-ffunction-sections','-fdata-sections','-Icore','-Iapi','-I.','-DARDUINO=10819','-DARDUINO_ARCH_ESP32','-DESP32','-DHOST','-Wno-main','--target=wasm32-wasip1'];
try { await runLLVM(['clang++','-###',...flags,'-c','sketch.cpp','-o','sketch.o'], {'sketch.cpp':''}, {stdout:cap,stderr:cap,fetchProgress:()=>{}}); } catch(e){}
console.log(Buffer.concat(out).toString());
out=[];
try { await runLLVM(['clang++','-###','--target=wasm32-wasip1','-mexec-model=reactor','-Wl,--no-entry','-Wl,--export=dp_start','-Wl,--gc-sections','sketch.o','dotcore.o','-o','out.wasm'], {'sketch.o':'','dotcore.o':''}, {stdout:cap,stderr:cap}); } catch(e){}
console.log(Buffer.concat(out).toString());
