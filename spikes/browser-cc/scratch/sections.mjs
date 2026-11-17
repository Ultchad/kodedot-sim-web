import fs from 'node:fs';
const b=fs.readFileSync(process.argv[2]); let p=8; const rd=()=>{let r=0,s=0,x;do{x=b[p++];r|=(x&0x7f)<<s;s+=7;}while(x&0x80);return r>>>0;};
const names={0:'custom',1:'type',2:'import',3:'function',4:'table',5:'memory',6:'global',7:'export',8:'start',9:'element',10:'code',11:'data',12:'datacount',13:'tag'};
while(p<b.length){ const id=b[p++], size=rd(), start=p; let nm=names[id]; if(id===0){ const l=rd(); nm='custom:'+b.subarray(p,p+l).toString(); } console.log(nm.padEnd(30), size); p=start+size; }
