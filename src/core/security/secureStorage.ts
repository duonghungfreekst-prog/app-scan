/**
 * secureStorage.ts — Quản lý lưu trữ an toàn sử dụng Android Keystore / iOS Keychain
 * Bảo vệ API Key, Secret Token, tránh lưu trữ dạng Plaintext JSON trên thiết bị.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { Storage } from '../../utils/storage';

export const SecureStorage = {
  /**
   * Lưu secret key an toàn
   */
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        // Fallback cho môi trường web / dev server
        await Storage.setItem(key, value);
        return;
      }
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch (e) {
      console.warn('[SecureStore] Failed to write securely, fallback to standard storage', e);
      await Storage.setItem(key, value);
    }
  },

  /**
   * Đọc secret key an toàn
   */
  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return await Storage.getItem(key);
      }
      const val = await SecureStore.getItemAsync(key);
      if (val !== null) return val;

      // Migration fallback: Nếu trong SecureStore chưa có nhưng bản cũ lưu trong JSON Storage
      const legacyVal = await Storage.getItem(key);
      if (legacyVal) {
        // Tự động migrate sang SecureStore và xóa ở legacy storage
        await this.setItem(key, legacyVal);
        await Storage.removeItem(key);
        return legacyVal;
      }
      return null;
    } catch (e) {
      console.warn('[SecureStore] Failed to read securely, fallback to standard storage', e);
      return await Storage.getItem(key);
    }
  },

  /**
   * Xóa secret key
   */
  async removeItem(key: string): Promise<void> {
    try {
      if (Platform.OS !== 'web') {
        await SecureStore.deleteItemAsync(key);
      }
    } catch (e) {
      console.warn('[SecureStore] Failed to delete from secure store', e);
    }
    // Xóa cả ở legacy storage phòng hờ
    await Storage.removeItem(key);
  },
};

export default SecureStorage;
