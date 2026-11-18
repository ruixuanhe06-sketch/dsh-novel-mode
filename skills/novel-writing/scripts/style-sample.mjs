import fs from 'node:fs';
import path from 'node:path';

// Sample UTF-8 byte windows; never load or persist the entire reference novel.
function sample(file,limit) {
  if (!Number.isInteger(limit) || limit<1 || limit>800) throw new Error('每段字符数须为 1–800');
  const fd=fs.openSync(file,'r');
  try {
    const size=fs.fstatSync(fd).size, samples=[];
    let previousEnd=0;
    for (const fraction of [0,0.25,0.5,0.75,1]) {
      const tail=fraction===1;
      const from=Math.max(previousEnd,tail?size-limit*4:Math.floor(size*fraction),0);
      if (from>=size) continue;
      const bytes=Buffer.alloc(Math.min(size-from,limit*4+4));
      const n=fs.readSync(fd,bytes,0,bytes.length,from);
      let start=0,end=n;
      while (start<end && (bytes[start]&0xc0)===0x80) start++;
      if (from+end<size) {
        let last=end-1;
        while (last>=start && (bytes[last]&0xc0)===0x80) last--;
        if (last>=start) end=last;
      }
      const decoded=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(start,end));
      const chars=Array.from(decoded);
      const fragment=(tail?chars.slice(-limit):chars.slice(0,limit)).join('');
      if (!fragment) continue;
      const offset=tail?from+end-Buffer.byteLength(fragment):from+start;
      samples.push({offset,text:fragment.replace(/^\uFEFF/,'')});
      previousEnd=offset+Buffer.byteLength(fragment);
    }
    return samples;
  } finally {fs.closeSync(fd);}
}
try {
  if (!process.argv[2]) throw new Error('用法：node style-sample.mjs 书根 [V002] 或 UTF-8参考文件 [段长]');
  const target=fs.realpathSync(process.argv[2]);
  if (fs.statSync(target).isFile()) console.log(JSON.stringify(sample(target,Number(process.argv[3]??400)),null,2));
  else {
    const chapters=path.join(target,'章节');
    const volumes=fs.readdirSync(chapters,{withFileTypes:true}).filter(e=>e.isDirectory() && /^V\d+$/.test(e.name))
      .map(e=>e.name).sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
    const chosen=process.argv[3]??volumes.at(-1);
    if (!volumes.includes(chosen)) throw new Error('找不到指定卷的正文章节');
    const result=[];
    for (const volume of new Set([volumes[0],chosen])) {
      const dir=path.join(chapters,volume);
      const files=fs.readdirSync(dir).filter(f=>/^C\d+\.md$/.test(f)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)));
      if (!files.length) throw new Error(volume+' 没有可抽样的章稿');
      for (const i of new Set([0,Math.floor(files.length/2),files.length-1])) {
        const excerpts=sample(path.join(dir,files[i]),500);
        if (excerpts.length) result.push({volume,chapter:files[i],...excerpts[Math.floor(excerpts.length/2)]});
      }
    }
    console.log(JSON.stringify(result,null,2));
  }
} catch(err) {console.error(err.message);process.exitCode=1;}
