# 01 — SPEC：《Saddle & Spoke》

> 闸 A 文档。先写演示脚本，再写可判定的验收条件；首段贴官方评分表原文。
> 基线视口 1440×900。所有验收条件都要能由 `bash scripts/verify.sh` 或一次真实点击复现。

## 0. 官方评分表（原文，按它设计）

**Stage One（pass/fail）**：先判定「是否为规范的 open agentic website」。不过此门没有 Stage Two。

**Stage Two（四项等权）**：

| 维度 | 官方原话 | 本作怎么拿分 |
|---|---|---|
| Technological Implementation | *How well is the project built, and how effectively does it use the open agentic web specification?* | 自写运行时（不套参考实现）：manifest/network 校验、agent 委派、站点动作、**有界执行**、**结果语义 confirmed/unknown**、**private context 允许规则**、**peer 按 origin 征得同意后在本浏览器里跑**。页内 Conformance 面板把规范 §6 的 7 条互通检查做成可点的自检，含 4 个必须失败的用例。 |
| Design | *Does the project deliver a complete, coherent product experience not just a technical proof of concept?* | 不是「聊天框 + JSON 查看器」。整页是一间**车间**：左边是车，右边是台面；agent 每次说到一颗零件，车上就落下聚光圈。店铺的排期、报价、库存、工位都是真的能改的本地状态，改完页面上看得见。 |
| Potential Impact | *Does the project make a credible, specific case for solving a real problem for a real audience and does the solution actually address it based on what's demonstrated? Does the project include any tools or services the Entrant built and shared with the community?* | 讲的是**长尾小店**：一家修车铺没有 API 团队，但它可以把「会答话的柜台」发布成一份 JSON。任何助手（日历、地图、家庭助理）都能在**访客的浏览器里**问它、替访客下单，店主不用买服务器、不用交 key。随作品开源一个**规范自检器**（`scripts/conformance.mjs` + 页内面板），社区可直接拿去测别的 agentic site。 |
| Quality of the Idea | *Is this a creative, non-obvious use of an open agentic website and does the team show genuine understanding of the problem space?* | 「agent 说的话，页面要指给你看」——`highlight_part` 把零件在车上圈出来，是 agent 驱动视觉，不是聊天框旁边贴一张图。第二层：**供应商是另一个 origin**，铺子问货时访客的联系方式一格都不许过去，运行台把被拦下的字段列出来。 |

## 1. 演示脚本（100 秒，写给评委看的那条路）

> 视频上限 2 分钟，实际成片目标 95–105 秒；下面每一格都是真实点击、真实运行。

1. **0:00 标题（4s）** —— 车间墙面：一张车线稿，右上角一行字 *A shop that answers your agent.* 下方小字：`Saddle & Spoke · 24 Ashfield Lane`。
2. **0:04 开口（8s）** —— 在台面输入：`My rear derailleur skips under load. Can you fix it before Friday?` 发送。状态条亮起：`local planner · hop 0/4 · calls 0/12`。
3. **0:12 看店（10s）** —— 台面上出现 3 行 trace：`front_desk → get_shop_state` / `→ workshop_lead` / `workshop_lead → highlight_part(rear_derailleur)`。**车上后变速器落下黄铜聚光圈**，旁边一行等宽小字 `Shimano RD-M310 · 后变速器`。旁白：*The agent does not describe the part. It points at it.*
4. **0:22 报价（12s）** —— `quote_repair` 返回：工时 0.9h、尾钩、变速线；台面右侧一张**工单纸**滑出：`£60.50 · ready Fri 17:00`。数字是店里自己的价目，不是模型编的。
5. **0:34 问货（14s）** —— `parts_desk` 发现尾钩缺货，要问供应商。**同意卡**弹出：`cdn.jsdelivr.net · Bellwether Parts`｜目的：查库存与货期｜`Your contact details will not be sent.` 点 **Allow once**。第二 origin 的 network 被拉进**本浏览器**跑起来：`in stock · 2 days · trade £18.40`。
6. **0:48 选工位（10s）** —— `check_dropoff_slots` 给两个：`Thu 17:30` / `Fri 08:15`。点 `Thu 17:30`。
7. **0:58 下单（12s）** —— `book_dropoff` 是写操作：**确认卡**列出 destination、参数、effect；点 **Confirm**。回执：`SS-4F2A · confirmed`。台面下方一行：`outcome: confirmed (not just HTTP 200)`。
8. **1:10 被拦下的字段（10s）** —— 展开 session：`sly_data sent to peer: {trade_account}`；`withheld: contact, bike_serial`。旁白：*The visitor's phone number never left this tab.*
9. **1:20 自检（14s）** —— 打开 Conformance，点 `Run all`：7 条里 6 条绿；第 7 条是「必须失败」的四连：非法网络、环、超预算、被拒 origin —— 四条都**红着并写出原因**。
10. **1:34 收尾（8s）** —— 回到车：聚光圈还在，工单在台面上。字幕：*One JSON. Any assistant. The visitor's browser does the work.* 店名与仓库地址。
11. **1:42 尾板（6s）** —— `github.com/…/hackathon-2026-saddle-spoke`、`MIT`、`No server. No key on the shop's side.`

