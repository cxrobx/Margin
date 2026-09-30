function shellQuote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
export function connectionInfo(command, serverPath, dataDir, electron = false) {
  const env = { MARGIN_DATA_DIR: dataDir, ...(electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
  const envArgs = Object.entries(env).map(([key, value]) => `--env ${shellQuote(`${key}=${value}`)}`).join(' ');
  return {
    dataDir, serverPath,
    codex: `codex mcp add margin ${envArgs} -- ${shellQuote(command)} ${shellQuote(serverPath)}`,
    claude: `claude mcp add ${envArgs} --transport stdio --scope user margin -- ${shellQuote(command)} ${shellQuote(serverPath)}`,
    codexToml: `[mcp_servers.margin]\ncommand = ${JSON.stringify(command)}\nargs = [${JSON.stringify(serverPath)}]\n\n[mcp_servers.margin.env]\n${Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')}`,
    claudeDesktop: JSON.stringify({ mcpServers: { margin: { command, args: [serverPath], env } } }, null, 2)
  };
}
