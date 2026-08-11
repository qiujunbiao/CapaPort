import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type AdapterEnvironment,
  defaultAdapterEnvironment,
  type InstallScope,
} from '@capaport/adapter-sdk';
import type { AgentId } from '@capaport/contracts';
import { adapters } from './adapters.js';
import { UsageError } from './parser.js';

const roots: Record<AgentId, Partial<Record<InstallScope, string>>> = {
  codex: { user: '.agents', workspace: '.agents' },
  'claude-code': { user: '.claude', workspace: '.claude' },
  cursor: { user: '.cursor', workspace: '.cursor' },
  'gemini-cli': { user: '.gemini', workspace: '.gemini' },
  workbuddy: { user: '.workbuddy', workspace: '.codebuddy' },
  qwenwork: { user: '.qwenworkcn' },
};

export function resolveAgentRoot(
  agentId: AgentId,
  scope: InstallScope,
  environment: AdapterEnvironment = defaultAdapterEnvironment(),
): string {
  const relativeRoot = roots[agentId]?.[scope];
  if (!relativeRoot) throw new UsageError(`${agentId} 不支持 ${scope} scope`);
  const base = scope === 'user' ? environment.homeDir : environment.projectRoot;
  if (!base) throw new UsageError(`无法解析 ${agentId} 的 ${scope} 目录`);
  return resolve(base, relativeRoot);
}

export async function ensureAgentInstallation(
  agentId: AgentId,
  scope: InstallScope,
  environment: AdapterEnvironment = defaultAdapterEnvironment(),
) {
  const rootPath = resolveAgentRoot(agentId, scope, environment);
  await mkdir(rootPath, { recursive: true });
  const adapter = adapters(environment)[agentId];
  if (!adapter) throw new UsageError(`不支持 Agent：${agentId}`);
  const installation = (await adapter.detect()).find((item) => item.scope === scope && item.rootPath === rootPath);
  if (!installation) throw new Error(`无法初始化 ${agentId} 的 ${scope} 目录`);
  return { adapter, installation };
}
