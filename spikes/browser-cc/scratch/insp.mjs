import fs from 'node:fs';
const m=await WebAssembly.compile(fs.readFileSync(process.argv[2]));
console.log('imports', JSON.stringify(WebAssembly.Module.imports(m).map(i=>i.module+'.'+i.name)));
console.log('exports', JSON.stringify(WebAssembly.Module.exports(m).map(i=>i.name)));
