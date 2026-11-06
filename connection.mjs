import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConnectorError } from "./config.mjs";

export const TIMEOUT_MS = 100_000;

export function biConnection({ url, token }, requestSignal = () => undefined, fetcher = globalThis.fetch) {
  const client = new Client({ name: "jdbi-stdio-bridge", version: "1.2.0" });
  const http = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
    fetch: async (input, init) => {
      let response;
      try {
        // 无状态 HTTP 的取消通知找不到原请求；同时断开该次 fetch，服务端才能取消原 SQL。
        const signals = [init?.signal, requestSignal(), globalThis.AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean);
        response = await fetcher(input, { ...init, redirect: "error", signal: globalThis.AbortSignal.any(signals) });
      } catch { throw new ConnectorError("BI 连接中断或超时，请检查网络、MCP 地址或缩小查询范围"); }
      // 无状态端点不提供后台 SSE，GET 405 是 SDK 的正常探测结果。
      if (response.ok || (init?.method === "GET" && response.status === 405)) return response;
      await response.body?.cancel();
      if (response.status === 401) throw new ConnectorError("查询密钥无效、已过期或已撤销，请在 BI 后台重新创建");
      if (response.status === 403) throw new ConnectorError("当前账号或查询密钥没有这项读取权限");
      if (response.status === 429) {
        const retry = response.headers.get("Retry-After");
        const seconds = retry && /^\d+$/u.test(retry) ? retry : "60";
        throw new ConnectorError(`查询次数过多，请等待 ${seconds} 秒后重试（HTTP 429）`);
      }
      throw new ConnectorError(`BI 服务暂时无法处理请求（HTTP ${response.status}），请检查地址或稍后重试`);
    },
  });
  return {
    client,
    connect: () => client.connect(http, { timeout: 10_000 }),
    close: async () => { await client.close().catch(() => undefined); await http.close().catch(() => undefined); },
  };
}
