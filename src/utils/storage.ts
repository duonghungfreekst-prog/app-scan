/**
 * storage.ts — Key-Value storage an toàn với Schema Versioning & Atomic Write
 * - Phục vụ thay thế @react-native-async-storage/async-storage
 * - Schema Versioning & Tự động Migration từ định dạng cũ
 * - FIFO Mutex Write Queue chống race condition
 * - Atomic write (.tmp -> .json) kèm bản lưu dự phòng (.bak)
 * - Ném StorageError rõ ràng khi ghi hỏng, không nuốt lỗi
 */
import * as FileSystem from 'expo-file-system/legacy';
import { StorageSchema } from '../types/domain';

export class StorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(`[StorageError] ${message}`);
    this.name = 'StorageError';
  }
}

const CURRENT_SCHEMA_VERSION = 1;

function getStorePaths(): { storeFile: string; tmpFile: string; bakFile: string } {
  const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
  return {
    storeFile: dir + '_app_storage.json',
    tmpFile: dir + '_app_storage.json.tmp',
    bakFile: dir + '_app_storage.json.bak',
  };
}

let cache: StorageSchema | null = null;
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Migration helper: Chuyển đổi dữ liệu cũ (flat key-value) sang StorageSchema versioned
 */
function migrateData(rawObj: any): StorageSchema {
  if (rawObj && typeof rawObj === 'object') {
    if (typeof rawObj.version === 'number' && rawObj.data && typeof rawObj.data === 'object') {
      return rawObj as StorageSchema;
    }
    // Dữ liệu cũ dạng phẳng { key: value }
    const cleanData: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawObj)) {
      if (typeof v === 'string') {
        cleanData[k] = v;
      }
    }
    return {
      version: CURRENT_SCHEMA_VERSION,
      lastUpdated: Date.now(),
      data: cleanData,
    };
  }
  return {
    version: CURRENT_SCHEMA_VERSION,
    lastUpdated: Date.now(),
    data: {},
  };
}

async function readJsonFile(path: string): Promise<StorageSchema | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists && info.size && info.size > 0) {
      const raw = await FileSystem.readAsStringAsync(path);
      const parsed = JSON.parse(raw);
      return migrateData(parsed);
    }
  } catch (e) {
    console.warn(`[Storage] Failed to read ${path}:`, e);
  }
  return null;
}

async function loadCache(): Promise<StorageSchema> {
  if (cache !== null) return cache;
  const { storeFile, bakFile, tmpFile } = getStorePaths();

  // 1. Thử đọc file chính
  let loaded = await readJsonFile(storeFile);

  // 2. Nếu file chính hỏng/rỗng, thử khôi phục từ file backup
  if (loaded === null) {
    console.warn('[Storage] Main store corrupted or missing, attempting backup restore...');
    loaded = await readJsonFile(bakFile);
  }

  // 3. Nếu vẫn không có, kiểm tra file tạm dở dang
  if (loaded === null) {
    loaded = await readJsonFile(tmpFile);
  }

  cache = loaded ?? {
    version: CURRENT_SCHEMA_VERSION,
    lastUpdated: Date.now(),
    data: {},
  };
  return cache;
}

async function executeAtomicSave(snapshot: StorageSchema): Promise<void> {
  const { storeFile, tmpFile, bakFile } = getStorePaths();
  snapshot.lastUpdated = Date.now();
  const jsonContent = JSON.stringify(snapshot);

  try {
    // Bước 1: Ghi dữ liệu vào file tạm .tmp
    await FileSystem.writeAsStringAsync(tmpFile, jsonContent);

    // Bước 2: Tạo bản backup từ file hiện tại (nếu tồn tại)
    const storeInfo = await FileSystem.getInfoAsync(storeFile);
    if (storeInfo.exists && storeInfo.size && storeInfo.size > 0) {
      try {
        await FileSystem.copyAsync({ from: storeFile, to: bakFile });
      } catch {
        // Bỏ qua lỗi copy backup nếu hệ thống bận
      }
    }

    // Bước 3: Đổi tên file tạm .tmp thành file chính .json (Atomic move)
    await FileSystem.moveAsync({ from: tmpFile, to: storeFile });

    // Bước 4: Dọn dẹp file backup tạm sau khi ghi đè thành công
    try {
      await FileSystem.deleteAsync(bakFile, { idempotent: true });
    } catch {}
  } catch (err) {
    // Dọn dẹp file tạm nếu xảy ra lỗi
    try {
      await FileSystem.deleteAsync(tmpFile, { idempotent: true });
    } catch {}
    throw new StorageError('Atomic write failed to save app storage', err);
  }
}

function queueSave(): Promise<void> {
  if (!cache) return Promise.resolve();
  const snapshot: StorageSchema = {
    version: cache.version,
    lastUpdated: Date.now(),
    data: { ...cache.data },
  };

  // FIX: writeQueue used to be reassigned to the *same* rejected/resolved promise
  // chain (`writeQueue.then(...).catch(...)`). Once any single write failed, that
  // chain became a permanently-rejected promise, so every subsequent
  // `writeQueue.then(nextSave)` was skipped forever (no onRejected handler) —
  // silently dropping every write for the rest of the app session while only
  // re-throwing the *original* stale error. We now always resume from a resolved
  // promise so one failed write can never poison later ones, and each write's own
  // error is reported for that write only.
  const thisSave = writeQueue
    .catch(() => {}) // never let a previous failure block this write from attempting
    .then(() => executeAtomicSave(snapshot));

  writeQueue = thisSave.catch(e => {
    console.error('[Storage] Queue save error:', e);
    // swallow here so the *queue* stays healthy; the error is still surfaced below
  });

  return thisSave;
}

export const Storage = {
  async getItem(key: string): Promise<string | null> {
    const store = await loadCache();
    return store.data[key] ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    const store = await loadCache();
    store.data[key] = value;
    await queueSave();
  },

  async removeItem(key: string): Promise<void> {
    const store = await loadCache();
    delete store.data[key];
    await queueSave();
  },

  async clear(): Promise<void> {
    const store = await loadCache();
    store.data = {};
    await queueSave();
  },

  async getAllKeys(): Promise<string[]> {
    const store = await loadCache();
    return Object.keys(store.data);
  },

  async flush(): Promise<void> {
    await writeQueue;
  },
};

export default Storage;
