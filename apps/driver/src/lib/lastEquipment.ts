import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Last-used equipment memory (D-PM9 recent-first ranking). Local, per-device, best-effort — it only
 * influences roster ORDER, never selection, so a lost value costs nothing. AsyncStorage (not
 * SecureStore): unit ids are not secrets and the read happens on every check-in open.
 */
const KEY = 'fg.lastEquipment.v1';

export interface LastEquipment {
  vehicleId: string | null;
  trailerId: string | null;
}

export async function readLastEquipment(): Promise<LastEquipment> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { vehicleId: null, trailerId: null };
    const parsed = JSON.parse(raw) as Partial<LastEquipment>;
    return {
      vehicleId: typeof parsed.vehicleId === 'string' ? parsed.vehicleId : null,
      trailerId: typeof parsed.trailerId === 'string' ? parsed.trailerId : null,
    };
  } catch {
    return { vehicleId: null, trailerId: null };
  }
}

export async function writeLastEquipment(next: Partial<LastEquipment>): Promise<void> {
  try {
    const cur = await readLastEquipment();
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...cur, ...next }));
  } catch {
    // best-effort only
  }
}
