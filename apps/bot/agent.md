# Telegram Bot（Webhook）+ LLM 开发计划（生产方案：Redis + BullMQ）

目标：在 `apps/bot` 下实现一个 Telegram Bot，通过 **Webhook** 接收用户消息并调用 LLM 生成回复（先做最小可用：单轮对话），暂不深入 monorepo 其它部分。

## 1. 需求与范围（MVP）
- 支持 Telegram `message` 更新类型（文本消息优先）。
- 安全性：每条 webhook 请求（也就是每条消息 update）都必须校验 `X-Telegram-Bot-Api-Secret-Token`，不通过直接拒绝（不进入 `processUpdate` / 不入队）。
- 覆盖私聊与群聊：
  - 私聊：收到文本调用 LLM 生成回复。
  - 群聊/超级群：仅在用户 `@机器人`（或回复机器人消息）时才响应，避免刷屏。
  - 群聊回复时需要 `@用户`：优先用 `@${from.username}`；没有 username 时使用 inline mention（`tg://user?id=<id>`）来“点名”用户。
- Webhook 接收 `Update`，将 update 交给 `node-telegram-bot-api` 处理，并在 handler 中拿到 `chat.id`、`text`、`entities`、`from`。
- 调用 `bot.sendMessage` 回复同一聊天室（群聊需要带上对用户的 mention）。
- 需要调用 LLM：避免 webhook 阻塞（LLM 延迟、超时、峰值流量），需要异步处理与并发控制（可上消息队列）。
- 提供健康检查接口（如 `GET /healthz`）。
- 本地开发可跑通：有公网回调地址（ngrok / cloudflared）即可联调。

非范围（后续再做）：
- 群组权限、命令系统、对话状态机、数据库持久化（多轮记忆）、复杂消息类型（图片/文件/回调按钮）等。

## 2. 技术选型（建议）
- 语言：TypeScript（与仓库现有 TS 生态保持一致）。
- HTTP 服务：`hono`（Node 运行时用 `@hono/node-server` 起服务）。
- Telegram 调用：使用 `node-telegram-bot-api`（Webhook 模式，不使用 polling）。
- 消息队列：Redis + `bullmq`（Webhook 入队，worker 异步调用 LLM 并回复）。
- 配置：`.env`（本地）+ 环境变量（部署）。

## 3. 架构（生产推荐）
- `hono` 负责接收 webhook：`POST /telegram/webhook/<secret>` 只做校验与 `bot.processUpdate(update)`，尽快返回 `200`。
- `node-telegram-bot-api` 负责解析 update 并触发 `bot.on('message')`。
- `message handler` 只做路由规则与入队：满足私聊/群聊触发条件后，把任务写入 `bullmq`。
- `worker` 从 `bullmq` 消费任务：调用 LLM -> 组织回复（群聊需 mention 用户）-> `bot.sendMessage`。
- 幂等去重：按 `update_id`（优先）或 `chat.id + message_id` 作为 `jobId`，避免 Telegram 重试/重复投递导致重复回复。
- 并发控制：worker 设全局并发上限；后续如需要严格按 `chat.id` 串行，再引入分组串行/分布式锁。

## 4. 目录结构（建议）
- `apps/bot/src/server.ts`：Hono 服务与路由（`/healthz`、webhook）
- `apps/bot/src/bot.ts`：`node-telegram-bot-api` 初始化（关闭 polling，`getMe()` 获取 `botUsername`）
- `apps/bot/src/telegram-webhook.ts`：`processUpdate` 接入 + webhook 管理（`setWebHook/deleteWebHook/getWebHookInfo`）
- `apps/bot/src/handlers/message.ts`：路由规则（私聊/群聊触发）+ 入队
- `apps/bot/src/queue/queue.ts`：BullMQ `Queue` 初始化（连接 Redis、默认 job options）
- `apps/bot/src/queue/worker.ts`：BullMQ `Worker`（并发、重试、失败处理）
- `apps/bot/src/queue/types.ts`：job payload 类型定义
- `apps/bot/src/llm/client.ts`：LLM 调用封装（超时、重试、基础观测）
- `apps/bot/src/config.ts`：配置与校验（token、secret、port、public url、redis、llm）

## 5. Webhook 设计
- `POST /telegram/webhook/<secret>`：接收 Telegram `Update`
  - 使用 “secret path” 方式做最小安全隔离（避免被随意扫到）。
  - 强制校验 `X-Telegram-Bot-Api-Secret-Token`（每次请求都校验；不通过返回 `401`/`403`）。
  - 交给 `node-telegram-bot-api`：路由中调用 `bot.processUpdate(req.body)`。
  - 返回 `200` 尽快；不要在 webhook 内等待 LLM。
- `GET /healthz`：健康检查

