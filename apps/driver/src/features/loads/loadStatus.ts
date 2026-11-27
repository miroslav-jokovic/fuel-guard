import type { Tone } from '@/components';
import type { LoadStatus as ContractStatus } from '@silvicom/shared';
import { loadBucket } from '@silvicom/shared';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/** The five states a driver ever sees, out of the eight the lifecycle holds (D45). */
export type DriverLoadStatus = 'offered' | 'dispatched' | 'upcoming' | 'in_transit' | 'delivered' | 'canceled';

export function driverLoadStatus(status: ContractStatus): DriverLoadStatus {
  if (status === 'offered') return 'offered';
  // A McLeod load the office SENT before its first stop departed (0655, DF-1). The driver never
  // accepted it — McLeod dispatched it — so it must not read "Accepted".
  if (status === 'pending_approval' || status === 'approved') return 'dispatched';
  if (status === 'canceled') return 'canceled';
  if (status === 'delivered') return 'delivered';
  return loadBucket(status) === 'current' ? 'in_transit' : 'upcoming';
}

export const LOAD_STATUS: Record<DriverLoadStatus, { label: string; tone: Tone; icon: MaterialSymbolName }> = {
  offered: { label: 'Offered', tone: 'info', icon: 'schedule' },
  dispatched: { label: 'Dispatched', tone: 'neutral', icon: 'schedule' },
  upcoming: { label: 'Accepted', tone: 'neutral', icon: 'schedule' },
  in_transit: { label: 'In transit', tone: 'action', icon: 'route' },
  delivered: { label: 'Delivered', tone: 'success', icon: 'check_circle' },
  canceled: { label: 'Canceled', tone: 'neutral', icon: 'cancel' },
};
