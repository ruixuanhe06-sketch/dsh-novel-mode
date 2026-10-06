# 小说创作模式（DSH Agent Preset: `novel`）

一个装进 DeepSeek Harness 的写作模式：**用户给灵感、剧情要求、大纲文件，或其它已完成小说（只提炼文风），
模式按「章」推进小说；默认每写完一章暂停、把内容交给用户审阅，拿到确认后才写下一章（用户可开启「连写 N 章」
例外开关）；伏笔、人物性格写进 `02-设定圣经.md`，文风写进 `04-文风设定.md`，每章开写前强制重读。**

## 目录结构

```
novel-mode/
  package.json                 bundle 清单（dsh.bundle.patch 指向下面的 patch）
  cordis.patch.yml             声明 preset `novel`：人设（逐章循环 + 文风提炼 + 连写开关）+ 工具 + 技能目录
  skills/novel-writing/
    SKILL.md                   工作手册：作品目录、设定圣经、文风档案、连写开关、单章循环、质量清单
    references/templates.md    00–04 模板、文风提炼工作表、两种交付格式
  README.md                    本文件
```

## 安装

本目录位于 DSH 安装目录下：`D:\DeepSeekHarness\dsh-bundles\novel-mode`。
在 DSH 里让 Agent 用 `plugin_manager` 安装（需要 Full 权限或批准）：

```
plugin_manager  action: install_bundle
                target: D:\DeepSeekHarness\dsh-bundles\novel-mode     # 本目录的绝对路径
```

安装后：`plugin_manager` 的 `list_plugins` 里应出现 `preset-novel` 行且处于激活状态；
**刷新页面（Ctrl+R / F5）** 后**新建会话**，在模式选择器里即可看到「小说创作」
（已有会话沿用启动时的组合，不会切换；模式名册由页面在加载时向 Host 拉取，装完插件不刷新会看不到新项）。

卸载：`plugin_manager` → `remove_bundle` → `@local/dsh-novel-mode`。

> 注意：如果把本目录整体搬走，必须同步改两处，否则模式会从选择器里消失：
> `cordis.patch.yml` 里 `skill-filesystem.config.customSkillDirs` 的绝对路径，
> 以及重新安装时 `install_bundle` 的 target。
> 另外安装目录可能被 Harness 的升级/重装覆盖，重要改动建议留一份副本。

## 排障：新模式不出现

1. **先刷新页面**——模式名册只在页面加载 / 连接重置 / 设置变更时拉取。
2. 再看 `设置 → 通用 → 「显示代码工作视图」`是否开启：关闭时新会话的模式选择器会隐藏。
3. 若设置里的 Agent 预设名册出现了「小说创作」但带「加载失败」徽标，说明预设在 Host 侧组装失败：
   `Config.listConfigs` 看行是否激活，重点是 `!!js` 表达式——**bundle patch 的 `baseUrl` 是 bundle 自己的目录**，
   在那里 `createRequire(baseUrl).resolve('<本包名>')` 会抛错，从而让整个 preset 变成 broken 并被选择器过滤掉。
   技能目录请写成上面的绝对路径。

## 使用

1. 新建一个会话，模式选「小说创作」。
2. 第一条消息给出任意组合的输入：
   - 只有灵感：「我想写一个关于……的故事」；
   - 灵感 + 要求：「第一人称、悬疑、20 章、每章 3000 字、不要恋爱线」；
   - 或直接给一份大纲文件（用 `@文件路径` 引用）；
   - 或给**其它已经完成的小说**当参考（见下「参考作品」）。
3. 模式会：补齐只能由用户决定的问题（≤3 个）→ 建立作品目录与 `00`–`04` 文件 → 把大纲与文风要点交给你确认。
4. 你确认后，它写第 1 章，然后**停下**并把本章交付给你（文件路径 + 摘要 + 伏笔 + 下一章计划 + 开关状态），
   等你选「确认，继续下一章」／「本章需要修改」／「调整设定或大纲」。
5. 循环推进，直到完结。

## 参考作品：只提炼文风

给一部（或多部）**已经完成的小说**，模式只吸收它的**写法**，不吸收它的内容：

```
用 @参考资料/某小说.txt 的文风来写，只提炼文风，不要用它的情节和人物
```

- 抽样阅读（开篇／中段／对白密集段／高潮段／结尾各取 1–3 段，每段 300–800 字），不把整本读进上下文；
- 按维度提炼：视角人称、句长与长短句分布、段落长度、用词层级、比喻意象、对白占比与提示语、描写比例、
  标点排版、场景切换与章末钩子、情绪温度，以及**要规避的套话清单**；
- 结论写成**可执行规则**（「短句为主，平均 15–20 字；每段 ≤4 行；对白占四成」），存进 `04-文风设定.md`；
- 同时单列**不得模仿项**（原作人物名、地名、专有名词、独有设定、具体桥段），产出文件不得抄录原文。

之后每章开写前都会重读 `04-文风设定.md`，交付前自查文风是否走样。

## 连写 N 章：逐章暂停的唯一例外

默认仍然是一章一交付。要连续写，明确说出来即可：

```
开启连写，5 章
这次连写 3 章
后面 10 章不用问我
```

- 只有**明确**说出连写与章数才开启；「你继续写吧」只等于确认一章；
- 开关状态写进 `03-进度日志.md` 顶部的「写作开关」区块（连写模式／剩余章数／开启来源／到期行为），
  **每章开写前必读**，所以上下文被压缩、会话中断、隔天继续都不会丢；
