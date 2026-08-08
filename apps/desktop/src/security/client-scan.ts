import { extractArchive } from '@capaport/capability-kit';
import type { OrganizationSecurityPolicy } from '@capaport/contracts';
import { defaultScanPolicy, type ScanPolicy, type ScanReport, scanPackage } from '@capaport/security-scan';

export async function scanArchiveBeforeUpload(
  archive: Uint8Array,
  policy: ScanPolicy | OrganizationSecurityPolicy = defaultScanPolicy,
): Promise<ScanReport> {
  return scanPackage(extractArchive(archive), { ...defaultScanPolicy, ...policy });
}

export async function guardedUpload<T>(input: {
  archive: Uint8Array;
  policy?: ScanPolicy | OrganizationSecurityPolicy;
  confirmed: boolean;
  upload: () => Promise<T>;
}): Promise<{ report: ScanReport; uploaded: false } | { report: ScanReport; uploaded: true; value: T }> {
  const report = await scanArchiveBeforeUpload(input.archive, input.policy);
  if (report.blocked || (report.requiresConfirmation && !input.confirmed)) return { report, uploaded: false };
  return { report, uploaded: true, value: await input.upload() };
}
