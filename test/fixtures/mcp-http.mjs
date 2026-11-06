import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export const token = `jdbi_${"a".repeat(43)}`;

export async function mockBi({ status = 200, call, onRequest = () => {} } = {}) {
  const http = createServer(async (request, response) => {
    onRequest(request);
    if (status !== 200 || request.headers.authorization !== `Bearer ${token}`) {
      // 故意回显密钥，验证错误正文不会被 SDK 带到 stdout / stderr。
      response.writeHead(status === 200 ? 401 : status, { "Retry-After": "17" }).end(token);
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const server = new Server({ name: "mock-bi", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
      name: "list_metrics", title: "指标", inputSchema: { type: "object" }, annotations: { readOnlyHint: true },
    }] }));
    server.setRequestHandler(CallToolRequestSchema, call ?? (async (request) => ({
      content: [{ type: "text", text: "指标" }], structuredContent: { data: { name: request.params.name, amount: 12.34, warnings: ["缺数"], page: { hasMore: true } } },
    })));
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    response.once("close", () => { void server.close(); void transport.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, body ? JSON.parse(body) : undefined);
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  return {
    env: { JDBI_MCP_URL: `http://127.0.0.1:${http.address().port}/api/open/mcp`, JDBI_API_KEY: token },
    close: () => new Promise((resolve) => { http.close(resolve); http.closeAllConnections(); }),
  };
}
