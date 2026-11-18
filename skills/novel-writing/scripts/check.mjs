import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

function cells(line) {
  return line.trim().replace(/^[|｜]|[|｜]$/g,'').split(/(?<!\\)[|｜]/).map(s=>s.trim().replace(/\\\|/g,'|'));
}
function deadline(raw) {
  const normalized = raw.normalize('NFKC').replace(/[\s第章Cc]/g,'');
  const m = /^(\d+)(?:[-–—~～至到](\d+))?$/.exec(normalized);
  if (!m) return null;
  const first = Number(m[1]), last = Number(m[2] ?? first);
  return first > 0 && last >= first && Number.isSafeInteger(last) ? last : null;
}
export function checkThreads(root,head) {
  const out = {head,files:0,open:0,overdue:[],planPassed:[],unplanned:[],warnings:[]};
  const dir = path.join(root,'分卷');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory())
    .map(e=>'分卷/'+e.name+'/待回收.md').sort() : [];
  files.push('设定/待排伏笔.md');
  for (const file of files) {
    const src = path.join(root,file);
    if (!fs.existsSync(src)) continue;
    out.files++;
    let cols, sawTable=false;
    for (const [i,line] of fs.readFileSync(src,'utf8').split(/\r?\n/).entries()) {
      if (!/[|｜]/.test(line)) { cols=null; continue; }
      const fields = cells(line);
      const id = fields.findIndex(c=>/^(编号|ID|伏笔ID|伏笔编号)$/i.test(c));
      if (id>=0) {
        cols={id,plan:fields.findIndex(c=>/^(计划|预计|目标).*回收|^回收窗口$/.test(c)),state:fields.indexOf('状态')};
        if (cols.state<0 || cols.plan<0) { out.warnings.push({file,line:i+1,reason:'缺少状态或计划回收章列'}); cols=null; }
        else sawTable=true;
        continue;
      }
      if (!cols || fields.every(s=>/^:?-+:?$/.test(s))) continue;
      const key=fields[cols.id], status=fields[cols.state], plan=fields[cols.plan];
      const row={id:key,file,line:i+1,status,plan};
      if (!key || plan===undefined || !status) { out.warnings.push({...row,reason:'缺少编号、状态或单元格'}); continue; }
      if (/^(已回收|已兑现|已放弃|已关闭|开放结局)(?:$|[（(：:])/.test(status)) continue;
      out.open++;
      const due=deadline(plan);
      if (due!==null && due<=head) out.planPassed.push({...row,due});
      if (/逾期/.test(status) || (due!==null && due<=head)) out.overdue.push({...row,due});
      if (/^(?:[-—–／/无]|待定|未定|未安排|暂无|无计划|待排|TBD|N\/A)*$/i.test(plan)) out.unplanned.push(row);
      else if (due===null) out.warnings.push({...row,reason:'回收章无法解析'});
    }
    if (!sawTable) out.warnings.push({file,reason:'未找到可识别的伏笔表'});
  }
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync.native(process.argv[1])).href) {
  import('./book.mjs').then(({run})=>console.log(JSON.stringify(run(process.argv[2],'check',[]),null,2)))
    .catch(err=>{console.error(err.message);process.exitCode=1;});
}
