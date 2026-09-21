/**
 * fileHelper.ts — Quản lý file an toàn chuẩn Production
 * - Tên file được sanitize tuyệt đối (chống path traversal, ký tự cấm, Windows reserved words)
 * - Tự động đánh số chống ghi đè (file.pdf -> file (1).pdf)
 * - Phân loại thư mục/tập tin bằng FileSystem.getInfoAsync (isDirectory)
 * - Mô hình DocumentItem chuẩn nghiệp vụ
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { PDFDocument } from 'pdf-lib';
import { DocumentItem } from '../types/domain';
import Storage from './storage';
import { STORAGE_KEYS } from '../constants/config';

export { DocumentItem };

/**
 * Nén ảnh xuống gần đúng dung lượng mục tiêu (KB) — hữu ích khi người dùng
 * gửi tài liệu qua email/Zalo có giới hạn dung lượng đính kèm.
 * Thuật toán: giảm dần chất lượng JPEG rồi giảm dần chiều rộng, kiểm tra dung
 * lượng thật sau mỗi bước. Tối đa 6 vòng lặp, tự động dọn dẹp các file ảnh tạm
 * trung gian để chống rò rỉ dung lượng cache.
 */
export async function compressImageToTargetSize(
  uri: string,
  targetKB: number,
  startWidth: number = 1600
): Promise<string> {
  let quality = 0.85;
  let width = startWidth;
  let bestUri = uri;
  const tempUrisCreated: string[] = [];

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width } }],
        { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: false }
      );
      if (result.uri !== uri) {
        tempUrisCreated.push(result.uri);
      }
      bestUri = result.uri;

      const info = await FileSystem.getInfoAsync(result.uri);
      const sizeKB = info.exists && info.size ? info.size / 1024 : Infinity;
      if (sizeKB <= targetKB) {
        // Dọn dẹp các file tạm trung gian trừ kết quả tốt nhất
        for (const tUri of tempUrisCreated) {
          if (tUri !== result.uri) {
            FileSystem.deleteAsync(tUri, { idempotent: true }).catch(() => {});
          }
        }
        return result.uri;
      }

      // Giảm chất lượng trước, giảm chiều rộng sau
      if (quality > 0.4) {
        quality = Math.max(0.4, quality - 0.15);
      } else {
        width = Math.max(600, Math.round(width * 0.8));
      }
    } catch (e) {
      console.warn('[FileHelper] compressImageToTargetSize error:', e);
      for (const tUri of tempUrisCreated) {
        if (tUri !== bestUri) {
          FileSystem.deleteAsync(tUri, { idempotent: true }).catch(() => {});
        }
      }
      return bestUri;
    }
  }

  for (const tUri of tempUrisCreated) {
    if (tUri !== bestUri) {
      FileSystem.deleteAsync(tUri, { idempotent: true }).catch(() => {});
    }
  }
  return bestUri;
}

// Danh sách các tên tập tin cấm trên hệ điều hành Windows
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Chuẩn hóa tên file tuyệt đối an toàn:
 * - Chuẩn hóa NFC bảo toàn tiếng Việt Unicode tổ hợp (NFD)
 * - Loại bỏ ký tự cấm: / \ : * ? " < > | và mã điều khiển
 * - Loại bỏ path traversal: '..'
 * - Xóa khoảng trắng thừa và dấu chấm ở cuối (Windows không cho phép)
 * - Xử lý tên cấm Windows (CON, PRN, AUX, NUL...)
 * - Giữ trọn vẹn chữ cái tiếng Việt có dấu Unicode
 * - Giới hạn độ dài tối đa 120 ký tự
 */
