// One local SQLite ledger per book. All cooperating sessions use this entry point.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { checkThreads } from './check.mjs';
import { snapshotBook } from './backup.mjs';

const require = createRequire(import.meta.url);
function sqlite() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const fallback = '可退回单会话模式，逐章人工确认；已有账本的书请使用 DSH 自带 Node 继续定稿。';
  if (major < 22 || (major === 22 && minor < 5))
    throw new Error('需要 Node ≥ 22.5（当前 ' + process.versions.node + '）。' + fallback);
  try { return require('node:sqlite').DatabaseSync; }
  catch (err) {
    if (!['ERR_UNKNOWN_BUILTIN_MODULE','MODULE_NOT_FOUND'].includes(err.code)) throw err;
    throw new Error('需要 Node ≥ 22.5 且支持 node:sqlite。可试用 node --experimental-sqlite 或 DSH 自带 Node。' + fallback);
  }
}

const usage = `node book.mjs BOOK COMMAND [args]
init EDITOR LAST_EXISTING_CHAPTER | status | pending | check | backup [--force]
grant EDITOR REV single|batch|parallel COUNT SOURCE | stop EDITOR REV | transfer EDITOR REV NEW_EDITOR
pause SESSION REV USER_REQUEST
offer EDITOR REV KEY BRIEF [PROSE_CHAPTER] | take KEY OWNER | claim KEY OWNER [PROSE_CHAPTER]
reassign KEY TOKEN NEW_OWNER | submit KEY TOKEN DRAFT_FILE
task KEY | tasks open|active|ready|done|closed [OFFSET]
prepare EDITOR REV edit PATH ... | prepare EDITOR REV publish CHAPTER VOLUME [EXTRA_PATH ...]
prepare EDITOR REV short CHAPTER 章节/第NN章-标题.md [EXTRA_PATH ...]
hash BOOK_RELATIVE_PATH ... | commit EDITOR MANIFEST_JSON`;

