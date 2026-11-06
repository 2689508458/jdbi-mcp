# 京东自营 BI MCP

只读 stdio MCP 接入程序，通过官方 MCP SDK 连接已有的 JDBI HTTP 服务，沿用查询账号的权限、数据范围、指标遮蔽和限流。HTTP MCP 与 HTTP API 继续可用。

## 在 Evoflow 里直接填写密钥

需要 Node.js 22.19 以上。Evoflow 会通过 npx 自动从 GitHub 安装接入程序。

在连接器卡片点击 **配置**，将下面的 JSON 填入「连接器配置（JSON）」，把 `<查询密钥>` 替换为本人在 JDBI 后台「系统集成 → 开放查询」创建的完整密钥，保存后测试连接：

```json
{
  "enabled": true,
  "type": "stdio",
  "command": "npx",
  "args": [
    "-y",
    "https://github.com/2689508458/jdbi-mcp/releases/download/v1.2.0/jdbi-open-query-stdio-1.2.0.tgz"
  ],
  "env": {
    "JDBI_MCP_URL": "https://jdbi.b9zy.cn/api/open/mcp",
    "JDBI_API_KEY": "<查询密钥>"
  }
}
```

保存后，认证会显示为 **环境变量**。这个方式直接读取连接器传入的密钥，不执行 setup，也不需要配置文件。Evoflow 添加向导中的「环境变量（稍后在配置中补充）」只表示认证类型；需在卡片的「配置」中补齐上面的 `env`。

也可以在 Evoflow「设置 → 环境变量」里保存 `JDBI_API_KEY`，再将连接器 `env.JDBI_API_KEY` 的值写成 `$JDBI_API_KEY`。Evoflow 官方说明见 [工具与连接器](https://github.com/EvovexAI/EvoFlow/blob/main/docs/user/guides/configuration/tools-mcp.md)。

支持 `mcpServers` 的其他客户端，将上述对象放在 `mcpServers.jdbi` 下即可。每个人填写自己的查询密钥，调用超时建议至少 100 秒。

## GitHub 安装方式

上面的 GitHub Release 安装包不要求电脑安装 Git。安装了 Git 的电脑也可将参数改为：

```text
-y github:2689508458/jdbi-mcp#v1.2.0
```

全局安装可使用：

```sh
npm install -g https://github.com/2689508458/jdbi-mcp/releases/download/v1.2.0/jdbi-open-query-stdio-1.2.0.tgz
```

安装后 MCP 客户端命令为 `jdbi-mcp`，环境变量仍按上面的 `env` 填写。

## 其他站点与可选配置

- `JDBI_MCP_URL` 或 `--url` 指定 MCP 地址；默认 `https://jdbi.b9zy.cn/api/open/mcp`。远程地址要求 HTTPS，本机回环可用 HTTP。
- 连接器传入的 `JDBI_API_KEY` 优先于已保存的配置，密钥只放在环境变量中，不写入 URL 或命令行参数。
- 不方便使用客户端环境变量时，可以执行 `jdbi-mcp setup`，按提示输入密钥，程序验证后保存到当前用户目录。这是可选方式。
- 日志只写 stderr，stdout 只传 MCP 消息；取消与退出会收尾 HTTP 请求，失败请求不会自动重试。
- 401 / 403：检查密钥有效期、开放能力与所属账号权限；后台读取需要选择「后台只读」。429 按提示等待。

本仓库只包含 MCP 接入程序及测试，不包含 JDBI 后端、数据库或真实密钥。