- 连写期间**每章仍逐一保存、逐一更新 02/03/04、逐一自查**，只是不再每章调用 `ask_user_question`，
  改为每章回一行 `第NN章《标题》已完成｜文件｜摘要｜连写剩余 N 章`；写满 N 章后**必须停下**给整批汇总并请你确认；
- 每章写完剩余章数 −1，减到 0 自动关闭开关、恢复逐章确认；
- 单次上限 10 章；出现需要你决定的剧情分叉／设定冲突时立即中止连写来问你；
- 随时可取消：说「停下并恢复逐章确认」。

## 模式里的硬性规则（写在 persona 里，每轮都在系统提示词中）

- **一章一次交付**：默认写完一章必须调 `ask_user_question` 暂停；未确认不得写下一章，禁止一轮连写多章；
  唯一例外是用户明确开启的连写开关，且按开关章数执行。
- **设定圣经**：`02-设定圣经.md` 记录人物（性格/动机/说话方式/关系）、世界观、时间线、伏笔登记表
  （编号｜埋设章｜内容｜计划回收章｜状态）、名词表、道具、禁忌；每章开写前用工具**真实读取**它、
  `03-进度日志.md` 与 `04-文风设定.md`，不许凭记忆写作。
- **文风档案**：`04-文风设定.md` 是文风唯一权威；只从参考作品借文风，不借内容。
- **一章一动笔**：不跳章、不并章、不预告下一章正文；本章埋下/回收的伏笔与人物状态变化在交付前回写文件。
- **改设定先改文件**：与文件冲突的口述先征得同意、更新 01/02/03（涉及文风连 04），再继续写。

## 作品目录（模式自动建立）

```
<书名>/
  00-创作说明.md      灵感与要求（原文 + 整理）+ 交付方式偏好
  01-大纲.md          章节清单：标题／目标事件／预计字数／伏笔安排
  02-设定圣经.md      ★跨章上下文，每章必读
  03-进度日志.md      顶部「写作开关」+ 进度、剧情位置、未回收伏笔、下一章计划
  04-文风设定.md      ★文风档案，每章必读
  参考资料/           参考作品（只作抽样阅读，原文不进入产出）
  章节/第NN章-<标题>.md
```

## 模式挂载的插件

- `persona`（写作协议人设）、`agent-instructions`
- `tool-pwsh` / `tool-bash`（按平台二选一）、`tool-fs`、`tool-fs-search`
- `skill-filesystem` + `tool-skill`（挂载本包的 `skills/`）
- `tool-ask-user`（每章交付的暂停闸门）、`tool-todo`、`present`
- `tool-web`（**联网考据**：`web_search` 检索 + `web_fetch` 读原文）
- `compaction` 组（长篇小说必备的上下文压缩与工具结果裁剪）

## 可选的调整

编辑 `cordis.patch.yml` 后重新安装（`remove_bundle` → `install_bundle`）：

- 想关掉联网考据：删掉 `tool-web` 那一行（人设里关于查证的段落也一并删掉更干净）。
- 想改默认字数或交付话术：改 `persona.config.prefix` 里对应段落。
- 想改模式显示名或排序：改 `config.name` 与 `config.order`（`config.id` 保持 `novel`，它是会话记录的标识符）。
- 想换技能内容：直接编辑 `skills/novel-writing/`，`skill-filesystem` 会监视目录，无需重装。
- 想加子代理／工作流：从 `standard` preset 复制 `delegation` 组（`cordis:group` + `tool-subagent*` + `tool-workflow`）到 `plugins` 里。

## 改 `plugins` 时的必填字段（踩过的坑）

子插件的 Config 校验在组装时执行，**必填字段缺失 = 该子插件激活失败 = 整个 preset 变 broken**，
表现就是"新会话里看不到这个模式"，只在设置页留下「加载失败」徽标（徽标里会写清是哪个插件、缺哪个字段）。

| 插件行 | 必填字段 | 本模式取值 |
| --- | --- | --- |
| `persona` | `prefix` | 写作协议人设文本 |
| `agent-instructions` | `maxBytes` | `65536` |
| `tool-fs-search` | `sampleOverCapGlobResults` | `false` |
| `tool-todo` | `allowParallelInProgress` | `true` |

其余行（`tool-pwsh`、`tool-bash`、`tool-fs`、`skill-filesystem`、`tool-skill`、`tool-web`、
`tool-ask-user`、`present`、`compaction` 组里的 `compaction-basic`/`command-compact`/`tool-result-pruner`）
没有必填字段；但**不要**因此去"精简"上面四个字段。

另外两条硬规则：
- 不要用 `!!js` 做模块解析（`createRequire(baseUrl).resolve(...)`）——bundle patch 的 `baseUrl` 是 bundle 自己的目录；
- 技能目录用绝对路径字面量。

## 验证记录

- patch 用 `js-yaml` + `!!js` 自定义标签解析通过；
- `SKILL.md` frontmatter 合法（`name: novel-writing`，kebab-case，含 description），正文与模板齐全；
- 逐个插件核对了各自的 Config schema，四个必填字段全部提供；
- profile 侧安装后用 `plugin_manager list_plugins` 确认 `preset-novel` 激活，`Config.listConfigs`
  可用 `entry: preset-novel` 读到本声明（只读查看配置与 GUI 的「查看配置」一致）；
- 组织内只保留两处 `!!js`：`process.platform` 的平台判断（不会抛错）；技能目录用绝对路径字面量。
