// 新建一本书的骨架：目录、00–04、设定分档、分卷/卷纲/章卡/待回收、空章节目录。
// 用法：node new-book.mjs <书根> [--title 书名] [--volumes 7] [--chapters 45] [--words 3000] [--init-ledger] [--force]
// 只建骨架，不写正文；已存在的文件默认不覆盖。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = { volumes: 7, chapters: 45, words: 3000, init: false, force: false, title: '', editor: '主编' };
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--title') opt.title = args[++i] ?? '';
  else if (a === '--volumes') opt.volumes = Number(args[++i]);
  else if (a === '--chapters') opt.chapters = Number(args[++i]);
  else if (a === '--words') opt.words = Number(args[++i]);
  else if (a === '--init-ledger') opt.init = true;
  else if (a === '--force') opt.force = true;
  else rest.push(a);
}
const root = rest[0];
if (!root || !Number.isInteger(opt.volumes) || opt.volumes < 1 || opt.volumes > 99 ||
    !Number.isInteger(opt.chapters) || opt.chapters < 1 || opt.chapters > 999) {
  console.error('用法：node new-book.mjs <书根> [--title 书名] [--volumes 7] [--chapters 45] [--words 3000] [--init-ledger] [--force]');
  process.exit(2);
}
const title = opt.title || path.basename(path.resolve(root));
const pad = (n, w = 2) => String(n).padStart(w, '0');
const volTag = n => 'V' + pad(n, 3);
const chapTag = n => 'C' + pad(n, 6);

let created = 0, skipped = 0;
function write(rel, body) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !opt.force) { skipped++; return; }
  fs.writeFileSync(file, body, { encoding: 'utf8' });
  created++;
}

const totalChapters = opt.volumes * opt.chapters;
const totalWords = totalChapters * opt.words;

// 00 创作说明
write('00-创作说明.md', `# ${title} · 创作说明

> 本文件是这部书的「需求书」：题材、要求、交付偏好。开写前读一遍，改需求也改这里。

## 一句话设想
（待填：这本书讲什么，一句话说清）

## 题材与标签
（待填：例：变白/百合向、系统流、悲剧结局；给谁看）

## 硬要求
- 总规模：${opt.volumes} 卷 × ${opt.chapters} 章 × 约 ${opt.words} 字 ≈ ${totalChapters} 章、约 ${(totalWords / 10000).toFixed(0)} 万字
- 章节字数：每章 ${opt.words} 字左右
- 叙述视角：（待填：第一人称／第三人称限知）
- 基调与尺度：（待填）
- 结局：（待填：本作正文为悲剧结局，番外另议）

## 交付偏好
- 长篇默认一次授权 5 章（\`grant batch 5\`），批满汇总后等确认
- 每卷末必须做卷审：跑 \`check\` 清伏笔逾期、跑 \`style-sample\` 比对文风、跑 \`wordcount\` 对字数
- 正文交付只给路径与摘要，不在对话里复述整章
`);

// 01 大纲（卷表）
const rows = [];
for (let v = 1; v <= opt.volumes; v++) {
  const first = (v - 1) * opt.chapters + 1;
  const last = v * opt.chapters;
  rows.push(`| ${volTag(v)} | ${chapTag(first)}–${chapTag(last)} | ${opt.chapters} | 约 ${(opt.chapters * opt.words / 10000).toFixed(1)} 万字 | （待填：本卷核心冲突） | （待填：卷终变化） |`);
}
write('01-大纲.md', `# ${title} · 全书大纲

> 卷表管全书节奏；每卷的细纲在 \`分卷/Vxxx/卷纲.md\`，章纲在 \`分卷/Vxxx/章纲/\`。
> 远期卷只写目标，细化当前卷。

## 卷表

| 卷 | 章号区间 | 章数 | 字数预算 | 核心冲突 | 卷终变化 |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## 主线一句话
（待填）

## 伏笔总原则
- 伏笔先登记再埋，编号 F001 起，连续不复用
- 埋设时写进目标卷的 \`分卷/Vxxx/待回收.md\`；没有预定卷的写进 \`设定/待排伏笔.md\`
- 每卷末跑 \`book.mjs 书根 check\`，overdue 清零才开下一卷
`);

