# 多人 + AI 狼人杀

一个基于 Next.js、TypeScript、Tailwind CSS、Socket.IO 的简化狼人杀网页。房间状态保存在 Node.js 进程内存中，不接数据库。

## 功能

- 首页创建房间或输入房号加入。
- 最多 8 个座位，支持真人、AI、空位。
- 房主可配置 AI 模型与简单人格。
- 简化规则：2 狼人、1 预言家、其余村民。
- 至少 6 名玩家开局；夜晚狼人击杀并可私聊、预言家查验；白天依次发言并投票放逐。
- 支持弃票；第一轮多名玩家最高票平票时，平票玩家补充发言一轮并二次投票，再平票则无人出局。
- 所有游戏判定在服务端完成。
- 前端只收到当前玩家可见的私有信息。
- 刷新页面后通过本地 `werewolf_token` 回到原座位。

## 环境变量

复制 `.env.example` 为 `.env`，然后填写：

```bash
PORT=8105
OPENAI_BASE_URL=http://jink.xin:8101/v1
OPENAI_API_KEY=replace-with-your-api-key
DEFAULT_AI_MODEL=deepseek-v4-flash
```

`.env` 已加入 `.gitignore`，不要提交真实 key。

## 安装与运行

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:8105
```

生产构建：

```bash
npm run build
npm start
```

## 玩法说明

1. 房主创建房间并复制链接给其他玩家。
2. 房主在大厅把空位设置为 AI，并选择模型和人格。
3. 房主点击开始游戏。
4. 真人根据右侧行动区发言、夜晚选择目标或投票。
5. AI 会根据它可见的信息自动发言和行动。

## 注意

- 房间和游戏状态只在内存中保存，服务重启后会丢失。
- AI 调用失败时，服务端会使用兜底发言或随机合法行动，避免游戏卡住。
- 至少 6 名玩家开始，8 人体验更接近完整局。
