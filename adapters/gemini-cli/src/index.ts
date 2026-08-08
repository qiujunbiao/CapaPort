import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@capaport/adapter-sdk';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function decodeGeminiCommand(content: Uint8Array): Uint8Array {
  const source = decoder.decode(content);
  const basic = /^prompt\s*=\s*("(?:\\.|[^"\\])*")\s*$/m.exec(source)?.[1];
  if (basic) {
    try {
      return encoder.encode(JSON.parse(basic));
    } catch {
      // Preserve the native command when it uses TOML features outside the portable subset.
    }
  }
  const multiline = /^prompt\s*=\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')\s*$/m.exec(source);
  return encoder.encode(multiline?.[1] ?? multiline?.[2] ?? source);
}

function encodeGeminiCommand(content: Uint8Array, slug: string): Uint8Array {
  return encoder.encode(
    `description = ${JSON.stringify(`CapaPort capability ${slug}`)}\nprompt = ${JSON.stringify(decoder.decode(content))}\n`,
  );
}

export function createGeminiCliAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    supportedComponents: ['skill', 'prompt'],
    environment,
    roots: { user: '.gemini', workspace: '.gemini' },
    directories: { skill: 'skills', prompt: 'commands' },
    nativeFormats: { prompt: { extension: '.toml', decode: decodeGeminiCommand, encode: encodeGeminiCommand } },
  });
}
