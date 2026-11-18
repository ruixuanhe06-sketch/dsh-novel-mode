# dsh-novel-mode · 小说创作模式

一个给 **DeepSeek Harness** 用的 agent preset：以「章」为最小单位写小说，写完一章停下来，讲已完成文本交给人工审阅；长篇则用分卷结构、共享账本与任务分工，可以让多个会话或多个子代理在同一本书上协作。

它不追求「一句话生成整本小说」，而是把写长篇时**必然出问题的那几件问题**，拆成有工序、有文件、有校验的流程。

---

## 来源与致谢

- **代码实现**：基本由 **GPT-6.2 Astra**（OpenAI）与 **DeepSeek V4.1 Flash 1017** 产生——前者承担了账本、并发、原子定稿与脚本的主体实现，后者参与了提示词结构、评审与问题定位。
- **设计思路、需求定义与验收标准**：来自作者。包括「一章一交付」「设定圣经／文风档案双档」「分卷 + 章卡」「只借文风不借内容」「验收要落到能跑通的命令」这些规矩。

---

## 它解决什么

让 AI 写短篇很容易，写长篇几乎一定会出现问题：

| 问题 | 表现 | 本模式的对策 |
| --- | --- | --- |
| 设定漂移 | 第三章的人物性格到第十一章就变了 | 设定圣经 + 人物分档，每章开写前**真实读取**文件，不凭记忆 |
| 伏笔丢失 | 只会埋伏笔，而忘记补上 | 伏笔登记表 + `check` 子命令按章号报逾期 |
| 文风走样 | 越写越像模型默认腔调 | 文风档案 `04` 是可执行规则；`style-sample` 抽样比对 |
| 一口气写崩 | 一次生成过多，后面生成内容过水，无法修改 | 逐章定稿；长篇按批授权，批满必停 |

---

### 两种模式

### 单会话

`<书名>/` 下五个文件 + `章节/`，一章一文件，默认**一章一交付**。适合 20–50 章的短篇。

### 长篇（分卷 + 账本 + 协作）

```
<书名>/
  00-创作说明.md   需求书：题材、规模、视角、交付偏好
  01-大纲.md       全书卷表：每卷章号区间、字数预算、核心冲突
  02-设定圣经.md   全书级硬规则（≤5000 字），细节分档到 设定/
  03-进度日志.md   剧情位置、下一步（授权与额度不写这里，以账本为准）
  04-文风设定.md   文风权威：句长、对白比例、意象、钩子、忌用清单
  设定/            人物/ 地点/ 组织/ 物品/ 待排伏笔.md（实体分档）
  分卷/V001/       卷纲.md、章纲/、章卡/、待回收.md
  章节/V001/       正文（C000001.md …，全书章号单调递增）
  协作/            写作.sqlite、合稿/、草稿/、备份/
```

要点：

- **章号全书连续**，换卷不重置；章卡记录结果、人物知情边界、时间地点、伏笔、实际字数。
- **授权走账本**：`grant single 1` / `grant batch 5` / `grant parallel N`，额度和最后定稿章号由 `book.mjs status` 给出，`03` 只是指针。
- **定稿是原子的**：`prepare` 记录目标文件的原始哈希，`commit` 先把内容写进 SQLite 再逐个 rename 落盘；崩了能回放，别人偷改会被 `pending` 抓出来。
- **多人协作**：任务键（如 `V002-C000101-S01`）+ `offer / take / submit`；`transfer` 换主编不断章号，`reassign` 换作者时旧 token 失效。

---

## 安装

1. 把本仓库放到 DSH 的 bundle 目录下，例如
   `C:\Users\<你的用户名>\.dsh\bundles\novel-mode`
2. 编辑 `cordis.patch.yml`，把 `customSkillDirs` 里那条占位路径改成你的真实路径：

   ```yaml
   - C:/Users/<你的用户名>/.dsh/bundles/novel-mode/skills
   ```

   > 必须是**绝对路径字面量**。不要写成 `!!js` + `createRequire(baseUrl)`：bundle patch 的 `baseUrl` 是 bundle 自己的目录，解析不到本包名，表达式抛错会让整个 preset 变成 broken。
3. 在 DSH 里装：

   ```
   plugin_manager  action: install_bundle
                   target: <上面的绝对路径>
   ```
4. **刷新页面**（模式名册只在页面加载时拉取），新建会话，在模式选择器里选「小说创作」。

升级：`remove_bundle` → 覆盖文件 → `install_bundle`。改 `skills/` 下的内容不需要重装（技能目录被监视）。

---

## 环境要求

- **DeepSeek Harness**（桌面版自带运行时即可）
- **Node ≥ 22.5**：账本脚本使用内置 `node:sqlite`。低于此版本会直接报 `ERR_UNKNOWN_BUILTIN`——脚本入口已加版本检查，会提示改用 DSH 自带 Node，或退回「无账本的单会话模式」（逐章人工确认、直接存正文）。
- 脚本只用 Node 内置模块，**没有第三方依赖**，不需要 `npm install`。

---

## 命令速查

脚本都在 `skills/novel-writing/scripts/`。习惯上先把路径定成变量

例子：

