import process from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { biConnection } from "./connection.mjs";
import { connectionConfig, ConnectorError, DEFAULT_MCP_URL, mcpUrl, saveConfig } from "./config.mjs";

export async function setup({ env = process.env, url, input = process.stdin, output = process.stderr } = {}) {
  const target = mcpUrl(url ?? env.JDBI_MCP_URL ?? DEFAULT_MCP_URL).href;
  output.write(`连接 ${target}\n请粘贴 BI 后台的查询密钥，然后按回车（输入不显示）：`);
  // 独立交互命令才读取终端；stdio 服务模式永远不提示输入，避免把 MCP 消息当成密钥。
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const reader = createInterface({ input, output: muted, terminal: Boolean(input.isTTY) });
  const abort = new globalThis.AbortController();
  const cancel = () => abort.abort();
  reader.once("close", cancel);
  let answer;
  try { answer = await reader.question("", { signal: abort.signal }); } catch {
    throw new ConnectorError("配置已取消，请重新执行 setup 并粘贴查询密钥");
  } finally { reader.off("close", cancel); reader.close(); output.write("\n"); }
  const config = connectionConfig({ JDBI_MCP_URL: target, JDBI_API_KEY: answer.trim() });
  const connection = biConnection(config, () => globalThis.AbortSignal.timeout(10_000));
  try {
    await connection.connect();
    await connection.client.listTools(undefined, { timeout: 10_000 });
    await saveConfig(config, env);
    output.write("连接验证成功，配置已保存。现在可以在 Evoflow 中使用此连接器。\n");
  } finally { await connection.close(); }
}
