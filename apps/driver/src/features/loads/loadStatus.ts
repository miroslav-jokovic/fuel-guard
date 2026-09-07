import type { Tone } from '@/components';
import type { LoadStatus as ContractStatus } from '@silvicom/shared';
import { loadBucket } from '@silvicom/shared';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/** The five states a driver ever sees, out of the eight the lifecycle holds (D45). */
export type DriverLoadStatus = 'offered' | 'upcoming' | 'in_transit' | 'delivered' | 'canceled';

export function driverLoadStatus(status: ContractStatus): DriverLoadStatus {
  if (status === 'offered') return 'offered';
  if (status === 'canceled') return 'canceled';
  if (status === 'delivered') return 'delivered';
  return loadBucket(status) === 'current' ? 'in_transit' : 'upcoming';
}

export const LOAD_STATUS: Record<DriverLoadStatus, { label: string; tone: Tone; icon: MaterialSymbolName }> = {
  offered: { label: 'Offered', tone: 'info', icon: 'schedule' },
  upcoming: { label: 'Accepted', tone: 'neutral', icon: 'schedule' },
  in_transit: { label: 'In transit', tone: 'action', icon: 'route' },
  delivered: { label: 'Delivered', tone: 'success', icon: 'check_circle' },
  canceled: { label: 'Canceled', tone: 'neutral', icon: 'cancel' },
};
