/**
 * secureStorage.ts — Quản lý lưu trữ an toàn sử dụng Android Keystore / iOS Keychain
 * Bảo vệ API Key, Secret Token, tránh lưu trữ dạng Plaintext JSON trên thiết bị.
 * Hỗ trợ fallback mã hóa AES-GCM cho môi trường Web.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { Storage } from '../../utils/storage';

export const SECURE_STORAGE_ERRORS = {
  READ: 'ERR_SECURE_STORAGE_READ',
  WRITE: 'ERR_SECURE_STORAGE_WRITE',
  DELETE: 'ERR_SECURE_STORAGE_DELETE',
} as const;

/**
 * So sánh hai chuỗi ký tự theo thời gian hằng số (Constant-time comparison)
 * Ngăn chặn tấn công dò kênh phụ qua thời gian thực thi (Timing Attacks).
 * Tuân thủ Phần 3.6 Workspace Rules.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const lenA = a.length;
  const lenB = b.length;
  let mismatch = lenA ^ lenB;
  const maxLen = Math.max(lenA, lenB);

  for (let i = 0; i < maxLen; i++) {
    const codeA = i < lenA ? a.charCodeAt(i) : 0;
    const codeB = i < lenB ? b.charCodeAt(i) : 0;
    mismatch |= codeA ^ codeB;
  }

  return mismatch === 0;
}

// ----------------------------------------------------
// WEB ENCRYPTION HELPERS (FALLBACK MÃ HÓA CHO WEB)
// ----------------------------------------------------
const WEB_ENC_PREFIX = '__cs_enc_v1__:';
const WEB_DEVICE_KEY_STORAGE = '__cs_web_sec_device_key__';

interface WebEncryptedPayload {
  alg: 'AES-GCM' | 'STREAM';
  iv: string;
  ct: string;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function getRandomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < count; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

let cachedDeviceEntropy: string | null = null;

function getOrCreateDeviceEntropy(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = window.localStorage.getItem(WEB_DEVICE_KEY_STORAGE);
      if (existing && existing.length === 64) {
        return existing;
      }
    }
  } catch {}

  if (cachedDeviceEntropy && cachedDeviceEntropy.length === 64) {
    return cachedDeviceEntropy;
  }

  const newEntropy = bytesToHex(getRandomBytes(32));
  cachedDeviceEntropy = newEntropy;

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(WEB_DEVICE_KEY_STORAGE, newEntropy);
    }
  } catch {}

  return newEntropy;
}

let cachedAesKey: any = null;

async function getAesKey(): Promise<any> {
  if (cachedAesKey) return cachedAesKey;
  const entropy = getOrCreateDeviceEntropy();
  const rawKeyMaterial = new TextEncoder().encode(`CamScanner_WebSec_v1:${entropy}`);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', rawKeyMaterial);
  cachedAesKey = await globalThis.crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  return cachedAesKey;
}

/**
 * Fallback stream cipher khi Web Crypto API (crypto.subtle) không khả dụng
 */
function streamCipher(data: Uint8Array, keyBytes: Uint8Array, ivBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  let s = 0x811c9dc5;
  for (let i = 0; i < keyBytes.length; i++) {
    s = Math.imul(s ^ keyBytes[i], 0x01000193);
  }
  for (let i = 0; i < ivBytes.length; i++) {
    s = Math.imul(s ^ ivBytes[i], 0x01000193);
  }
  for (let i = 0; i < data.length; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = data[i] ^ ((t ^ (t >>> 14)) & 0xff);
  }
  return out;
}

async function encryptForWeb(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const key = await getAesKey();
    const iv = getRandomBytes(12);
    const ctBuffer = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      data
    );
    const payload: WebEncryptedPayload = {
      alg: 'AES-GCM',
      iv: bytesToHex(iv),
      ct: bytesToHex(new Uint8Array(ctBuffer)),
    };
    return JSON.stringify(payload);
  }

  // Fallback khi không có crypto.subtle (môi trường HTTP không bảo mật)
  const entropy = getOrCreateDeviceEntropy();
  const keyBytes = hexToBytes(entropy);
  const iv = getRandomBytes(16);
  const ct = streamCipher(data, keyBytes, iv);
  const payload: WebEncryptedPayload = {
    alg: 'STREAM',
    iv: bytesToHex(iv),
    ct: bytesToHex(ct),
  };
  return JSON.stringify(payload);
}

