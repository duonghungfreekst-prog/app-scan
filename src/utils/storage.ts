/**
 * storage.ts — Key-Value storage an toàn với Schema Versioning & Atomic Write
 * - Phục vụ thay thế @react-native-async-storage/async-storage
 * - Schema Versioning (v2) & Tự động Migration từ định dạng cũ (v0 legacy, v1)
 * - FIFO Mutex / Promise Queue chống race condition khi ghi đồng thời nhiều bản ghi
 * - Atomic write (.tmp -> .json) kèm bản lưu dự phòng (.bak)
 * - Bắt lỗi hạn ngạch QuotaExceededError và cảnh báo bộ nhớ đầy
 * - Ném StorageError / QuotaExceededError rõ ràng khi ghi hỏng, không nuốt lỗi
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Alert } from 'react-native';
import { StorageSchema } from '../types/domain';

export class StorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(`[StorageError] ${message}`);
    this.name = 'StorageError';
  }
}

export class QuotaExceededError extends Error {
  constructor(message: string = 'Dung lượng bộ nhớ đã đầy (Quota Exceeded)', public readonly cause?: unknown) {
    super(`[QuotaExceededError] ${message}`);
    this.name = 'QuotaExceededError';
  }
}

/**
 * Mutex / Promise Queue: Điều phối các tác vụ ghi đồng thời, chống Race Condition.
 * Đảm bảo các tác vụ ghi vào Storage được xử lý tuần tự theo cơ chế FIFO (First In First Out),
 * đồng thời có cơ chế tự phục hồi (resilient) chống tắc nghẽn Poisoned Promise nếu có một tác vụ thất bại.
 */
export class Mutex {
  private queue: Promise<void> = Promise.resolve();

  runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
    let releaseLock!: () => void;
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    const previous = this.queue;
    this.queue = lockPromise;

    return previous
      .catch(() => {}) // Chống ngộ độc hàng đợi: lỗi tác vụ trước không làm đứt chuỗi
      .then(async () => {
        try {
          return await task();
        } finally {
          releaseLock();
        }
      });
  }
}

export const CURRENT_SCHEMA_VERSION = 2;

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
const storageMutex = new Mutex();
let loadPromise: Promise<StorageSchema> | null = null;

let lastQuotaAlertTime = 0;
const QUOTA_ALERT_THROTTLE_MS = 5000;

/**
 * Kiểm tra lỗi có phải do hết dung lượng bộ nhớ / hạn ngạch (QuotaExceededError / ENOSPC)
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof QuotaExceededError) return true;
  const errorObj = err as any;
  if (errorObj.name === 'QuotaExceededError') return true;
  if (
    errorObj.code === 22 ||
    errorObj.code === 'QUOTA_EXCEEDED_ERR' ||
    errorObj.code === 'ENOSPC' ||
    errorObj.code === 'ERR_FILESYSTEM_NO_ENOUGH_SPACE'
  ) {
    return true;
  }
  const msg = String(errorObj.message || errorObj.description || '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('enospc') ||
    msg.includes('no space left') ||
    msg.includes('storage full') ||
    msg.includes('disk full') ||
    msg.includes('disk is full') ||
    (msg.includes('bộ nhớ') && msg.includes('đầy')) ||
    (msg.includes('dung lượng') && msg.includes('đầy')) ||
    msg.includes('hết dung lượng') ||
    msg.includes('hết bộ nhớ')
  );
}

/**
 * Hiển thị cảnh báo bộ nhớ đầy cho người dùng (có chống spam Alert liên tục)
 */
function notifyQuotaExceeded(err: unknown): void {
  const now = Date.now();
  console.error('[Storage] QuotaExceededError: Bộ nhớ lưu trữ trên thiết bị đã đầy.', err);

  if (now - lastQuotaAlertTime > QUOTA_ALERT_THROTTLE_MS) {
    lastQuotaAlertTime = now;
    try {
      if (typeof Alert !== 'undefined' && typeof Alert?.alert === 'function') {
        Alert.alert(
          'Cảnh báo bộ nhớ đầy',
          'Bộ nhớ lưu trữ trên thiết bị đã đầy (Quota Exceeded). Vui lòng dọn dẹp dung lượng thiết bị hoặc xóa bớt tài liệu để tiếp tục lưu trữ.',
          [{ text: 'Đã hiểu', style: 'default' }]
        );
      }
    } catch {
      // Môi trường không có UI (test unit / worker)
    }
  }
}

