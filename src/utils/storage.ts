/**
 * storage.ts — Key-Value storage dùng expo-file-system
 * Thay thế @react-native-async-storage/async-storage
 * Không phụ thuộc native module, tương thích RN 0.86 + New Arch
 * Bổ sung: Atomic Write, Write Queue chống Race Condition, Backup Recovery
 */
import * as FileSystem from 'expo-file-system/legacy';

function getStorePaths(): { storeFile: string; tmpFile: string; bakFile: string } {
  const fs = FileSystem as any;
  const dir = fs.documentDirectory ?? fs.cacheDirectory ?? '';
  return {
    storeFile: dir + '_app_storage.json',
    tmpFile: dir + '_app_storage.json.tmp',
    bakFile: dir + '_app_storage.json.bak',
  };
}

let cache: Record<string, string> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function readJsonFile(path: string): Promise<Record<string, string> | null> {
  try {
    const info = await (FileSystem as any).getInfoAsync(path);
    if (info.exists && info.size && info.size > 0) {
      const raw = await (FileSystem as any).readAsStringAsync(path);
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    }
  } catch (e) {
    console.warn(`[Storage] Failed to read ${path}:`, e);
  }
  return null;
}

async function loadCache(): Promise<Record<string, string>> {
  if (cache !== null) return cache;
  const { storeFile, bakFile, tmpFile } = getStorePaths();

  // 1. Thử đọc file chính
  let loaded = await readJsonFile(storeFile);

  // 2. Nếu file chính hỏng/rỗng, thử khôi phục từ file backup
  if (loaded === null) {
    console.warn('[Storage] Main file corrupted or missing, attempting backup restore...');
    loaded = await readJsonFile(bakFile);
  }

  // 3. Nếu vẫn không có, kiểm tra file tạm dở dang
  if (loaded === null) {
    loaded = await readJsonFile(tmpFile);
  }

  cache = loaded ?? {};
  return cache;
}

async function executeAtomicSave(data: Record<string, string>): Promise<void> {
  const { storeFile, tmpFile, bakFile } = getStorePaths();
  const fs = FileSystem as any;
  const jsonContent = JSON.stringify(data);

  try {
    // Bước 1: Ghi dữ liệu vào file tạm .tmp
    await fs.writeAsStringAsync(tmpFile, jsonContent);

    // Bước 2: Tạo bản backup từ file hiện tại (nếu tồn tại)
    const storeInfo = await fs.getInfoAsync(storeFile);
    if (storeInfo.exists && storeInfo.size && storeInfo.size > 0) {
      try {
        await fs.copyAsync({ from: storeFile, to: bakFile });
      } catch {
        // bỏ qua nếu copy backup thất bại
      }
    }

    // Bước 3: Đổi tên file tạm .tmp thành file chính .json (Atomic move)
    await fs.moveAsync({ from: tmpFile, to: storeFile });
  } catch (err) {
    console.error('[Storage] Atomic write failed:', err);
    // Cố gắng dọn file tmp nếu lỗi
    try {
      await fs.deleteAsync(tmpFile, { idempotent: true });
    } catch {}
  }
}

function queueSave(): Promise<void> {
  // Xếp hàng ghi tuần tự qua Promise chain (Mutex) để chống race condition
  const snapshot = cache ? { ...cache } : {};
  writeQueue = writeQueue.then(() => executeAtomicSave(snapshot)).catch(e => {
    console.error('[Storage] Queue save error:', e);
  });
  return writeQueue;
}

export const Storage = {
  async getItem(key: string): Promise<string | null> {
    const store = await loadCache();
    return store[key] ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    const store = await loadCache();
    store[key] = value;
    await queueSave();
  },

  async removeItem(key: string): Promise<void> {
    const store = await loadCache();
    delete store[key];
    await queueSave();
  },

  async clear(): Promise<void> {
    cache = {};
    await queueSave();
  },

  // Phương thức hỗ trợ flush toàn bộ hàng đợi ghi trước khi thoát/kill
  async flush(): Promise<void> {
    await writeQueue;
  },
};

export default Storage;
