import { invoke } from '@tauri-apps/api/core';
import type { InstallPlan } from '../generated/commands';
import type { LocalClient, LocalPackageExport } from './types';

export function createLocalClient(): LocalClient {
  return {
    detectAgents: () => invoke('detect_agents'),
    inventoryAgent: (input) => invoke('inventory_agent', { input }),
    scanLocalPackage: (path) => invoke('scan_local_package', { input: { path } }),
    readManagedFile: (input) => invoke('read_managed_file', { input }),
    exportLocalPackage: (input) => invoke<LocalPackageExport>('export_local_package', { input }),
    previewInstall: (plan: InstallPlan) => invoke('preview_install', { plan }),
    applyInstall: (plan: InstallPlan) => invoke('apply_install', { plan }),
    rollbackInstall: (transactionId) => invoke('rollback_install', { transactionId }),
    loadInstallLock: (input) => invoke('load_install_lock', { input }),
    uninstall: (input) => invoke('uninstall', { input }),
    bindProjectDirectory: (input) => invoke('bind_project_directory', { input }),
    listProjectBindings: (spaceId) => invoke('list_project_bindings', { input: { spaceId } }),
    removeProjectBinding: (localBindingId) => invoke('remove_project_binding', { input: { localBindingId } }),
    inventoryProjectContext: (localBindingId) => invoke('inventory_project_context', { input: { localBindingId } }),
    exportProjectContext: (input) => invoke('export_project_context', { input }),
    projectContextPlan: (input) => invoke('project_context_plan', { input }),
    syncQueueStatus: () => invoke('sync_queue_status'),
    enqueueWrite: (input) => invoke('enqueue_write', { input }),
    claimReadyWrites: (now, limit) => invoke('claim_ready_writes', { input: { now, limit } }),
    completeWrite: (id) => invoke('complete_write', { input: { id } }),
    rescheduleWrite: (input) => invoke('reschedule_write', { input }),
    retryFailedWrites: (now) => invoke('retry_failed_writes', { input: { now } }),
    storeSession: (session) => invoke('store_session', { session }),
    loadSession: () => invoke('load_session'),
    clearSession: () => invoke('clear_session'),
  };
}
