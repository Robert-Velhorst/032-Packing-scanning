import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { ScanTarget } from './contract';
import type { ScanCapabilities } from './contract';
import type { InteriorReview } from './interior-cavity';
import type { ScanRetentionDays } from '../scan-retention';

export interface CaptureStorageState {version:1;revision:string;lease:string|null;protectedWorkspace:boolean;}

interface NativePackingScan {
  getRetentionCapabilities():Promise<{version:1;supported:boolean}>;
  pruneExpiredSources(options:{lease:string;days:ScanRetentionDays;afterId?:string}):Promise<unknown>;
  getStorageState():Promise<CaptureStorageState>;
  selectGuestStorage(options:{revision:string}):Promise<CaptureStorageState>;
  openWorkspaceStorage(options:{revision:string;workspaceId:string;accountId:string;keyBytes:number[]}):Promise<CaptureStorageState>;
  lockStorage(options:{revision:string}):Promise<CaptureStorageState>;
  touchStorage(options:{lease:string}):Promise<void>;
  addListener(event:'captureWorkspaceLocked',listener:(event:{lease:string})=>void):Promise<PluginListenerHandle>;
  getCapabilities(): Promise<ScanCapabilities>;
  scanObject(options: { target: ScanTarget;lease?:string;recognize?:boolean }): Promise<unknown>;
  deleteCapture(options: { id: string;lease?:string }): Promise<{ deleted: boolean }>;
  clearCaptures(options?:{lease?:string}): Promise<{ deleted: number }>;
  reconstructCapture(options: { id: string;lease?:string }): Promise<unknown>;
  reconstructInterior(options: InteriorReview & { id: string;lease?:string }): Promise<unknown>;
  getCapturePreview(options: { id: string;lease?:string }): Promise<unknown>;
}

export const PackingScan = registerPlugin<NativePackingScan>('PackingScan');