## 2. 核心循环

一页 = 三个区：**墙（车）**、**台面（对话与 trace）**、**状态条（预算与 origin）**。

### 2.1 agent 网络（本站 `saddle_and_spoke`）

```
front_desk  (front man)
 ├── workshop_lead       看排期、报价、判断能不能按期交车
 │     ├── highlight_part     ← 站点动作（read，改视觉）
 │     ├── quote_repair       ← 站点动作（read）
 │     └── check_dropoff_slots← 站点动作（read）
 ├── parts_desk          查库存；缺货时问 peer
 │     └── bellwether_parts   ← peer（另一 origin 的 network）
 └── book_dropoff / order_part / lookup_ticket  ← 站点动作（write，需确认）
```

- `max_steps = 12`；委派深度 ≤ 4；peer 调用 ≤ 2；单次运行 ≤ 45 s；并发 1。
- 每次委派都进 trace，带 `depth`、耗时、以及它调了哪些动作。

### 2.2 站点动作（本页注册，agent 只能通过它们动手）

| 动作 | effect | 说明 |
|---|---|---|
| `get_shop_state` | read | 今天的日期、营业时间、排期（几辆车在等、各自什么时候好）、价目表、零件目录、政策（不接电助力电池、不代客保管超过 14 天） |
| `highlight_part` | read | `part` 取零件 id；把聚光圈移到车上那颗零件，并在旁边写一行等宽注释。**不改数据**，但改页面视觉状态 |
| `quote_repair` | read | 入参 `part` + `symptom`；返回工时、需要换的件、总价、最早可取车时间 |
| `check_dropoff_slots` | read | 返回两个可送车工位（下一个周四 17:30 / 周五 08:15），以及它们是怎么算出来的 |
| `book_dropoff` | **write** | 入参 `slot` + `contact` + `bike_serial`；先给确认卡，确认后写本地工单簿，回执 `{receipt_id, outcome:"confirmed"}` |
| `order_part` | **write** | 入参 `part` + `qty`；同上 |
| `lookup_ticket` | read | 按工单号查状态 |

动作的 `inputSchema` 由运行时在派发前校验；不符直接 fail closed，不调 handler。

### 2.3 peer：`bellwether_parts`（另一 origin）

- 两个 agent：`trade_counter`（front man）→ `stock_keeper`。
- **facts 写在 network 定义里**（data-only，公开可读）：库存表、货期、批发价。它没有站点动作——跨域动作不属于 MVP。
- 调用方（本页）传过去的只有 `trade_account`；`contact` 与 `bike_serial` 被 allow 规则挡下。
- 首次接触该 origin 必须弹同意卡（显示 origin、目的、将发送的字段名）；「Allow once」只对本次 origin 生效。

### 2.4 推理

