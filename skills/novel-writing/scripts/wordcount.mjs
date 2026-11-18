import fs from 'node:fs';
import path from 'node:path';

// Count Unicode letters and numbers in prose; skip ATX headings and code fences.
function count(file) {
  let total=0, fence=null;
  for (const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    const marker=/^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) { fence=marker; continue; }
    if (fence) { if (marker?.startsWith(fence)) fence=null; continue; }
    if (!/^\s*#{1,6}(?:\s|$)/.test(line)) total += (line.match(/[\p{L}\p{N}]/gu)??[]).length;
  }
  return total;
}
try {
  if (!process.argv[2]) throw new Error('用法：node wordcount.mjs 书根或正文章节文件');
  const target=fs.realpathSync(process.argv[2]);
  if (fs.statSync(target).isFile()) console.log(JSON.stringify({file:target,characters:count(target)}));
  else {
    const byVolume={}, report={chapters:0,characters:0,byVolume};
    function scan(dir,volume) {
      for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
        const file=path.join(dir,e.name);
        if (e.isDirectory()) scan(file,volume==='单章目录'?e.name:volume);
        else if (e.isFile() && /\.md$/i.test(e.name)) {
          const n=count(file);
          const group=byVolume[volume]??={chapters:0,characters:0};
          group.chapters++;group.characters+=n;report.chapters++;report.characters+=n;
        }
      }
    }
    scan(path.join(target,'章节'),'单章目录');
    console.log(JSON.stringify(report,null,2));
  }
} catch(err) {console.error(err.message);process.exitCode=1;}
