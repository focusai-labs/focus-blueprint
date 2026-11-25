// `bp mcp list`: which MCP servers this project can see, without ever printing a URL, command,
// argument, env value or header. Only name, scope, transport, connected and Supabase booleans leave here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, supabaseServerFacts, mapSupabaseRef } from '../hooks/lib.mjs';
import { runClaude } from './install-check.mjs';

const STATUS = /\s-\s+(\S+)\s+(.*)$/;

/** Parse `claude mcp list` output into [{ name, def, transport, connected, claudeAi }]. Raw text never leaves. */
export function parseMcpList(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const i = line.indexOf(': ');
    if (i < 1) continue;
    const name = line.slice(0, i).trim();
    let rest = line.slice(i + 2);
    const st = rest.match(STATUS);
    if (!st) continue;
    const mark = st[1];
    const label = st[2];
    rest = rest.slice(0, st.index).trim();
    let connected = null;
    if (/connected/i.test(label) && !/not connected|disconnected/i.test(label)) connected = true;
    else if (/needs auth|fail|error|not connected|disconnected/i.test(label)) connected = false;
    else if (mark === '✓') connected = true;
    else if (mark === '✗') connected = false;
    const kind = rest.match(/\((HTTP|SSE|STDIO)\)\s*$/i);
    const body = rest.replace(/\s*\((HTTP|SSE|STDIO)\)\s*$/i, '').trim();
    const isUrl = /^https?:\/\//i.test(body);
    const transport = kind ? kind[1].toLowerCase() : isUrl ? 'http' : body ? 'stdio' : 'unknown';
    const def = isUrl ? { url: body } : { command: body.split(/\s+/)[0] || '', args: body.split(/\s+/).slice(1) };
    out.push({ name, def, transport, connected, claudeAi: /^claude\.ai\s/i.test(name) });
  }
  return out;
}

function transportOf(def) {
  if (!def || typeof def !== 'object') return 'unknown';
  const t = typeof def.type === 'string' ? def.type.toLowerCase() : '';
  if (t === 'sse') return 'sse';
  if (t === 'http' || t === 'streamable-http') return 'http';
  if (t === 'stdio') return 'stdio';
  if (typeof def.url === 'string') return 'http';
  if (typeof def.command === 'string') return 'stdio';
  return 'unknown';
}

/**
 * Merge the live list with the config files. Pure: all inputs are passed in.
 * { listText (null when claude could not run), userServers, localServers, projectServers, ownRef }
 */
export function buildMcpList({ listText, userServers, localServers, projectServers, ownRef }) {
  const byName = new Map();
  const add = (servers, scope) => {
    if (!servers || typeof servers !== 'object') return;
    for (const [name, def] of Object.entries(servers)) {
      if (!byName.has(name)) byName.set(name, { name, scope, def, transport: transportOf(def), connected: null });
    }
  };
  // Precedence follows Claude Code: local, then project, then user.
  add(localServers, 'local');
  add(projectServers, 'project');
  add(userServers, 'user');
  for (const s of parseMcpList(listText)) {
    const cur = byName.get(s.name);
    if (cur) {
      cur.connected = s.connected;
      if (cur.transport === 'unknown') cur.transport = s.transport;
    } else {
      byName.set(s.name, { name: s.name, scope: s.claudeAi ? 'claude.ai' : 'unknown', def: s.def, transport: s.transport, connected: s.connected });
    }
  }
  return [...byName.values()].map((s) => {
    const row = { name: s.name, scope: s.scope, transport: s.transport, connected: s.connected };
    const f = supabaseServerFacts(s.def);
    if (f) row.supabase = { scopedToThisProject: Boolean(ownRef && f.ref && f.ref === ownRef), readOnly: f.readOnly === true, docsOnly: f.docsOnly === true };
    return row;
  });
}

/** Gather everything from the real machine for one project. */
export function mcpList(project, { home = os.homedir(), claude = runClaude } = {}) {
  const dir = project.dir;
  let userServers = null; let localServers = null;
  try {
    const cj = readJson(path.join(home, '.claude.json'));
    if (cj) {
      userServers = cj.mcpServers;
      const p = cj.projects && (cj.projects[dir] || cj.projects[dir.split(path.sep).join('/')]);
      if (p) localServers = p.mcpServers;
    }
  } catch { /* unreadable config: skip */ }
  let projectServers = null;
  try { const mj = readJson(path.join(dir, '.mcp.json')); if (mj) projectServers = mj.mcpServers; } catch { /* skip */ }
  let listText = null;
  try { listText = claude(['mcp', 'list']); } catch { listText = null; }
  return { servers: buildMcpList({ listText, userServers, localServers, projectServers, ownRef: mapSupabaseRef(project) }) };
}
