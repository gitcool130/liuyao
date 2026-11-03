# AGENTS.md — 给接手这个仓库的 AI / 开发者的上下文

> 目的：`git clone` 之后不必重新摸索。这份文件记录**跑起来的命令**、**踩过的坑**、**不能乱动的地方**。
> 新会话/新机器开工第一件事：`git log --oneline -5`、`npm run test:all`、读本文件。

---

## 1. 项目是什么

六爻（周易）排盘 + 断语 + 多模型 AI 解读工具。

- **线上**：https://liuyao.dhxlsfn.dpdns.org （Cloudflare Pages，项目名 `liuyao`）
- **架构**：CF Pages Functions（后端 API）+ D1（卦例与投票）+ AI Gateway（多模型流式解读）
- **前端**：纯 es5 零依赖，`LY` 全局命名空间，`public/core/*.js` 按脚本顺序加载，**不用打包器**
- **排盘/断卦是确定性的**：`public/core/` 里全是纯函数，AI 只负责把盘面事实讲成人话，**不得由 AI 决定盘面**

### 目录骨架

| 路径 | 作用 |
|---|---|
| `public/core/` | 排盘、历法、断语规则、前提预检、应期窗口、覆盖审计（纯函数，测试主战场） |
| `public/app.js` | 前端主逻辑：SSE 客户端、重试补发、渲染、D1 读写、模型切换 |
| `functions/api/` | `interpret`（SSE 主管道）、`records`（D1 卦例）、`vote`（三模型对账）、`_lib`（鉴权/工具） |
| `functions/index.js` | 路由 + 密码中间件 + OG 注入 |
| `tests/guji/` | 古籍回归语料（《增删卜易》《卜筮正宗》等），1.2 万+ 断言 |
| `docs/` | CHANGELOG、TODO、审计报告、散文式设计提案 |

---

## 2. 命令

```bash
npm install                 # 首次

# 测试
npm test                    # core 链（749 断言）
npm run test:fn             # functions 链（382 断言）
npm run test:guji           # 古籍 golden（12144 断言，语料改动后必跑）
npm run test:all            # 八套全跑：test/fn/diff/guji/guji-self/paipan/verify/drift

# UI 冒烟（需要一个静态服务）
python -m http.server 8931 --directory public --bind 127.0.0.1 &
node test-shake.js          # 75 断言
```

**改完必须 `test:all` 全绿才提交。** 改 `public/core/` 下任何东西还要额外跑 `test:guji`。

### 部署

```bash
npx wrangler pages deploy public --project-name=liuyao --branch=main --commit-dirty=true
```

- CF 只打包 `public/` + `functions/`。`tests/ tools/ docs/ README` **不进产物**
- 用户偏好：**wrangler 直推**，不要在 CF 面板点 Retry

### 提交推送

`git push` 在部分地区/代理下会失败（`CONNECT tunnel failed 502`，直连则超时）。可靠方案是 **GitHub Git Data API**：

```
blob（逐文件）→ tree → commit（parent = 远端 main 的 sha）→ PATCH /git/refs/heads/main
```

两个坑：
- `GET /git/ref/heads/main` 用**单数**，`PATCH /git/refs/heads/main` 必须**复数**
- 这样推出来的 commit sha 与本地不同（tree 序列化差异），内容一致即可。网络恢复后 `git fetch && git reset --hard origin/main` 对齐

---

## 3. 不能乱动的地方

1. **确定性边界**。AI 只能描述盘面，盘面由 `paipan/analyze` 算。任何「让模型决定吉凶/应期」的改动都是方向性错误。
2. **测试可能钉住了错误行为**。修规则前先确认测试锁的是规则还是 bug。历史案例：`test-rules.js` 曾钉住「动爻逢冲=冲散」（与「动不为空」互斥）、`test-yingqi.js` 曾用与实现同款的错误公式做「独立复算」。这种情况**必须连测试一起改**，并在 commit message 里说明理由。
3. **`esc()` 是 DOM 注入纪律**。所有外部文本（模型输出、用户输入、D1 读回、分享码解码）进 `innerHTML` 前必须过 `esc` / `escAttr`。`mdLite(text)` 内部先 `esc(s)` 再做 markdown 替换——**安全性建立在自家 esc 上，不依赖上游模型可信**。
4. **服务端思考草稿隔离**。`interpret.js` 把 `reasoning_content` / gemini `thought:true` 片段只走 `r` 独立通道，客户端 `r` 帧只计数、**绝不拼进正文**。这条链有端到端回归探针，别破坏（历史事故：草稿与正式稿矛盾，fact-audit 字面匹配撞出假阳性）。
5. **两条「待验证」刻意挂起**：两现皆动取初现、论生不论墓缺变爻。古籍无明文，代码里有 `待验证` 注释，**不要当缺陷重报或擅自改行为**。

---

## 4. 已知的坑（都真踩过）

| 坑 | 说明 |
|---|---|
| 未定用神守卫 | `app.js`：未选「所测之事」点「开始断卦」只弹提示、**不发请求**（2026-10-30 上线）。写 UI 测试必须先选 `#useSelect` |
| `auditCoverage` 参数顺序 | 是 `(text, analysis, pan)`，不是 `(text, pan, analysis)`。传错会得到「一切正常」的假结论 |
| 日期回验 | `new Date(Date.UTC(y,m-1,d))` 会静默归一化 `2026-02-31`，涉及 due_at 推算必须回验 m/d |
| D1 `INSERT OR IGNORE` | 会吞掉一切约束违反，插入后要看 `meta.changes` |
| 代理环境 | 本机到 `*.pages.dev` 和自定义域直连被 reset，线上验证只能靠浏览器 |

---

## 5. 当前状态（2026-11-03）

- 全项目审计完成：见 `docs/audit-2026-11-03.md`（P0 × 0 / P1 × 17 / P2 若干，每条带 `文件:行号` 与实证）
- P1 全部修复 + P2 主体修复，`test:all` 全绿，已部署
- 未完成项登记在 `docs/TODO.md` 末尾「2026-11-03 审计遗留区」
- `docs/CHANGELOG.md` 是长文式变更史，改功能时补一条

### 协作偏好

- 中文沟通，指令极简（「修」「全做了吧」）。按 **做活 → 测试 → 提交 → 推送 → 部署 → 验证** 循环推进
- 明确说过「先别部署…最后再部署」，只在确认后才部署
- 要求 AI **自己跑测试验证**，不要让人手动验
- **外部审计工具（trae、各类 preview）的报告要逐条核实**，历史命中率约 1/3：常引用不存在的正则、不存在的文件、错判 CI 配置
- 子代理汇报不能照单全收——曾出现「只改注释没改代码」还报完成。每条都要 grep 落地并跑探针

---

*本文件由 2026-11-03 审计会话生成。若与代码冲突，以代码和测试为准，并顺手更新本文件。*