export function sanitizeFileName(rawName: string, fallbackBase: string = 'TaiLieu'): string {
  if (!rawName) return `${fallbackBase}_${Date.now()}`;

  // 0. Chuẩn hóa NFC chống lỗi bàn phím tiếng Việt tổ hợp (NFD) trên iOS/macOS
  let clean = rawName.normalize('NFC').replace(/\.{2,}/g, '.');

  // 2. Sử dụng Unicode Property Escape để bảo toàn 100% chữ tiếng Việt có dấu (\p{L}), số (\p{N}), gạch dưới, gạch ngang, khoảng trắng
  clean = clean.replace(/[^\p{L}\p{N}_\-\s]/gu, '_');

  // 3. Chuẩn hóa khoảng trắng và dấu chấm ở đầu/cuối
  clean = clean.replace(/\s+/g, ' ').trim();
  clean = clean.replace(/^\.+/, '').replace(/\.+$/, ''); // Xóa dấu chấm ở đầu và cuối tên

  // 4. Giới hạn độ dài tối đa 120 ký tự
  if (clean.length > 120) {
    clean = clean.substring(0, 120).trim();
  }

  // 5. Kiểm tra nếu rỗng sau khi lọc
  if (!clean) {
    clean = `${fallbackBase}_${Date.now()}`;
  }

  // 6. Kiểm tra Windows Reserved Names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const upper = clean.toUpperCase();
  const baseWithoutExt = upper.split('.')[0];
  if (WINDOWS_RESERVED_NAMES.has(baseWithoutExt)) {
    clean = `${clean}_doc`;
  }

  return clean;
}

/**
 * Trả về thư mục Document lưu trữ vĩnh viễn của app.
 * Ném lỗi rõ ràng nếu môi trường không cung cấp, tuyệt đối KHÔNG fallback sang cache.
 */
export function getDocumentDirectory(): string {
  const dir = FileSystem.documentDirectory;
  if (!dir) {
    throw new Error('Lỗi lưu trữ: Thư mục DocumentDirectory không khả dụng trên thiết bị này.');
  }
  return dir.endsWith('/') ? dir : dir + '/';
}

/**
 * Di chuyển file an toàn: copy sang đích rồi xóa nguồn.
 * Tránh lỗi cross-partition trên Android OS.
 */
export async function safeMoveFile(from: string, to: string): Promise<void> {
  await FileSystem.copyAsync({ from, to });
  try {
    await FileSystem.deleteAsync(from, { idempotent: true });
  } catch (e) {
    console.warn('[FileHelper] Warning deleting temporary source file:', e);
  }
}

/**
 * Tìm tên file duy nhất chưa bị trùng trong thư mục (vd: file.pdf -> file_1.pdf)
 */
export async function getUniqueFilePath(dir: string, baseName: string, ext: string): Promise<string> {
  const cleanBase = sanitizeFileName(baseName, 'TaiLieu');
  const formattedExt = ext ? (ext.startsWith('.') ? ext : `.${ext}`) : '';
  
  let targetUri = `${dir}${cleanBase}${formattedExt}`;
  let counter = 1;

  while (true) {
    const info = await FileSystem.getInfoAsync(targetUri);
    if (!info.exists) {
      return targetUri;
    }
    targetUri = `${dir}${cleanBase}_${counter}${formattedExt}`;
    counter++;
  }
}

/**
 * Tính mã băm SHA-256 (checksum) cho một chuỗi dữ liệu (Base64 hoặc text)
 */
export async function calculateSha256(data: string): Promise<string> {
  try {
    if (Crypto && Crypto.digestStringAsync) {
      return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data);
    }
  } catch (e) {
    // Fallback nếu expo-crypto native bridge không khả dụng trong môi trường hiện tại
  }

  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', dataBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}

  try {
    const nodeCrypto = require('crypto');
    if (nodeCrypto && nodeCrypto.createHash) {
      return nodeCrypto.createHash('sha256').update(data).digest('hex');
    }
  } catch {}

  return '';
}

/**
 * Tạo đối tượng DocumentItem hoàn chỉnh với đầy đủ metadata:
 * fileSize (kích thước file), pageCount (số trang nếu có), và checksum (mã băm SHA-256).
 */
