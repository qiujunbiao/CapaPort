import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CanonicalPackage } from '@capaport/adapter-sdk';
import { buildArchive, extractArchive, hashPackage, parseManifest } from '@capaport/capability-kit';

export function archivePackage(pkg: CanonicalPackage) {
  return buildArchive(pkg.files);
}
export function archiveSha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}
export async function canonicalPackage(archive: Uint8Array): Promise<CanonicalPackage> {
  const files = extractArchive(archive);
  const manifestFile = files.find((file) => file.path === 'capaport.yaml');
  if (!manifestFile) throw new Error('能力包缺少 capaport.yaml');
  const manifest = parseManifest(new TextDecoder().decode(manifestFile.content));
  return { manifest, files, digest: await hashPackage(files) };
}
export async function readArchive(path: string) {
  return new Uint8Array(await readFile(path));
}
