#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";
import { parseArgs } from "node:util";
import { ConnectorError, errorMessage, loadConfig } from "./config.mjs";
import { setup } from "./setup.mjs";
import { startStdio } from "./stdio.mjs";

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ options: { url: { type: "string" }, help: { type: "boolean" }, version: { type: "boolean" } }, allowPositionals: true });
  } catch { throw new ConnectorError("参数不正确，请使用 jdbi-mcp --help 查看用法"); }
  if (parsed.values.help) {
    process.stdout.write("用法：jdbi-mcp [setup] [--url MCP地址]\n在 MCP 客户端环境变量中填写 JDBI_API_KEY 即可直接启动。JDBI_MCP_URL 可指定站点；setup 是可选的终端配置方式。\n");
    return;
  }
  if (parsed.values.version) {
    process.stdout.write(`${JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8")).version}\n`);
    return;
  }
  const [command = "serve", ...extra] = parsed.positionals;
  if (extra.length || !["serve", "setup"].includes(command)) throw new ConnectorError("未知命令，请使用 jdbi-mcp --help 查看用法");
  if (command === "setup") await setup({ url: parsed.values.url });
  else await startStdio({ config: await loadConfig(process.env, parsed.values.url) });
}

// npm 的 bin 在 Linux 上是符号链接，不能用 argv[1] 与真实模块路径比较后才执行。
main().catch((error) => { process.stderr.write(`${errorMessage(error)}\n`); process.exitCode = 1; });
