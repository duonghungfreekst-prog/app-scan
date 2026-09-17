/**
 * fileHelper.ts — Utility lưu/di chuyển file an toàn cho toàn app
 *
 * Root cause của lỗi lưu file:
 * 1. (FileSystem as any).documentDirectory sai — documentDirectory là named export,
 *    không phải property của object. Phải import trực tiếp: { documentDirectory }
 * 2. moveAsync giữa cache → documentDirectory có thể lỗi trên Android (khác partition).
 *    Phải dùng copyAsync + deleteAsync thay thế.
 */

import * as FileSystem from 'expo-file-system/legacy';

/**
 * Trả về đường dẫn thư mục document của app (luôn kết thúc bằng /).
 * Đây là cách đúng để lấy documentDirectory — import trực tiếp từ named export.
 */
export function getDocumentDirectory(): string {
  // documentDirectory là named export — import trực tiếp
  const fs = FileSystem as any;
  const dir = fs.documentDirectory ?? fs.cacheDirectory ?? '';
  return dir;
}

/**
 * Di chuyển file an toàn: copy sang đích rồi xóa nguồn.
 * Thay thế moveAsync để tránh lỗi cross-partition trên Android.
 */
export async function safeMoveFile(from: string, to: string): Promise<void> {
  await FileSystem.copyAsync({ from, to });
  try {
    await FileSystem.deleteAsync(from, { idempotent: true });
  } catch {
    // Không nghiêm trọng nếu xóa cache thất bại
  }
}

/**
 * Lưu file PDF từ Print.printToFileAsync vào documentDirectory.
 * Trả về URI đích đã lưu.
 */
export async function savePdfToDocuments(
  tempUri: string,
  safeName: string
): Promise<string> {
  const docDir = getDocumentDirectory();
  const targetUri = docDir + safeName + '.pdf';
  await safeMoveFile(tempUri, targetUri);
  return targetUri;
}

/**
 * Lưu dữ liệu base64 ra file trong documentDirectory.
 * Trả về URI đã lưu.
 */
export async function saveBase64ToDocuments(
  base64Data: string,
  fileName: string // ví dụ: 'MyDoc.docx'
): Promise<string> {
  const docDir = getDocumentDirectory();
  const targetUri = docDir + fileName;
  await FileSystem.writeAsStringAsync(targetUri, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return targetUri;
}

/**
 * Copy file từ ngoài vào documentDirectory (dùng cho import PDF/ảnh).
 * Trả về URI đích.
 */
export async function copyFileToDocuments(
  sourceUri: string,
  fileName: string
): Promise<string> {
  const docDir = getDocumentDirectory();
  const targetUri = docDir + fileName;
  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

/**
 * Đọc tất cả file trong documentDirectory theo đuôi mở rộng cho phép.
 */
export async function listDocumentFiles(
  extensions: string[] = ['.pdf', '.docx', '.xlsx']
): Promise<string[]> {
  const docDir = getDocumentDirectory();
  const all = await FileSystem.readDirectoryAsync(docDir);
  return all
    .filter(f => extensions.some(ext => f.endsWith(ext)) || !f.includes('.'))
    .sort((a, b) => b.localeCompare(a));
}