export async function createDocumentItem(
  fileUri: string,
  rawName?: string,
  isDirectory?: boolean,
  ocrText?: string,
  loadFullMetadata: boolean = false
): Promise<DocumentItem> {
  const fileName = rawName || fileUri.split('/').pop() || 'Document';
  const lastDot = fileName.lastIndexOf('.');
  const ext = lastDot !== -1 ? fileName.substring(lastDot).toLowerCase() : '';

  let infoSize = 0;
  let modTime = Date.now();
  let isDir = isDirectory;

  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists) {
      infoSize = info.size ?? 0;
      modTime = (info as any).modificationTime ?? Date.now();
      if (isDir === undefined) {
        isDir = !!info.isDirectory;
      }
    }
  } catch (e) {
    console.warn(`[FileHelper] Error reading file info for ${fileUri}:`, e);
  }

  let checksum: string | undefined = undefined;
  let pageCount: number | undefined = undefined;

  // CHỐNG TRÀN BỘ NHỚ (OOM): Chỉ đọc Base64 và parse PDF khi loadFullMetadata = true (ví dụ khi lưu tài liệu đơn lẻ)
  // Tuyệt đối KHÔNG đọc toàn bộ Base64 khi liệt kê danh sách tệp trong listDocumentItems
  if (!isDir && loadFullMetadata) {
    try {
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (base64) {
        checksum = await calculateSha256(base64);

        if (ext === '.pdf') {
          try {
            const pdfDoc = await PDFDocument.load(base64, { ignoreEncryption: true });
            pageCount = pdfDoc.getPageCount();
          } catch (pdfErr) {
            console.warn(`[FileHelper] Error parsing PDF page count for ${fileName}:`, pdfErr);
          }
        }
      }
    } catch (readErr) {
      console.warn(`[FileHelper] Error reading content for metadata calculation of ${fileName}:`, readErr);
    }
  }

  const docItem: DocumentItem = {
    id: fileUri,
    name: fileName,
    uri: fileUri,
    isDirectory: !!isDir,
    size: infoSize,
    modificationTime: modTime,
    extension: ext,
    ocrText,
    fileSize: infoSize,
    pageCount,
    checksum,
  };

  return docItem;
}

/**
 * Lưu file PDF từ Print.printToFileAsync vào documentDirectory (tự động chống ghi đè).
 * Tự động tính toán và gán: fileSize (kích thước file), pageCount (số trang nếu có), và checksum (mã băm SHA-256).
 * Trả về DocumentItem hoàn chỉnh với đầy đủ metadata mới (tương thích cả string URI).
 */
export async function savePdfToDocuments(
  tempUri: string,
  rawName: string,
  subDir: string = ''
): Promise<DocumentItem & string> {
  const root = getDocumentDirectory();
  const dir = subDir ? `${root}${subDir}/` : root;
  
  // Đảm bảo thư mục đích tồn tại
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const baseName = rawName.replace(/\.pdf$/i, '');
  const targetUri = await getUniqueFilePath(dir, baseName, '.pdf');
  await safeMoveFile(tempUri, targetUri);

  const docItem = await createDocumentItem(targetUri, targetUri.split('/').pop() || `${baseName}.pdf`, false, undefined, true);
  const result = Object.assign(new String(targetUri), docItem) as unknown as DocumentItem & string;
  return result;
}

/**
 * Lưu dữ liệu base64 ra file trong documentDirectory (tự động chống ghi đè).
 */
