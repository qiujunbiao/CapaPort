import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@agentdoor/adapter-sdk';

export function createGeminiCliAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    supportedComponents: ['skill', 'prompt'],
    environment,
    roots: { user: '.gemini', workspace: '.gemini' },
    directories: { skill: 'skills', prompt: 'commands' },
  });
}
