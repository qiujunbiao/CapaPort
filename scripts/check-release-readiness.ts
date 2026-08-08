import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const tauri = JSON.parse(await readFile(resolve(repositoryRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')) as {
  version?: string;
  plugins?: { updater?: { pubkey?: string; endpoints?: string[]; dangerousInsecureTransportProtocol?: boolean } };
};
const desktopPackage = JSON.parse(await readFile(resolve(repositoryRoot, 'apps/desktop/package.json'), 'utf8')) as {
  version?: string;
};
const developmentUpdaterKey =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgQUZGMDFGNTY0MUEzNEZENgpSV1RXVDZOQlZoL3dyOTVCVDljczliT0pvWEY3Y3FjaUIySmRYSkZKUEcvaUVtbkZBU1hPYzgzOQ==';
const updater = tauri.plugins?.updater;
const errors: string[] = [];

if (!tauri.version || tauri.version !== desktopPackage.version) {
  errors.push('Tauri and desktop package versions must match.');
}
if (!updater?.pubkey || updater.pubkey === developmentUpdaterKey) {
  errors.push('Replace the development Tauri updater public key before release.');
}
if (!updater?.endpoints?.length || updater.endpoints.some((endpoint) => !endpoint.startsWith('https://'))) {
  errors.push('Updater endpoints must use HTTPS.');
}
if (updater?.dangerousInsecureTransportProtocol !== false) {
  errors.push('Insecure updater transport must remain disabled.');
}

if (errors.length) {
  process.stderr.write(`${errors.map((error) => `release-preflight: ${error}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`release-preflight=passed version=${tauri.version}\n`);
