import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@capaport/adapter-sdk';

export function createClaudeCodeAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'claude-code',
    displayName: 'Claude Code',
    supportedComponents: ['skill', 'prompt', 'context'],
    environment,
    roots: { user: '.claude', workspace: '.claude' },
    directories: { skill: 'skills', prompt: 'commands', context: 'rules' },
  });
}
