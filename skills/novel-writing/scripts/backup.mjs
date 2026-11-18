import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Called while the book's write transaction excludes other ledger publishers.
export function snapshotBook(root, state, force, copyDatabase) {
  const parent = path.join(root,'协作','备份');
  fs.mkdirSync(parent,{recursive:true});
  if (fs.lstatSync(parent).isSymbolicLink()) throw new Error('备份目录不能是链接');
  const stamp = date => date.toISOString().replace(/:/g,'-');
  const cutoff = stamp(new Date(Date.now()-60*60*1000));
  const previous = fs.readdirSync(parent,{withFileTypes:true}).filter(e => e.isDirectory() &&
    /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z$/.test(e.name)).map(e=>e.name).sort().pop();
  if (!force && previous && previous >= cutoff)
    return {created:false, reason:'距上次快照不足 60 分钟', path:path.join(parent,previous)};

  const staging = fs.mkdtempSync(path.join(parent,'.partial-'));
  const sqlite = '协作/写作.sqlite';
  let files = 0;
  function copyDir(rel) {
    for (const entry of fs.readdirSync(path.join(root,rel),{withFileTypes:true})) {
      const key = rel ? rel+'/'+entry.name : entry.name;
      if (key === '协作/备份' || [sqlite,sqlite+'-journal',sqlite+'-wal',sqlite+'-shm'].includes(key)) continue;
      if (entry.isSymbolicLink()) throw new Error('书内含链接，请先核对备份范围：'+key);
      const from = path.join(root,key), to = path.join(staging,key);
      if (entry.isDirectory()) { fs.mkdirSync(to); copyDir(key); continue; }
      if (!entry.isFile()) throw new Error('无法快照：'+key);
      const before = fs.statSync(from,{bigint:true});
      fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
      const after = fs.statSync(from,{bigint:true});
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs)
        throw new Error('复制期间稿件发生变化，请重试：'+key);
      files++;
    }
  }
  try {
    copyDir('');
    copyDatabase(path.join(staging,sqlite));
    let date = new Date();
    while (fs.existsSync(path.join(parent,stamp(date)))) date = new Date(date.getTime()+1);
    const dest = path.join(parent,stamp(date));
    fs.renameSync(staging,dest);
    return {created:true,path:dest,rev:state.rev,head:state.head,files:files+1};
  } catch (err) {
    if (path.dirname(staging) === parent && path.basename(staging).startsWith('.partial-'))
      fs.rmSync(staging,{recursive:true,force:true});
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync.native(process.argv[1])).href) {
  import('./book.mjs').then(({run}) => {
    console.log(JSON.stringify(run(process.argv[2],'backup',process.argv.slice(3)),null,2));
  }).catch(err => { console.error(err.message); process.exitCode=1; });
}