// 02 设定圣经（硬规则 + 索引入口）
write('02-设定圣经.md', `# ${title} · 设定硬规则

> 这里只放**全书级、不容推翻**的规则，控制在 5000 字以内。
> 人物、组织、地点的细节一律分档到 \`设定/\`，别往这里堆。

## 世界规则
（待填：世界的基本运行规则、代价机制、禁忌）

## 三主角（或核心角色一句话定位）
（待填）

## 终局机制
（待填：结局在结构上如何成立）

## 分档索引入口
- 人物：\`设定/人物/<编号或名>.md\`
- 伏笔：\`分卷/Vxxx/待回收.md\`、\`设定/待排伏笔.md\`
- 待排伏笔：\`设定/待排伏笔.md\`

## 禁忌
（待填：绝对不能出现的写法与设定冲突）
`);

// 03 进度日志（只作指针）
write('03-进度日志.md', `# 进度日志

> 授权、额度、最后定稿章号**一律以账本为准**：\`node book.mjs <书根> status\`。
> 本文件只写剧情位置与下一步，不要手填开关数字。

## 当前位置
- 已定稿至：第 0 章（尚未开始）
- 剧情位置：（待填）

## 下一步
- （待填：下一章要做什么）

## 待决问题
- （待填：需要作者拍板的剧情分叉）
`);

// 04 文风设定
write('04-文风设定.md', `# ${title} · 文风设定

> 正文唯一的文风权威。每章开写前读它，交付前自查有没有走样。

## 叙述视角与人称
（待填）

## 句长与节奏
（待填：例：短句为主，平均 15–20 字；每段不超过 4 行）

## 用词层级
（待填）

## 对白与描写比例
（待填）

## 意象与比喻偏好
（待填）

## 标点与排版习惯
（待填）

## 章节收束与钩子
（待填）

## 忌用清单
（待填：套话、总结式抒情、四字堆砌……）

## 不得模仿项
（若参考了别人的作品：列出原作人物名、地名、专有名词、独有设定与桥段）
`);

// 设定分档
write('设定/待排伏笔.md', `# 待排伏笔

| 编号 | 埋设章 | 内容 | 计划回收章 | 状态 |
| --- | --- | --- | --- | --- |
`);
fs.mkdirSync(path.join(root, '设定', '人物'), { recursive: true });
fs.mkdirSync(path.join(root, '设定', '地点'), { recursive: true });
fs.mkdirSync(path.join(root, '设定', '组织'), { recursive: true });
fs.mkdirSync(path.join(root, '设定', '物品'), { recursive: true });

// 分卷骨架
for (let v = 1; v <= opt.volumes; v++) {
  const tag = volTag(v);
  const first = (v - 1) * opt.chapters + 1;
  const last = v * opt.chapters;
  write(`分卷/${tag}/卷纲.md`, `# ${tag} 卷纲

> 本卷章号：${chapTag(first)}–${chapTag(last)}（${opt.chapters} 章）。卷纲只写目标，细节进章纲。

## 本卷目标
（待填）

## 起承转合
- 起：
- 承：
- 转：
- 合：

## 卷终状态
（待填：人物关系、知情边界、世界状态的变化）

## 与前后卷的衔接
（待填）
`);
  write(`分卷/${tag}/待回收.md`, `# ${tag} 待回收伏笔

| 编号 | 埋设章 | 内容 | 计划回收章 | 状态 |
| --- | --- | --- | --- | --- |
`);
  fs.mkdirSync(path.join(root, '分卷', tag, '章纲'), { recursive: true });
  fs.mkdirSync(path.join(root, '分卷', tag, '章卡'), { recursive: true });
  fs.mkdirSync(path.join(root, '章节', tag), { recursive: true });
}

// 可选：建账本（真的调用 book.mjs 的 init，不只是写一句话）
let ledger;
const ledgerFile = path.join(root, '协作', '写作.sqlite');
if (opt.init) {
  try {
    const { run } = await import('./book.mjs');
    const state = run(root, 'init', [opt.editor, '0']);
    ledger = `（已建账：editor=${state.editor}，rev=${state.rev}，head=${state.head}）`;
  } catch (err) {
    ledger = `（建账失败：${err.message}——可手动跑 book.mjs <书根> init <主编标识> 0）`;
  }
} else if (fs.existsSync(ledgerFile)) {
  ledger = '（账本已存在，本次没有重建）';
} else {
  ledger = '（未建账；需要时运行 book.mjs <书根> init <主编标识> 0）';
}

console.log(JSON.stringify({
  root: path.resolve(root), title,
  volumes: opt.volumes, chaptersPerVolume: opt.chapters, wordsPerChapter: opt.words,
  totalChapters, totalWords,
  filesCreated: created, filesSkipped: skipped,
  ledger,
  next: opt.init ? '下一步：填 00/01/02/04，然后授权写第一章' : '下一步：运行 book.mjs <书根> init <主编标识> 0'
}, null, 2));
