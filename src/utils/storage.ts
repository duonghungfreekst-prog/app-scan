/**
 * storage.ts — Key-Value storage dùng expo-file-system
 * Thay thế @react-native-async-storage/async-storage
 * Không phụ thuộc native module, tương thích RN 0.86 + New Arch
 */
import * as FileSystem from 'expo-file-system/legacy';

function getStoreFile(): string {
  const fs = FileSystem as any;
  const dir = fs.documentDirectory ?? fs.cacheDirectory ?? '';
  return dir + '_app_storage.json';
}

let cache: Record<string, string> | null = null;

async function loadCache(): Promise<Record<string, string>> {
  if (cache !== null) return cache;
  try {
    const storeFile = getStoreFile();
    const info = await (FileSystem as any).getInfoAsync(storeFile);
    if (info.exists) {
      const raw = await (FileSystem as any).readAsStringAsync(storeFile);
      cache = JSON.parse(raw) as Record<string, string>;
    } else {
      cache = {};
    }
  } catch {
    cache = {};
  }
  return cache;
}

async function saveCache(): Promise<void> {
  try {
    const storeFile = getStoreFile();
    await (FileSystem as any).writeAsStringAsync(storeFile, JSON.stringify(cache ?? {}));
  } catch {
    // ignore write errors
  }
}

export const Storage = {
  async getItem(key: string): Promise<string | null> {
    const store = await loadCache();
    return store[key] ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    const store = await loadCache();
    store[key] = value;
    await saveCache();
  },

  async removeItem(key: string): Promise<void> {
    const store = await loadCache();
    delete store[key];
    await saveCache();
  },

  async clear(): Promise<void> {
    cache = {};
    await saveCache();
  },
};

export default Storage;
