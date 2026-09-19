/**
 * backup.service.ts — Dịch vụ sao lưu & khôi phục toàn bộ dữ liệu (Full App Backup & Restore)
 * - Xuất toàn bộ cấu hình, OCR index, draft session thành file JSON chuẩn hóa
 * - Khôi phục an toàn với xác thực tính toàn vẹn của dữ liệu
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Storage from '../../utils/storage';
import { STORAGE_KEYS } from '../../constants/config';
import { getAllOcrIndex } from '../../utils/fileHelper';

export interface AppBackupData {
  appName: string;
  appVersion: string;
  exportDate: string;
  timestamp: number;
  storageData: Record<string, string>;
  ocrIndex: Record<string, string>;
}

export class BackupService {
  /**
   * Tạo tệp JSON sao lưu toàn bộ dữ liệu ứng dụng và mở bảng chia sẻ
   */
  public static async createAndShareBackup(): Promise<string> {
    try {
      const storageKeys = [
        STORAGE_KEYS.SCAN_QUALITY,
        STORAGE_KEYS.COLOR_MODE,
        STORAGE_KEYS.SAVE_ORIGINAL,
        STORAGE_KEYS.APP_THEME,
        STORAGE_KEYS.GOOGLE_CLIENT_ID_ANDROID,
        STORAGE_KEYS.GOOGLE_CLIENT_ID_WEB,
        STORAGE_KEYS.DRAFT_SCAN_SESSION,
      ];

      const storageData: Record<string, string> = {};
      for (const key of storageKeys) {
        const val = await Storage.getItem(key);
        if (val !== null && val !== undefined) {
          storageData[key] = val;
        }
      }

      const ocrIndex = await getAllOcrIndex();

      const backupPayload: AppBackupData = {
        appName: 'CamScanner Pro',
        appVersion: '2.6.2',
        exportDate: new Date().toISOString(),
        timestamp: Date.now(),
        storageData,
        ocrIndex,
      };

      const jsonStr = JSON.stringify(backupPayload, null, 2);
      const backupFileName = `CamScanner_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      const tempPath = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}${backupFileName}`;

      await FileSystem.writeAsStringAsync(tempPath, jsonStr, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(tempPath, {
          mimeType: 'application/json',
          dialogTitle: 'Sao lưu dữ liệu ứng dụng CamScanner',
          UTI: 'public.json',
        });
      }

      return tempPath;
    } catch (error: any) {
      console.error('[BackupService] createAndShareBackup error:', error);
      throw new Error(`Lỗi tạo bản sao lưu: ${error.message || String(error)}`);
    }
  }

  /**
   * Khôi phục toàn bộ cấu hình từ chuỗi JSON sao lưu
   */
  public static async restoreFromJson(jsonContent: string): Promise<{ success: boolean; restoredCount: number }> {
    try {
      const parsed: AppBackupData = JSON.parse(jsonContent);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Định dạng tệp sao lưu không hợp lệ.');
      }

      let restoredCount = 0;

      // 1. Khôi phục các giá trị Storage
      if (parsed.storageData && typeof parsed.storageData === 'object') {
        for (const [key, val] of Object.entries(parsed.storageData)) {
          if (typeof val === 'string') {
            await Storage.setItem(key, val);
            restoredCount++;
          }
        }
      }

      // 2. Khôi phục OCR Index
      if (parsed.ocrIndex && typeof parsed.ocrIndex === 'object') {
        const existingOcr = await getAllOcrIndex();
        const mergedOcr = { ...existingOcr, ...parsed.ocrIndex };
        await Storage.setItem(STORAGE_KEYS.OCR_METADATA_INDEX, JSON.stringify(mergedOcr));
        restoredCount += Object.keys(parsed.ocrIndex).length;
      }

      return { success: true, restoredCount };
    } catch (error: any) {
      console.error('[BackupService] restoreFromJson error:', error);
      throw new Error(`Không thể khôi phục dữ liệu: ${error.message || String(error)}`);
    }
  }
}

export default BackupService;
