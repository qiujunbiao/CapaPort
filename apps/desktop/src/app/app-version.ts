export const bundledAppVersion =
  typeof __CAPAPORT_VERSION__ === 'string' && __CAPAPORT_VERSION__ ? __CAPAPORT_VERSION__ : 'development';

export async function resolveDesktopVersion(
  getVersion: () => Promise<string> = async () => {
    const { getVersion: tauriGetVersion } = await import('@tauri-apps/api/app');
    return tauriGetVersion();
  },
): Promise<string> {
  try {
    return (await getVersion()) || bundledAppVersion;
  } catch {
    return bundledAppVersion;
  }
}