type MigrationFunction = (data: Record<string, string>) => Record<string, string>;

/**
 * Bảng đăng ký các bước migration theo version schema:
 * - v1 -> v2: Chuẩn hóa dữ liệu cấu hình, chuyển đổi key cũ và làm sạch chuỗi
 */
const SCHEMA_MIGRATIONS: Record<number, MigrationFunction> = {
  // Migration v1 -> v2:
  2: (data: Record<string, string>): Record<string, string> => {
    console.log('[Storage] Đang migrate schema từ v1 lên v2...');
    const migratedData = { ...data };
    // Chuyển đổi setting giao diện cũ nếu có
    if (migratedData['@camscanner_dark_mode'] && !migratedData['@camscanner_theme_mode']) {
      const isDark = migratedData['@camscanner_dark_mode'] === 'true';
      migratedData['@camscanner_theme_mode'] = isDark ? 'dark' : 'light';
    }
    // Làm sạch và đảm bảo tất cả giá trị đều là chuỗi
    for (const [k, v] of Object.entries(migratedData)) {
      if (typeof v !== 'string') {
        migratedData[k] = String(v ?? '');
      }
    }
    return migratedData;
  },
};

/**
 * Migration helper: Chuyển đổi dữ liệu cũ (flat key-value v0 hoặc schema v1) sang schema hiện tại (v2)
 */
export function migrateData(rawObj: any): { schema: StorageSchema; wasMigrated: boolean } {
  if (!rawObj || typeof rawObj !== 'object') {
    return {
      schema: {
        version: CURRENT_SCHEMA_VERSION,
        lastUpdated: Date.now(),
        data: {},
      },
      wasMigrated: false,
    };
  }

  let currentVersion = 0;
  let currentData: Record<string, string> = {};

  if (typeof rawObj.version === 'number' && rawObj.data && typeof rawObj.data === 'object') {
    // Đã có schema version
    currentVersion = rawObj.version;
    for (const [k, v] of Object.entries(rawObj.data)) {
      if (typeof v === 'string') {
        currentData[k] = v;
      } else if (v !== null && v !== undefined) {
        currentData[k] = String(v);
      }
    }
  } else {
    // Dữ liệu cũ v0 dạng phẳng { key: value }
    currentVersion = 0;
    for (const [k, v] of Object.entries(rawObj)) {
      if (typeof v === 'string') {
        currentData[k] = v;
      } else if (v !== null && v !== undefined) {
        currentData[k] = String(v);
      }
    }
  }

  let wasMigrated = false;

  // Nếu dữ liệu thuộc version cũ hơn CURRENT_SCHEMA_VERSION, chạy migration tuần tự
  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    wasMigrated = true;
    console.log(`[Storage] Phát hiện schema version cũ (${currentVersion}). Tự động migrate lên v${CURRENT_SCHEMA_VERSION}...`);

    for (let targetVer = currentVersion + 1; targetVer <= CURRENT_SCHEMA_VERSION; targetVer++) {
      const migrator = SCHEMA_MIGRATIONS[targetVer];
      if (typeof migrator === 'function') {
        currentData = migrator(currentData);
      }
      currentVersion = targetVer;
    }
  }

  return {
    schema: {
      version: CURRENT_SCHEMA_VERSION,
      lastUpdated: wasMigrated ? Date.now() : (rawObj.lastUpdated ?? Date.now()),
      data: currentData,
    },
    wasMigrated,
  };
}

