import { AsyncLocalStorage } from "node:async_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";

import { biConnection, TIMEOUT_MS } from "./connection.mjs";
import { connectionConfig, errorMessage } from "./config.mjs";
export { connectionConfig } from "./config.mjs";

export async function startStdio({ env = process.env, config = connectionConfig(env), stdin = process.stdin, stdout = process.stdout, fetcher = globalThis.fetch } = {}) {
  const requests = new AsyncLocalStorage();
  const upstream = biConnection(config, () => requests.getStore(), fetcher);
  const server = new Server({ name: "jdbi-open-query-stdio", version: "1.2.0" }, { capabilities: { tools: {} } });
  const stdio = new StdioServerTransport(stdin, stdout);
  let closing;
  const close = () => {
    if (closing) return closing;
    closing = Promise.resolve().then(async () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      stdin.off("end", stop);
      stdout.off("error", stop);
      await server.close().catch(() => undefined);
      await upstream.close().catch(() => undefined);
      stdin.pause();
    });
    return closing;
  };
  const stop = () => { void close(); };
  const forward = (extra, run) => requests.run(extra.signal, async () => {
    try { return await run({ signal: extra.signal, timeout: TIMEOUT_MS }); } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, errorMessage(error));
    }
  });
  server.setRequestHandler(ListToolsRequestSchema, (request, extra) => forward(extra, (options) => upstream.client.listTools(request.params, options)));
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => forward(extra, (options) => upstream.client.callTool(request.params, undefined, options)));
  server.onclose = stop;
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  stdin.once("end", stop);
  stdout.once("error", stop);
  try {
    // 握手先核对真实服务与密钥，避免客户端把一个无法查数的本地进程显示为连接成功。
    await requests.run(globalThis.AbortSignal.timeout(10_000), () => upstream.connect());
    if (!closing) await server.connect(stdio);
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStdio().catch((error) => {
    // stdout 只传 MCP 消息；不打印 SDK 原始错误，响应正文可能带有凭据。
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