export async function saveBase64ToDocuments(
  base64Data: string,
  fileName: string,
  subDir: string = ''
): Promise<string> {
  const root = getDocumentDirectory();
  const dir = subDir ? `${root}${subDir}/` : root;

  // Đảm bảo thư mục đích tồn tại
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const lastDot = fileName.lastIndexOf('.');
  const baseName = lastDot !== -1 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot !== -1 ? fileName.substring(lastDot) : '';

  const targetUri = await getUniqueFilePath(dir, baseName, ext);
  await FileSystem.writeAsStringAsync(targetUri, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return targetUri;
}

/**
 * Copy file từ ngoài vào documentDirectory an toàn (tự động chống ghi đè).
 */
export async function copyFileToDocuments(
  sourceUri: string,
  fileName: string,
  subDir: string = ''
): Promise<string> {
  const root = getDocumentDirectory();
  const dir = subDir ? `${root}${subDir}/` : root;

  // Đảm bảo thư mục đích tồn tại
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const lastDot = fileName.lastIndexOf('.');
  const baseName = lastDot !== -1 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot !== -1 ? fileName.substring(lastDot) : '';

  const targetUri = await getUniqueFilePath(dir, baseName, ext);
  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

export const DEFAULT_SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.jpg', '.jpeg', '.png', '.txt'];

/**
 * Lấy toàn bộ bộ chỉ mục OCR Metadata phục vụ tìm kiếm toàn văn (Full-Text Search)
 */
export async function getAllOcrIndex(): Promise<Record<string, string>> {
  try {
    const raw = await Storage.getItem(STORAGE_KEYS.OCR_METADATA_INDEX);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Lưu chuỗi OCR nhận dạng được gắn với tài liệu (dùng tên file làm định danh)
 */
export async function saveDocumentOcrText(fileUriOrName: string, ocrText: string): Promise<void> {
  try {
    const index = await getAllOcrIndex();
    const key = fileUriOrName.split('/').pop() || fileUriOrName;
    index[key] = ocrText.trim();
    await Storage.setItem(STORAGE_KEYS.OCR_METADATA_INDEX, JSON.stringify(index));
  } catch (e) {
    console.warn('[FileHelper] Error saving OCR metadata:', e);
  }
}

/**
 * Lấy OCR text của một file
 */
export async function getDocumentOcrText(fileUriOrName: string): Promise<string | null> {
  try {
    const index = await getAllOcrIndex();
    const key = fileUriOrName.split('/').pop() || fileUriOrName;
    return index[key] || null;
  } catch {
    return null;
  }
}

/**
 * Xóa OCR metadata khi file bị xóa
 */
export async function removeDocumentOcrText(fileUriOrName: string): Promise<void> {
  try {
    const index = await getAllOcrIndex();
    const key = fileUriOrName.split('/').pop() || fileUriOrName;
    if (index[key]) {
      delete index[key];
      await Storage.setItem(STORAGE_KEYS.OCR_METADATA_INDEX, JSON.stringify(index));
    }
  } catch (e) {
    console.warn('[FileHelper] Error removing OCR metadata:', e);
  }
}

/**
 * Cập nhật tên key OCR khi file được đổi tên
 */
export async function renameDocumentOcrText(oldName: string, newName: string): Promise<void> {
  try {
    const index = await getAllOcrIndex();
    const oldKey = oldName.split('/').pop() || oldName;
    const newKey = newName.split('/').pop() || newName;
    if (index[oldKey]) {
      index[newKey] = index[oldKey];
      delete index[oldKey];
      await Storage.setItem(STORAGE_KEYS.OCR_METADATA_INDEX, JSON.stringify(index));
    }
  } catch (e) {
    console.warn('[FileHelper] Error renaming OCR metadata:', e);
  }
}

/**
 * Đọc toàn bộ danh sách tập tin và thư mục kèm metadata chi tiết
 */
export async function listDocumentItems(
  subDir: string = '',
  supportedExts: string[] = DEFAULT_SUPPORTED_EXTENSIONS
): Promise<DocumentItem[]> {
  try {
    const root = getDocumentDirectory();
    const targetDir = subDir ? `${root}${subDir}/` : root;

    const dirInfo = await FileSystem.getInfoAsync(targetDir);
    if (!dirInfo.exists) {
      return [];
    }

    const ocrIndex = await getAllOcrIndex();
    const fileNames = await FileSystem.readDirectoryAsync(targetDir);
    const items: DocumentItem[] = [];

    for (const name of fileNames) {
      if (name.startsWith('.')) continue; // Bỏ qua file ẩn

      const fileUri = `${targetDir}${name}`;
      try {
        const info = await FileSystem.getInfoAsync(fileUri);
        if (!info.exists) continue;

        const isDirectory = !!info.isDirectory;
        const lastDot = name.lastIndexOf('.');
        const ext = lastDot !== -1 ? name.substring(lastDot).toLowerCase() : '';

        // Nếu là thư mục hoặc là file thuộc extension được hỗ trợ
        if (isDirectory || supportedExts.includes(ext) || supportedExts.length === 0) {
          const item = await createDocumentItem(
            fileUri,
            name,
            isDirectory,
            ocrIndex[name] || undefined
          );
          items.push(item);
        }
      } catch (e) {
        console.warn(`[FileHelper] Error getting info for ${name}:`, e);
      }
    }

    // Sắp xếp: Thư mục lên trước, sau đó sắp xếp theo thời gian sửa đổi mới nhất
    return items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return b.modificationTime - a.modificationTime;
    });
  } catch (error) {
    console.error('[FileHelper] Error listing document items:', error);
    return [];
  }
}

/**
 * Hàm tương thích ngược với code cũ: trả về mảng string tên file
 */
export async function listDocumentFiles(
  extensions: string[] = DEFAULT_SUPPORTED_EXTENSIONS
): Promise<string[]> {
  const items = await listDocumentItems('', extensions);
  return items.map(item => item.name);
}

/**
 * Xóa toàn bộ file ảnh tạm .jpg / .jpeg trong cacheDirectory do ImageManipulator sinh ra.
 */
export async function cleanupTempCache(): Promise<number> {
  let deletedCount = 0;
  try {
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) return 0;

    const cacheInfo = await FileSystem.getInfoAsync(cacheDir);
    if (!cacheInfo.exists) return 0;

    const entries = await FileSystem.readDirectoryAsync(cacheDir);
    for (const entry of entries) {
      const entryUri = `${cacheDir}${entry}`;
      try {
        const info = await FileSystem.getInfoAsync(entryUri);
        if (!info.exists) continue;

        if (info.isDirectory) {
          // ImageManipulator có thể lưu ảnh trong thư mục con "ImageManipulator"
          if (entry.toLowerCase() === 'imagemanipulator') {
            try {
              const subEntries = await FileSystem.readDirectoryAsync(entryUri);
              for (const sub of subEntries) {
                if (/\.(jpe?g)$/i.test(sub)) {
                  await FileSystem.deleteAsync(`${entryUri}/${sub}`, { idempotent: true });
                  deletedCount++;
                }
              }
              await FileSystem.deleteAsync(entryUri, { idempotent: true });
            } catch (subErr) {
              console.warn(`[FileHelper] Lỗi khi dọn thư mục con ${entry}:`, subErr);
            }
          }
        } else if (/\.(jpe?g)$/i.test(entry)) {
          // Xóa file ảnh tạm .jpg/.jpeg ở root của cacheDirectory
          await FileSystem.deleteAsync(entryUri, { idempotent: true });
          deletedCount++;
        }
      } catch (entryErr) {
        console.warn(`[FileHelper] Lỗi khi xử lý mục cache ${entry}:`, entryErr);
      }
    }
  } catch (error) {
    console.warn('[FileHelper] Lỗi trong quá trình cleanupTempCache:', error);
  }
  return deletedCount;
}

/**
 * Đo tổng dung lượng (bytes) của một thư mục (tính đệ quy tất cả tập tin bên trong).
 */
export async function getDirectorySize(dirUri: string): Promise<number> {
  try {
    if (!dirUri) return 0;
    const formattedDir = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
    const dirInfo = await FileSystem.getInfoAsync(formattedDir);

    if (!dirInfo.exists) {
      return 0;
    }

    // Nếu đường dẫn trỏ tới một tập tin đơn lẻ thay vì thư mục
    if (!dirInfo.isDirectory) {
      return dirInfo.size ?? 0;
    }

    let totalSize = 0;
    const entries = await FileSystem.readDirectoryAsync(formattedDir);

    for (const entry of entries) {
      const entryUri = `${formattedDir}${entry}`;
      try {
        const info = await FileSystem.getInfoAsync(entryUri);
        if (!info.exists) continue;

        if (info.isDirectory) {
          totalSize += await getDirectorySize(entryUri);
        } else {
          totalSize += info.size ?? 0;
        }
      } catch (entryErr) {
        console.warn(`[FileHelper] Lỗi khi đọc kích thước của ${entryUri}:`, entryErr);
      }
    }

    return totalSize;
  } catch (error) {
    console.warn(`[FileHelper] Lỗi khi tính dung lượng thư mục ${dirUri}:`, error);
    return 0;
  }
}