async function readJsonFile(path: string): Promise<{ schema: StorageSchema; wasMigrated: boolean } | null> {
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
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
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

    if (loaded) {
      cache = loaded.schema;
      // Tự động lưu bản migrate mới lên disk nếu vừa được nâng cấp từ version cũ
      if (loaded.wasMigrated) {
        console.log('[Storage] Đã migrate schema lên v2 thành công. Đang lưu lại vào disk...');
        queueSave().catch(e => {
          console.warn('[Storage] Lưu dữ liệu sau migrate thất bại:', e);
        });
      }
    } else {
      cache = {
        version: CURRENT_SCHEMA_VERSION,
        lastUpdated: Date.now(),
        data: {},
      };
    }

    return cache;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
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
  } catch (err: unknown) {
    // Dọn dẹp file tạm nếu xảy ra lỗi
    try {
      await FileSystem.deleteAsync(tmpFile, { idempotent: true });
    } catch {}

    // Bắt lỗi hạn ngạch QuotaExceededError và cảnh báo bộ nhớ đầy
    if (isQuotaExceededError(err)) {
      notifyQuotaExceeded(err);
      throw new QuotaExceededError('Bộ nhớ lưu trữ đã đầy khi thực hiện Atomic Write (QuotaExceededError)', err);
    }

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

  const thisSave = writeQueue
    .catch(() => {}) // Chống ngộ độc hàng đợi: lỗi ghi trước không chặn lần ghi sau
    .then(() => executeAtomicSave(snapshot));

  writeQueue = thisSave.catch(e => {
    console.error('[Storage] Queue save error:', e);
  });

  return thisSave;
}

export const Storage = {
  async getItem(key: string): Promise<string | null> {
    const store = await loadCache();
    return store.data[key] ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    return storageMutex.runExclusive(async () => {
      try {
        const store = await loadCache();
        store.data[key] = value;
        await queueSave();
      } catch (err: unknown) {
        if (isQuotaExceededError(err)) {
          notifyQuotaExceeded(err);
          if (!(err instanceof QuotaExceededError)) {
            throw new QuotaExceededError('Không thể ghi dữ liệu do đầy bộ nhớ (QuotaExceededError)', err);
          }
        }
        throw err;
      }
    });
  },

  async removeItem(key: string): Promise<void> {
    return storageMutex.runExclusive(async () => {
      try {
        const store = await loadCache();
        delete store.data[key];
        await queueSave();
      } catch (err: unknown) {
        if (isQuotaExceededError(err)) {
          notifyQuotaExceeded(err);
        }
        throw err;
      }
    });
  },

  async clear(): Promise<void> {
    return storageMutex.runExclusive(async () => {
      try {
        const store = await loadCache();
        store.data = {};
        await queueSave();
      } catch (err: unknown) {
        if (isQuotaExceededError(err)) {
          notifyQuotaExceeded(err);
        }
        throw err;
      }
    });
  },

  async getAllKeys(): Promise<string[]> {
    const store = await loadCache();
    return Object.keys(store.data);
  },

  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    const store = await loadCache();
    return keys.map(k => [k, store.data[k] ?? null]);
  },

  async multiSet(keyValuePairs: [string, string][]): Promise<void> {
    return storageMutex.runExclusive(async () => {
      try {
        const store = await loadCache();
        for (const [key, value] of keyValuePairs) {
          store.data[key] = value;
        }
        await queueSave();
      } catch (err: unknown) {
        if (isQuotaExceededError(err)) {
          notifyQuotaExceeded(err);
          if (!(err instanceof QuotaExceededError)) {
            throw new QuotaExceededError('Không thể ghi đồng thời các bản ghi do đầy bộ nhớ (QuotaExceededError)', err);
          }
        }
        throw err;
      }
    });
  },

  async multiRemove(keys: string[]): Promise<void> {
    return storageMutex.runExclusive(async () => {
      try {
        const store = await loadCache();
        for (const k of keys) {
          delete store.data[k];
        }
        await queueSave();
      } catch (err: unknown) {
        if (isQuotaExceededError(err)) {
          notifyQuotaExceeded(err);
        }
        throw err;
      }
    });
  },

  async flush(): Promise<void> {
    await storageMutex.runExclusive(async () => {
      await writeQueue;
    });
  },
};

export default Storage;