```powershell
$book   = 'D:\小说\潮声'
$tools  = 'C:\Users\<你的用户名>\.dsh\bundles\novel-mode\skills\novel-writing\scripts'
$node   = 'C:\Users\<你的用户名>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
```

### 建书（小说骨架生成）

```powershell
& $node "$tools\new-book.mjs" $book --title 潮声 --volumes 7 --chapters 45 --words 3000 --init-ledger
```

生成 00–04、`设定/` 四个分档目录与 `待排伏笔.md`、7 卷的 `卷纲/章纲/章卡/待回收` 与空 `章节/Vxxx/`，可选同时建账本。**只建骨架，不写正文**；已存在的文件默认跳过，要覆盖加 `--force`。

### 账本

```powershell
& $node "$tools\book.mjs" $book init 主编 0          # 新书建账（主编标识，最后已定稿章号）
& $node "$tools\book.mjs" $book status               # editor / rev / head / mode / remaining
& $node "$tools\book.mjs" $book grant 主编 1 batch 5 "用户原话"   # 授权 5 章
& $node "$tools\book.mjs" $book prepare 主编 2 publish 6 1 '设定/人物/P007.md'
& $node "$tools\book.mjs" $book commit 主编 '<manifest.json 路径>'
& $node "$tools\book.mjs" $book tasks ready          # 收子代理/协作者的稿
```

### 校验

```powershell
& $node "$tools\book.mjs" $book check        # 伏笔：逾期 / 计划已过 / 无计划 / 格式异常
& $node "$tools\book.mjs" $book backup       # 书目录快照到 协作/备份/<UTC 时间戳>，60 分钟内自动去重
& $node "$tools\wordcount.mjs" $book         # 按卷统计章数与字数（Unicode 计字）
& $node "$tools\style-sample.mjs" $book V002 # 抽首卷与目标卷的片段做文风比对
```

---

## 推荐的长篇工作流

1. `new-book.mjs` 建骨架 → 填 `00`（需求）、`01`（卷表）、`02`（硬规则）、`04`（文风）。
2. `grant batch 5` 授权一批 → 逐章 `prepare publish` + `commit`，每章更新章卡与设定。
3. 批满停下交付摘要；你确认后重新授权。
4. **每卷末做卷审**：`check` 把逾期伏笔清零 → `style-sample` 比对文风 → `wordcount` 对字数 → 写卷末交接，再开下一卷。
5. 需要并行时：主会话拆任务键 → 子代理或独立会话 `take` 领活 → `submit` 交稿 → 主编 `tasks ready` 收稿合稿。

---

## 目录结构（仓库）

```
dsh-novel-mode/
  cordis.patch.yml                      preset 声明（人设 + 插件清单 + 技能目录）
  package.json
  LICENSE
  README.md
  skills/novel-writing/
    SKILL.md                            工作手册（短篇流程 + 长篇入口）
    references/templates.md             00–04 模板、文风提炼工作表
    references/longform.md              长篇协作手册：初始化、授权、任务、定稿、故障恢复
    scripts/book.mjs                    账本：授权 / 任务 / 定稿 / 校验入口
    scripts/new-book.mjs                建书骨架
    scripts/check.mjs                   伏笔逾期检查
    scripts/backup.mjs                  书目录快照
    scripts/wordcount.mjs               字数统计
    scripts/style-sample.mjs            文风抽样
```

---

## 验证记录

| 项目 | 说明 |
| --- | --- |
| 结构与语法 | `validate-bundle` 全绿；YAML（含 `!!js` 平台判断）解析通过；技能 frontmatter 合法；四个含必填字段的插件均已提供 |
| 2.0 长篇容量 | 40 卷 × 100 章 × 2500 字的合成书库，接续第 41 卷第 4001、4002 章，验证存储与续写路径 |
| 2.0 并发 | 8 个进程抢同一任务只成功一次；重复定稿只扣一次额度；另测旧基线复核、交班、暂停、中断回放 |
| 2.1 三章样书 | 实建 V001 卷纲并授权一次 `batch 3`；子代理读卷纲、领任务、提交首章场景；主编 `prepare publish` + `commit`，得三份正文与三张章卡，额度 2→1→0，任务 `done` |
| 2.1 授权与维护 | 旧 `03` 中的有效剩余额度只迁入一次；短篇平铺章名可定稿；省略章数的长篇默认 5 章；伏笔三类报告、Unicode 计数、快照节流、强制备份、从快照读同一账本 |

---

## 已知限制

- `check` **只解析 Markdown 表格**，列名需含「编号」「状态」与「计划/预计/目标…回收」或「回收窗口」；伏笔写成自由文本会扫不到。
- `check` 的回收章按**区间末章**判定（写 `200–210` 要到 210 章才报）；想早提醒就写单章号。
- 状态列只认「已回收／已兑现／已放弃／已关闭／开放结局」为收尾词，其余一律按未回收计。
- `style-sample` 只认 `分卷/Vxxx/` 结构，短篇平铺章名会报错。
- 账本与稿件需在**同一台机器同一目录**；同步盘/多机副本会破坏任务锁与授权状态。
- 本模式不替你决定剧情，也不保证文笔——它保证的是「工序不乱、设定不丢、伏笔不烂」。

---

## 许可证

MIT，见 [LICENSE](LICENSE)。
