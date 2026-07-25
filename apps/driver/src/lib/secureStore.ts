import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as aesjs from 'aes-js';

/**
 * Encrypted session storage adapter for supabase-js on React Native (plan D10 / H10).
 *
 * `expo-secure-store` (iOS Keychain / Android Keystore) caps values at ~2KB — a Supabase session
 * (access + refresh JWT) can exceed that. So we split it:
 *   • a fresh random AES-256 key per record lives in the hardware-backed SecureStore, and
 *   • the AES-CTR ciphertext of the value lives in AsyncStorage (unbounded, but useless without the key).
 *
 * The refresh token therefore never sits in plaintext at rest. Mirrors Supabase's official RN recipe.
 */
export class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = Crypto.getRandomBytes(32); // AES-256 key, per record
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const cipherText = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(cipherText);
  }

  private async decrypt(key: string, cipherTextHex: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null; // key gone ⇒ treat as no session
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const plainBytes = cipher.decrypt(aesjs.utils.hex.toBytes(cipherTextHex));
    return aesjs.utils.utf8.fromBytes(plainBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const cipherTextHex = await AsyncStorage.getItem(key);
    if (!cipherTextHex) return null;
    try {
      return await this.decrypt(key, cipherTextHex);
    } catch {
      // Corrupt/rotated key — drop the record so the user re-authenticates cleanly.
      await this.removeItem(key);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const cipherTextHex = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, cipherTextHex);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}
