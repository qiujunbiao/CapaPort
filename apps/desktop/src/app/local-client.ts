import { invoke } from '@tauri-apps/api/core';
import type { InstallPlan } from '../generated/commands';
import type { LocalClient, LocalPackageExport } from './types';

export function createLocalClient(): LocalClient {
  return {
    detectAgents: () => invoke('detect_agents'),
    inventoryAgent: (input) => invoke('inventory_agent', { input }),
    scanLocalPackage: (path) => invoke('scan_local_package', { input: { path } }),
    exportLocalPackage: (input) => invoke<LocalPackageExport>('export_local_package', { input }),
    previewInstall: (plan: InstallPlan) => invoke('preview_install', { plan }),
    applyInstall: (plan: InstallPlan) => invoke('apply_install', { plan }),
    rollbackInstall: (transactionId) => invoke('rollback_install', { transactionId }),
    bindProjectDirectory: (input) => invoke('bind_project_directory', { input }),
    syncQueueStatus: () => invoke('sync_queue_status'),
    storeSession: (session) => invoke('store_session', { session }),
    loadSession: () => invoke('load_session'),
    clearSession: () => invoke('clear_session'),
  };
}
