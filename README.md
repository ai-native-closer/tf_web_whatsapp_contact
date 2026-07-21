# TF Web WhatsApp Contact

独立 Node.js 平台，用 Express + React/Vite + MySQL 管理多个 WhatsApp 账号，并通过 [Baileys](https://github.com/WhiskeySockets/Baileys) 执行单发、批量文本建联与消息同步。

Baileys 通过 WhatsApp Web 的多设备 WebSocket 协议工作，不启动 Chromium。它不是 WhatsApp 官方 Business API；使用前请确认业务场景、用户授权与 WhatsApp 的服务条款。

## 本地运行

1. 确认 MySQL 可连接：

   ```bash
   mysql -h127.0.0.1 -uroot -p123456789 db58_okactivitytest
   ```

2. 使用 Node.js 20 或更高版本并安装依赖：

   ```bash
   npm install
   npm --prefix frontend install
   ```

3. 初始化数据库：

   ```bash
   npm run migrate
   ```

4. 构建并启动单端口服务：

   ```bash
   npm run build
   npm start
   ```

5. 访问：

   ```text
   http://localhost:8003/
   ```

默认管理员为 `admin / ChangeMe`。

## Baileys 聊天能力

- 每个账号都有独立的多文件凭据目录，位于 `whatsapp.authDataPath/<clientId>`；请将该目录视为登录凭据，勿提交或共享。
- 扫码登录 API 保持为 `POST /api/accounts/:id/login/qr`，前端会轮询账号状态并渲染 Baileys 返回的二维码。
- 配对码 API 为 `POST /api/accounts/:id/login/pairing-code`，手机号必须包含国家码且只含数字。
- 登录成功后，服务会保存实时收发消息；启用 `syncFullHistory` 时也会保存 Baileys 下发的历史消息。会话页的“加载更早”会请求按需历史同步。
- 发消息前会通过 Baileys 查询目标号码是否已注册 WhatsApp。发送、队列、会话、审计与现有前端接口保持不变。
- Baileys 7 使用 `@s.whatsapp.net` JID；数据库迁移 `V5` 会将旧版 `@c.us` 记录转换为新格式。

## 配置

- 示例配置：`server/config/default.json.example`
- 本地配置：`server/config/default.json`
- 本地配置已被 `.gitignore` 忽略，真实 MySQL 密码不会进入仓库。
- `whatsapp.syncFullHistory` 控制是否接收 WhatsApp Web 历史同步；历史量较大时可设为 `false`，实时收发不受影响。
- `whatsapp.logLevel`、重连退避和历史请求超时均可在示例配置中调整。

## QuickDeploy / 阿里云部署

仓库已包含 QuickDeploy 所需的 `Dockerfile`、`aliyun-api.yaml` 以及
`k8s/us-east/` 清单。测试环境继续以 `default.json` 文件挂载配置；生产环境将
Secret 的每个 Key 作为环境变量注入容器，便于单独更新密码和各项配置：

```bash
kubectl -n ok-backend create secret generic tf-web-whatsapp-contact-test-config \
  --from-file=default.json=/secure/path/test.default.json
kubectl -n ok-backend create secret generic tf-web-whatsapp-contact-secrets \
  --from-env-file=/secure/path/prod.env
```

生产环境变量示例见 `k8s/us-east/prod/secret.example.yaml`；至少要填写
`APP_SESSION_SECRET`、`APP_DB_HOST`、`APP_DB_USER`、`APP_DB_PASSWORD`、
`APP_DB_NAME`、`APP_ADMIN_PASSWORD`。`APP_WHATSAPP_AUTH_DATA_PATH` 必须为
`/app/storage/baileys_auth`。测试环境配置文件和示例仍见
`k8s/us-east/test/secret.example.yaml`。
部署清单会创建各环境独立的持久卷声明，用于保存 WhatsApp 登录凭据。
如集群没有默认 StorageClass，请在对应 `pvc.yaml` 中设置
`storageClassName` 后再部署。

```bash
export KUBEFORGE_API_TOKEN='your-token'
npm --prefix ../quickdeploy run deploy -- \
  --repo git@github.com:strivingx/tf_web_whatsapp_contact.git \
  --ref master \
  --region us-east \
  --mode test
```

生产发布将 `--mode` 改为 `prod` 或 `all`。该应用只允许单副本并使用
`Recreate` 策略，避免发布期间两个 Pod 同时连接同一 WhatsApp 账号。

## 风险提示

Baileys 基于 WhatsApp Web，不是 WhatsApp 官方 Business API。请只联系已授权用户，并使用限速、确认和少量测试账号降低误发与封号风险。不要把它用于群发骚扰、未授权营销或规避 WhatsApp 的平台限制。