function check(ok, message) { if (!ok) throw new Error(message); }
function number(value, label, min = 0) {
  check(/^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= min, '无效的' + label);
  return Number(value);
}
function label(value) {
  check(typeof value === 'string' && value.trim() && value.length <= 160 && !/[\x00-\x1f]/.test(value), '名称或任务键无效');
  return value;
}
function relative(value) {
  check(typeof value === 'string' && value.length > 0 && value === value.normalize('NFC') &&
    value.split('/').every(s => s && !/[<>:"\\|?*\x00-\x1f]/.test(s) && !/[. ]$/.test(s) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)), '需要书内相对路径，以 / 分隔');
  return value;
}
function inside(root, rel) {
  let current = root;
  for (const segment of relative(rel).split('/')) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current, {throwIfNoEntry: false});
    check(!stat?.isSymbolicLink(), '路径经过链接：' + rel);
  }
  return current;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function diskHash(filename) {
  try { return digest(fs.readFileSync(filename)); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
function readText(file) {
  const text = new TextDecoder('utf-8', {fatal: true}).decode(fs.readFileSync(file));
  check(text.trim(), '空稿件：' + file);
  return text;
}
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}
const globalFiles = ['00-创作说明.md','01-大纲.md','02-设定圣经.md','03-进度日志.md','04-文风设定.md'];
function canonical(rel) {
  return globalFiles.includes(rel) || /^(分卷|设定|章节)\/.+\.md$/.test(rel);
}

const progressPath = '03-进度日志.md';
const switchHeading = /^##\s+写作开关[^\r\n]*\r?$/m;
const switchField = /^\s*[-*]\s*(连写模式|剩余可连写章数|开启来源|到期行为)[：:]\s*([^\r\n]*)$/;
function legacyProgress(text) {
  const heading = switchHeading.exec(text);
  if (!heading) return null;
  const lines = text.slice(heading.index + heading[0].length).split(/\r?\n/);
  const fields = {};
  let end = 0;
  while (end < lines.length) {
    const line = lines[end];
    const match = line.match(switchField);
    if (match) fields[match[1]] = match[2].trim();
    else if (line.trim()) break;
    end++;
  }
  const remaining = Number(fields['剩余可连写章数']);
  const source = fields['开启来源'];
  const active = fields['连写模式'] === '开启';
  const valid = active && Number.isInteger(remaining) && remaining >= 1 && remaining <= 10 && source && !/^[—－-]/.test(source);
  return {remaining:valid ? remaining : 0, source:valid ? source : '', ambiguous:active && !valid,
    text:text.slice(0,heading.index) + '> 写作授权与剩余额度见 book.mjs status。\n\n' + lines.slice(end).join('\n')};
}

function shortChapter(rel, chapter) {
  const match = /^章节\/第(\d+)章-[^/]+\.md$/.exec(rel);
  return match && Number(match[1]) === chapter;
}

// Finish a durable commit before serving the next command. A crash after rename
// is safe: the next process recognizes the desired bytes and continues.
function materialize(db, root) {
  for (const row of db.prepare('SELECT * FROM pending ORDER BY id').all()) {
    const dest = inside(root, row.rel);
    const actual = diskHash(dest);
    if (actual !== digest(row.body)) {
      check(actual === row.before_hash, '定稿文件发生外部修改：' + row.rel + '。用 pending 查看恢复信息。');
      fs.mkdirSync(path.dirname(dest), {recursive: true});
      const temp = dest + '.novel-' + randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temp, row.body, {flag: 'wx', flush: true});
        fs.renameSync(temp, dest);
      } finally { fs.rmSync(temp, {force: true}); }
    }
  }
  db.exec('DELETE FROM pending');
}

export function run(book, cmd, args) {
  const DatabaseSync = sqlite();
  check(book && cmd, usage);
  const root = fs.realpathSync(book);
  const folder = inside(root, '协作');
  if (cmd === 'init') fs.mkdirSync(folder, {recursive: true});
  const file = inside(root, '协作/写作.sqlite');
  check(cmd === 'init' || fs.existsSync(file), '该书尚未 init');
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=15000');
    if (cmd === 'init') {
      const initialized = transaction(db, () => {
        const editor = label(args[0]), head = number(args[1], '既有章数');
        db.exec(`CREATE TABLE IF NOT EXISTS book (
          id INTEGER PRIMARY KEY CHECK(id=1), editor TEXT, rev INTEGER, head INTEGER,
          volume INTEGER, remaining INTEGER, mode TEXT, source TEXT, epoch INTEGER);
          CREATE TABLE IF NOT EXISTS tasks (
          key TEXT PRIMARY KEY, owner TEXT, token TEXT, chapter INTEGER, base INTEGER,
          epoch INTEGER, state TEXT, body TEXT, brief TEXT);
          CREATE INDEX IF NOT EXISTS tasks_state ON tasks(state,key);
          CREATE INDEX IF NOT EXISTS tasks_chapter ON tasks(chapter,state);
          CREATE TABLE IF NOT EXISTS pending (
          id INTEGER PRIMARY KEY, rel TEXT UNIQUE, before_hash TEXT, body TEXT);`);
        const result = db.prepare("INSERT OR IGNORE INTO book VALUES (1,?,0,?,0,0,'closed','',0)").run(editor, head);
        materialize(db, root);
        const progress = inside(root,progressPath);
        const legacy = fs.existsSync(progress) && legacyProgress(fs.readFileSync(progress,'utf8'));
        let migration;
        if (legacy) {
          if (result.changes && legacy.remaining)
            db.prepare("UPDATE book SET remaining=?,mode='batch',source=?,epoch=1").run(legacy.remaining,legacy.source);
          db.prepare('INSERT INTO pending(rel,before_hash,body) VALUES (?,?,?)').run(progressPath,diskHash(progress),legacy.text);
          migration = result.changes && legacy.ambiguous ? '旧授权不完整，已暂停，请确认后再授权' : '已移除日志旧开关，以账本为准';
        }
        return {initialized: Boolean(result.changes), migration, ...db.prepare('SELECT * FROM book').get()};
      });
      if (initialized.migration) transaction(db, () => materialize(db,root));
      return initialized;
    }
    if (cmd === 'pending') return db.prepare('SELECT rel,before_hash,body FROM pending ORDER BY id').all().map(
      ({rel,before_hash,body}) => ({path:rel, before:before_hash, after:digest(body)}));
    const result = transaction(db, () => {
      materialize(db, root);
      const state = db.prepare('SELECT * FROM book WHERE id=1').get();
      const lookup = key => {
        const row = db.prepare('SELECT key,owner,token,chapter,base,epoch,state,brief FROM tasks WHERE key=?').get(label(key));
        check(row, '找不到任务'); return row;
      };
      const gate = (editor, rev) => {
        check(editor === state.editor, '只有当前主编可以变更定稿或授权');
        check(number(rev,'基线版本') === state.rev, '书的版本已变化，请重读 status 和有关文件');
      };
      const status = () => db.prepare('SELECT * FROM book WHERE id=1').get();
      const checkWindow = ch => {
        if (ch !== null) check(ch > state.head && ch <= state.head + state.remaining &&
          (state.mode === 'parallel' || ch === state.head + 1), '正文任务超出已授权范围');
      };
      switch (cmd) {
        case 'status': return state;
        case 'check': return checkThreads(root,state.head);
        case 'backup': {
          check(!args.length || (args.length === 1 && args[0] === '--force'),'backup [--force]');
          return snapshotBook(root,state,Boolean(args.length), target => {
            const reader = new DatabaseSync(file,{readOnly:true});
            try { reader.prepare('VACUUM INTO ?').run(target); } finally { reader.close(); }
          });
        }
        case 'hash':
          return args.map(rel => ({path:relative(rel), before:diskHash(inside(root,rel))}));
        case 'grant': {
          const [editor, rev, mode] = args;
          const defaultBatch = mode === 'batch' && args.length === 4;
          if (defaultBatch) check(!/^\d+$/.test(args[3]),'给出章数时还需提供用户授权原话');
          const n = defaultBatch ? 5 : args[3];
          const source = defaultBatch ? args[3] : args[4];
          gate(editor, rev);
          const count = number(n,'授权章数',1);
          check(!state.remaining && ((mode === 'single' && count === 1) || (['batch','parallel'].includes(mode) && count <= 10)), '已有授权或章数无效');
          check(source?.trim(), '需要用户授权原话或消息标识');
          db.prepare('UPDATE book SET mode=?,remaining=?,source=?,rev=rev+1,epoch=epoch+1').run(mode,count,source);
          return status();
        }
        case 'pause':
        case 'stop': {
          let source = state.source;
          if (cmd === 'stop') gate(...args);
          else {
            check(number(args[1],'基线版本') === state.rev, '请重读 status');
            check(args[2]?.trim(), '需要用户暂停原话');
            source = label(args[0]) + '：' + args[2];
          }
          db.prepare("UPDATE book SET remaining=0,mode='closed',source=?,rev=rev+1,epoch=epoch+1").run(source);
          db.exec("UPDATE tasks SET state='closed' WHERE chapter IS NOT NULL AND state IN ('open','active','ready')");
          return status();
        }
        case 'transfer':
          gate(...args);
          db.prepare('UPDATE book SET editor=?,rev=rev+1').run(label(args[2]));
          return status();
        case 'offer': {
          const [editor, rev, key, brief, chapter] = args;
          gate(editor,rev);
          check(brief?.trim(),'缺少任务说明');
          const ch = chapter === undefined ? null : number(chapter,'全书章号',1);
          checkWindow(ch);
          db.prepare("INSERT INTO tasks VALUES (?,NULL,NULL,?,?,?,'open',NULL,?)")
            .run(label(key),ch,state.rev,state.epoch,brief);
          return lookup(key);
        }
        case 'take': {
          const [key, owner] = args;
          const job = lookup(key);
          check(job.state === 'open','任务已被领取或关闭');
          checkWindow(job.chapter);
          db.prepare("UPDATE tasks SET owner=?,token=?,state='active' WHERE key=?").run(label(owner),randomUUID(),key);
          return lookup(key);
        }
        case 'claim': {
          const [key, owner, chapter] = args;
          const ch = chapter === undefined ? null : number(chapter,'全书章号',1);
          checkWindow(ch);
          db.prepare("INSERT INTO tasks VALUES (?,?,?,?,?,?,'active',NULL,NULL)").run(label(key),label(owner),randomUUID(),ch,state.rev,state.epoch);
          return lookup(key);
        }
        case 'reassign': {
          const [key, token, owner] = args;
          const job = lookup(key);
          check(job.token === token && job.state === 'active', '任务已提交或已转交');
          check(job.chapter === null || (job.epoch === state.epoch && job.chapter > state.head), '旧批次任务请新建任务键');
          db.prepare('UPDATE tasks SET owner=?,token=? WHERE key=?').run(label(owner),randomUUID(),key);
          return lookup(key);
        }
        case 'submit': {
          const [key, token, draft] = args;
          const job = lookup(key);
          check(job.token === token && job.state === 'active', '任务已提交或已转交');
          check(job.chapter === null || (job.epoch === state.epoch && job.chapter > state.head && state.remaining), '正文任务授权已结束');
          const body = readText(inside(root,'协作/草稿/' + token + '/' + relative(draft)));
          db.prepare("UPDATE tasks SET body=?,state='ready' WHERE key=?").run(body,key);
          return lookup(key);
        }
        case 'task':
          return {...lookup(args[0]), body:db.prepare('SELECT body FROM tasks WHERE key=?').get(args[0]).body};
        case 'tasks': {
          check(['open','active','ready','done','closed'].includes(args[0]), '任务状态无效');
          return db.prepare('SELECT key,owner,token,chapter,base,epoch,state FROM tasks WHERE state=? ORDER BY key LIMIT 50 OFFSET ?')
            .all(args[0],number(args[1] ?? 0,'偏移量'));
        }
        case 'prepare': {
          const [editor, rev, kind, ...params] = args;
          gate(editor,rev);
          const manifest = {rev:state.rev, kind, files:[], tasks:[]};
          if (kind === 'short') {
            manifest.chapter = number(params.shift(),'章号',1);
            check(manifest.chapter === state.head + 1 && state.remaining && shortChapter(params[0],manifest.chapter),'短篇章号、文件名或授权不符');
            params.push(progressPath);
          } else if (kind === 'publish') {
            manifest.chapter = number(params.shift(),'章号',1);
            manifest.volume = number(params.shift(),'卷号',1);
            check(manifest.chapter === state.head + 1 && state.remaining && manifest.volume >= state.volume, '不在当前定稿范围内');
            const v = 'V' + String(manifest.volume).padStart(3,'0');
            const c = 'C' + String(manifest.chapter).padStart(6,'0') + '.md';
            params.unshift('章节/' + v + '/' + c,'分卷/' + v + '/章卡/' + c,'03-进度日志.md');
          } else check(kind === 'edit' && params.length, 'edit 需要书内文件路径');
          const id = randomUUID();
          const stage = inside(root, '协作/合稿/' + id);
          for (const [i, rel] of [...new Set(params)].entries()) {
            check(canonical(relative(rel)), '无效定稿路径：' + rel);
            const dest = inside(root,rel);
            const before = diskHash(dest);
            const name = String(i+1) + '-' + path.basename(rel);
            fs.mkdirSync(stage,{recursive:true});
            if (before === null) fs.writeFileSync(path.join(stage,name),'',{flag:'wx'});
            else if (rel === progressPath) {
              const original = fs.readFileSync(dest,'utf8');
              fs.writeFileSync(path.join(stage,name),legacyProgress(original)?.text ?? original,{flag:'wx'});
            } else fs.copyFileSync(dest,path.join(stage,name),fs.constants.COPYFILE_EXCL);
            manifest.files.push({path:rel,before,source:id + '/' + name});
          }
          const filename = path.join(stage,'manifest.json');
          fs.writeFileSync(filename,JSON.stringify(manifest,null,2),{flag:'wx'});
          return {manifest:filename, ...manifest};
        }
        case 'commit': {
          const [editor, manifestFile] = args;
          const m = JSON.parse(readText(manifestFile));
          gate(editor,m.rev);
          check(['edit','publish','short'].includes(m.kind), '未知提交类型');
          check(Array.isArray(m.files) && m.files.length > 0, '提交缺少文件');
          const isChapter = m.kind !== 'edit';
          const ch = state.head + 1;
          const volume = m.kind === 'publish' ? number(m.volume,'卷号',1) : state.volume;
          const v = 'V' + String(volume).padStart(3,'0'), c = 'C' + String(ch).padStart(6,'0');
          const chapterPath = m.kind === 'short' ? m.files.find(f=>shortChapter(f.path,ch))?.path : '章节/' + v + '/' + c + '.md';
          const cardPath = '分卷/' + v + '/章卡/' + c + '.md';
          if (isChapter) {
            check(m.chapter === ch && state.remaining > 0 && volume >= state.volume, '章号、卷序或授权不匹配');
            check(chapterPath,'缺少短篇正文');
            for (const required of m.kind === 'short' ? [chapterPath,progressPath] : [chapterPath,cardPath,progressPath])
              check(m.files.some(f => f.path === required), '缺少定稿文件：' + required);
          }
          const seen = new Set();
          const stage = db.prepare('INSERT INTO pending(rel,before_hash,body) VALUES (?,?,?)');
          for (const f of m.files) {
            const rel = relative(f.path);
            check(canonical(rel) && !seen.has(rel.toLowerCase()), '无效或重复的定稿路径：' + rel);
            seen.add(rel.toLowerCase());
            const actual = diskHash(inside(root,rel));
            check(f.before === actual, '文件基线已变化或缺少 before：' + rel);
            if (isChapter && (rel === chapterPath || rel === cardPath)) check(actual === null, '新章或章卡已存在');
            if (rel.startsWith('章节/')) check(isChapter ? rel === chapterPath : actual !== null, '正文路径不属于本次提交');
            const body = readText(inside(root,'协作/合稿/' + relative(f.source)));
            if (rel === progressPath) check(!switchHeading.test(body) && !body.split(/\r?\n/).some(line=>switchField.test(line)), '03 只记录剧情，授权由 status 管理');
            stage.run(rel,actual,body);
          }
          for (const key of m.tasks ?? []) {
            const job = lookup(key);
            check(job.state === 'ready', '任务尚未提交或已合并：' + key);
            if (job.chapter !== null) check(isChapter && job.chapter === ch && job.epoch === state.epoch, '任务不属于本章授权');
            if (job.base !== state.rev) check(m.reviewedAt?.[key] === state.rev, '请复核旧任务与当前设定：' + key);
            db.prepare("UPDATE tasks SET state='done' WHERE key=?").run(key);
          }
          if (isChapter) db.prepare(`UPDATE book SET head=?, volume=?, remaining=remaining-1,
            mode=CASE WHEN remaining=1 THEN 'closed' ELSE mode END, rev=rev+1`).run(ch,volume);
          else db.exec('UPDATE book SET rev=rev+1');
          if (isChapter) db.prepare("UPDATE tasks SET state='closed' WHERE chapter=? AND state IN ('open','active','ready')").run(ch);
          return status();
        }
        default: throw new Error(usage);
      }
    });
    if (cmd === 'commit') transaction(db, () => materialize(db,root));
    return result;
  } finally { db.close(); }
}

if (process.argv[1] && fs.existsSync(process.argv[1]) &&
    import.meta.url === pathToFileURL(fs.realpathSync.native(process.argv[1])).href) {
  try {
    const [, , book, cmd, ...args] = process.argv;
    console.log(JSON.stringify(run(book,cmd,args),null,2));
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