- **默认**：`local-planner` —— 浏览器内的确定性规划器（无 key、无网络请求）。它在 network 图上按 `function.description` 选子 agent、按动作描述选动作、按上下文抽参数；最终答复由工具结果拼成。**UI 与文档都标它是确定性规划器，不冒充 LLM。**
- **BYOK**：OpenAI 兼容端点（base URL + model + key），流式；key 只存在本 origin 的 localStorage，只发给所选 router；peer 永远拿不到。
- 切换推理不改变 network 定义 —— 这就是 Tenet 3。

### 2.5 结果语义

- 动作返回 `{ok:false, reason}` → 报告「被拒绝，原因」，**不重试**。
- 调用抛出 / 超时 → 报 `unknown`，并禁止自动重试写操作。
- HTTP 200 只代表动作跑完；`book_dropoff` 只有拿到 `receipt_id` 且 `outcome==="confirmed"` 才算成。

## 3. 可判定的验收条件

> 每条都要有对应证据（命令输出 / e2e 断言 / 截图）。`scripts/verify.sh` 汇总跑。

**闸 C（能证明它能用）**

- **AC-1 构建**：全新 clone，`npm ci && npm run build` 退出 0，`dist/` 里同时有 `index.html`、`agent-manifest.json`、`saddle_and_spoke.network.json`、`links.json`、`peer/agent-manifest.json`、`peer/bellwether_parts.network.json`。
- **AC-2 类型与单测**：`npm run typecheck` 退出 0；`npm test` 全绿，至少覆盖：manifest 校验、network 校验（缺 front_man / 重复名 / 引用不存在）、`inputSchema` 校验、sly_data 允许规则、深度与步数预算、result 语义。
- **AC-3 真实运行（默认推理）**：`npm run preview` 后，e2e 在无 key 状态下输入「rear derailleur skips」，30 秒内出现：`highlight_part` 的 trace 行、车上 `[data-part="rear_derailleur"]` 获得 `is-lit` 类、工单上出现 `£` 金额。
- **AC-4 跨域 peer**：同一流程里出现同意卡（含 `cdn.jsdelivr.net` 与 `withheld: contact, bike_serial`），点 Allow 后出现 `in stock`；网络面板记录到对该 origin 的 fetch ≥1。
- **AC-5 写操作**：点 `Thu 17:30` 后出现确认卡（含 destination / args / effect）；Confirm 后出现 `receipt SS-` 与 `confirmed`；未确认前本地工单数不变。
- **AC-6 失败要可见**：Conformance 面板 `Run all` 后，7 条全 PASS（其中第 7 条内部 4 个反例全 FAIL 且带原因文案）。
- **AC-7 无 key 不发网络请求**：默认推理下，除 peer 的两次 GET 外，没有任何出站请求（e2e 记录 request 列表断言）。
- **AC-8 刷新不丢**：已有工单与 BYOK 设置在刷新后仍在（localStorage）；`Clear key` 后 localStorage 无该键。

**闸 D（审美）**

- **AC-9 主屏在 1440×900 无滚动条、无重叠**：`scripts/measure.mjs` 输出 0 problem（溢出、遮挡、字号 < 13px 的正文）。
- **AC-10 聚光圈在四个零件上都不出画**：`highlight_part` 依次点 `rear_derailleur / chain / brake_pads / bottom_bracket`，光圈中心与标签都落在车图边界内。
- **AC-11 盲排**：与 ≥5 件往届得奖作混排，两位未参与的模型各自把它排在至少 3 件之上。

## 4. 明确不做

- 不做服务端、不做账号、不做支付。
- 不做跨域站点动作（规范里属扩展，不在 MVP）。
- 不做 MCP 真实连接（`agent-mcp.json` 写明 `available:false` 与原因）——但运行时保留 MCP 描述的**解析与 fail-closed** 路径。
- 不做多语言 UI；提交材料全英文。
- 不引用 nsdeploy 的运行时 bundle（要证明「独立实现也能互通」）。
