import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

export const DEFAULT_MCP_URL = "https://jdbi.b9zy.cn/api/open/mcp";
export class ConnectorError extends Error {}
export const errorMessage = (error) => error instanceof ConnectorError ? error.message : "BI 连接失败，请检查地址、网络或查询范围";

export function mcpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ConnectorError("请配置有效的 JDBI_MCP_URL 地址，或使用 --url 指定后台显示的 MCP 地址"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) {
    throw new ConnectorError("MCP 地址必须使用 HTTPS（本机回环可用 HTTP），且不能包含凭据、查询参数或片段");
  }
  return url;
}

export function connectionConfig(env = process.env) {
  const token = env.JDBI_API_KEY;
  if (!token || !/^jdbi_[A-Za-z0-9_-]{43}$/u.test(token)) {
    throw new ConnectorError("请在连接器环境变量 JDBI_API_KEY 中填写有效查询密钥；也可使用 jdbi-mcp setup 配置");
  }
  return { url: mcpUrl(env.JDBI_MCP_URL), token };
}

export function configPath(env = process.env) {
  const path = env.JDBI_CONFIG_PATH ?? join(homedir(), ".jdbi", "mcp.json");
  if (!isAbsolute(path)) throw new ConnectorError("JDBI_CONFIG_PATH 必须是绝对路径");
  return path;
}

export async function loadConfig(env = process.env, url) {
  if (env.JDBI_API_KEY !== undefined) {
    return connectionConfig({ JDBI_API_KEY: env.JDBI_API_KEY, JDBI_MCP_URL: url ?? env.JDBI_MCP_URL ?? DEFAULT_MCP_URL });
  }
  let saved;
  try { saved = JSON.parse(await readFile(configPath(env), "utf8")); } catch (error) {
    if (!(error && error.code === "ENOENT")) throw new ConnectorError("无法读取接入配置，请重新执行 jdbi-mcp setup");
  }
  const target = mcpUrl(url ?? env.JDBI_MCP_URL ?? saved?.mcpUrl ?? DEFAULT_MCP_URL);
  // 密钥只交给配置时核对过的完整地址，切换站点或端点时必须重新配置。
  if (saved && (saved.version !== 1 || target.href !== saved.mcpUrl)) {
    throw new ConnectorError("当前地址与已保存的配置不同，请针对该地址重新执行 jdbi-mcp setup --url MCP地址");
  }
  return connectionConfig({ JDBI_MCP_URL: target.href, JDBI_API_KEY: saved?.apiKey });
}

export async function saveConfig(config, env = process.env) {
  const path = configPath(env);
  const temporary = join(dirname(path), `.mcp-${randomUUID()}.tmp`);
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify({ version: 1, mcpUrl: config.url.href, apiKey: config.token })}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch {
    await unlink(temporary).catch(() => undefined);
    throw new ConnectorError("无法保存接入配置，请检查当前用户的目录写入权限");
  }
}
