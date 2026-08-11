export { buildArchive, extractArchive } from './archive.js';
export { diffPackages, type PackageDiff } from './diff.js';
export {
  addPackageComponent,
  agentComponentSupport,
  agentLabels,
  compatibleAgentsForComponents,
  createEditablePackage,
  type EditableAgent,
  type EditableCapabilityPackage,
  type EditableComponentType,
  type EditablePackageComponent,
  type EditablePackageExport,
  exportEditablePackage,
  importEditablePackage,
  removePackageComponent,
  unsupportedComponentsForAgent,
  updatePackageComponent,
  updatePackageMetadata,
  validateEditablePackage,
} from './editor.js';
export { hashPackage, normalizePackageFiles, type PackageFile } from './hash.js';
export { parseManifest } from './manifest.js';
export { type CapabilityManifest, manifestSchema, normalizePackagePath } from './schema.js';
export { classifyVersion, type VersionChange } from './version.js';