async function decryptForWeb(ciphertext: string): Promise<string> {
  const rawPayload = ciphertext.startsWith(WEB_ENC_PREFIX)
    ? ciphertext.slice(WEB_ENC_PREFIX.length)
    : ciphertext;

  let payload: WebEncryptedPayload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    // Không thể parse JSON: coi như legacy plaintext
    return ciphertext;
  }

  if (!payload.iv || !payload.ct || !payload.alg) {
    return ciphertext;
  }

  const iv = hexToBytes(payload.iv);
  const ct = hexToBytes(payload.ct);

  if (payload.alg === 'AES-GCM' && typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const key = await getAesKey();
    const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource
    );
    return new TextDecoder().decode(decryptedBuffer);
  }

  const entropy = getOrCreateDeviceEntropy();
  const keyBytes = hexToBytes(entropy);
  const decrypted = streamCipher(ct, keyBytes, iv);
  return new TextDecoder().decode(decrypted);
}

// ----------------------------------------------------
// SECURE STORAGE INTERFACE
// ----------------------------------------------------
export const SecureStorage = {
  constantTimeEqual,

  /**
   * Lưu secret key an toàn (Hardware Keystore trên Native, AES-GCM trên Web)
   */
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        const encrypted = await encryptForWeb(value);
        await Storage.setItem(key, WEB_ENC_PREFIX + encrypted);
        return;
      }
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {
      console.error(`[SecureStore] ${SECURE_STORAGE_ERRORS.WRITE}`);
      if (Platform.OS === 'web') {
        try {
          const encrypted = await encryptForWeb(value);
          await Storage.setItem(key, WEB_ENC_PREFIX + encrypted);
          return;
        } catch {
          console.error(`[SecureStore] ${SECURE_STORAGE_ERRORS.WRITE}`);
        }
      }
      throw new Error(`${SECURE_STORAGE_ERRORS.WRITE}: Không thể ghi dữ liệu an toàn vào Hardware Keystore/Keychain của thiết bị.`);
    }
  },

  /**
   * Đọc secret key an toàn
   */
  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        const storedVal = await Storage.getItem(key);
        if (storedVal === null) return null;
        if (storedVal.startsWith(WEB_ENC_PREFIX)) {
          return await decryptForWeb(storedVal);
        }
        // Migration fallback cho web: Tự động mã hóa plaintext cũ
        try {
          const encrypted = await encryptForWeb(storedVal);
          await Storage.setItem(key, WEB_ENC_PREFIX + encrypted);
        } catch {}
        return storedVal;
      }

      const val = await SecureStore.getItemAsync(key);
      if (val !== null) return val;

      // Migration fallback: Nếu trong SecureStore chưa có nhưng bản cũ lưu trong JSON Storage
      const legacyVal = await Storage.getItem(key);
      if (legacyVal) {
        // Tự động migrate sang SecureStore và xóa ở legacy storage
        try {
          await this.setItem(key, legacyVal);
          await Storage.removeItem(key);
        } catch {
          // Bỏ qua lỗi migrate nếu Keystore tạm thời khóa
        }
        return legacyVal;
      }
      return null;
    } catch {
      console.error(`[SecureStore] ${SECURE_STORAGE_ERRORS.READ}`);
      if (Platform.OS === 'web') {
        try {
          const storedVal = await Storage.getItem(key);
          if (storedVal === null) return null;
          if (storedVal.startsWith(WEB_ENC_PREFIX)) {
            return await decryptForWeb(storedVal);
          }
          return storedVal;
        } catch {
          console.error(`[SecureStore] ${SECURE_STORAGE_ERRORS.READ}`);
        }
      }
      return null;
    }
  },

  /**
   * Xóa secret key an toàn
   */
  async removeItem(key: string): Promise<void> {
    try {
      if (Platform.OS !== 'web') {
        await SecureStore.deleteItemAsync(key);
      }
    } catch {
      console.error(`[SecureStore] ${SECURE_STORAGE_ERRORS.DELETE}`);
    }

    // Xóa cả ở legacy storage phòng hờ
    try {
      await Storage.removeItem(key);
    } catch {
      console.error(`[SecureStore] ${SECURE_STORAGE_ERRORS.DELETE}`);
    }
  },
};

export default SecureStorage;