说明：
- `TELEGRAM_BOT_TOKEN` 主要用于“调用 Telegram API”，不会随着 webhook update 一起传过来，因此无法在 `bot.on('message')` 里用它来校验请求来源。
- “每条消息都校验 token”的落地方式：在 webhook HTTP 层对每个请求校验 `X-Telegram-Bot-Api-Secret-Token`，通过后才 `processUpdate`，从而保证每条 update 都经过校验。

## 6. 配置项（env）
- `TELEGRAM_BOT_TOKEN`：Bot token（必需）
- `PORT`：服务端口（默认 3000）
- `WEBHOOK_SECRET`：webhook 路径 secret（必需）
- `PUBLIC_URL`：公网基址（本地联调/部署时用来 setWebhook）
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`：用于 webhook header 校验（必需）
- `REDIS_URL`：Redis 连接串（必需，例：`redis://localhost:6379`）
- `LLM_API_KEY`：LLM key（必需）
- `LLM_BASE_URL`：可选，OpenAI-compatible base URL
- `LLM_MODEL`：模型名（如 `gpt-4.1-mini` / 你们自定义的 model id）
- `LLM_TIMEOUT_MS`：单次请求超时（建议 30–90s）

## 7. BullMQ 设计（建议默认）
- Queue：`telegram-messages`（示例命名）
- `jobId`：优先使用 `update.update_id`；没有则用 `${chatId}:${messageId}`
- payload（建议最小字段）：
  - `updateId/chatId/chatType/messageId/text`
  - `fromId/fromUsername/fromFirstName/fromLastName`
  - `botUsername`（用于群聊 @ 判断/清理文本时可用）
- 默认 job options（建议）：
  - `attempts: 3`
  - `backoff: { type: 'exponential', delay: 1000 }`
  - `removeOnComplete: { count: 1000 }`、`removeOnFail: { count: 5000 }`
- worker 并发：先从小开始（如 `concurrency=5~20`），根据 LLM QPS/成本再调优。
- 失败兜底：LLM 超时/失败时，发送简短提示（并记录错误与 job 信息，便于排查）。

## 8. 开发步骤（按顺序，生产方案）
1) 初始化 `apps/bot` 项目结构与 TS 构建/运行方式（与当前仓库习惯对齐），准备两个进程入口：`server` 与 `worker`。
2) 接入 Redis + BullMQ：完成 `Queue` 与 `Worker` 初始化、基础日志与失败处理。
3) 实现 Hono 服务与路由：`/healthz`、`/telegram/webhook/:secret`（webhook 入口只做 `processUpdate` + 快速 `200`）。
4) 初始化 `node-telegram-bot-api`：关闭 polling，启动 `getMe()` 获取 `botUsername`，注册 `bot.on('message')`。
5) 强化 webhook 安全：
   - `setWebHook` 时配置 `secret_token=TELEGRAM_WEBHOOK_SECRET_TOKEN`（Telegram 才会在请求头带 `X-Telegram-Bot-Api-Secret-Token`）。
   - webhook 路由中每次请求都校验 header token，通过后才 `processUpdate`。
6) 实现消息路由规则（handler）：
   - 私聊：处理所有文本。
   - 群聊：仅在 `@botUsername` 或 `reply_to_message` 指向机器人时入队。
7) 入队规范：
   - jobId 去重（`update_id` 优先），避免重复回复。
   - 规范化文本（群聊去掉 `@botUsername` 前缀/中缀，避免把 mention 传给 LLM）。
8) worker 处理：
   - 调 LLM 生成回复（超时/重试/兜底）。
   - 群聊回复：优先 `@username`，否则用 HTML inline mention（`tg://user?id=...`）并设置 `parse_mode: 'HTML'`。
9) 提供脚本/命令：`setWebHook`、`deleteWebHook`、`getWebHookInfo`（联调用）。
10) 本地联调：
   - 启动 Redis（本地服务或 docker）
   - `ngrok http <PORT>` 或 `cloudflared tunnel --url http://localhost:<PORT>`
   - 设置 `PUBLIC_URL`，运行 `setWebhook`，验证私聊/群聊两种路径
11) 压测与调参：worker 并发、重试策略、LLM 超时、去重策略（观察队列积压与失败率）。

## 9. 验收清单
- 能启动服务并通过 `GET /healthz`。
- 已成功 `setWebhook`，Telegram 能把更新投递到服务。
- 私聊：给 bot 发文本消息，能收到 LLM 回复。
- 群聊：`@bot` 后机器人会 `@用户` 回复；不 @ 则不回复。
- LLM 慢/超时不会阻塞 webhook；高并发下不会触发大量重复回复。
- token/secret 缺失时启动失败并给出清晰错误。

## 10. 下一步（可选）
- 支持命令（`/start`、`/help`）。
- 支持更多 update 类型（编辑消息、callback_query）。
- 多轮对话与上下文（需要存储：Redis/DB；按 `chat.id` 管理历史）。
- 更完善的队列与重试策略（DLQ、告警、可视化、按 chat 分组串行）。
- 部署方案（Fly.io/Render/Vercel Serverless/自建）与 HTTPS 证书策略。
