import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Linking, Dimensions, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../theme';

import Storage from '../utils/storage';

// Thông tin cấu hình GitHub Repository của bạn
const GITHUB_USERNAME = 'duonghungfreekst-prog';
const GITHUB_REPO = 'app-scan';
const LAST_CHECK_KEY = '@camscanner_last_update_check_ts';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Kiểm tra tối đa 1 lần mỗi giờ

const { width } = Dimensions.get('window');

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export function parseSemVer(v: string): SemVer {
  const clean = (v || '').trim().replace(/^v/i, '');
  const [mainPart, prePart] = clean.split('-');
  const [buildClean] = (prePart || '').split('+');
  const [major = 0, minor = 0, patch = 0] = mainPart.split('.').map(num => parseInt(num, 10) || 0);

  return {
    major,
    minor,
    patch,
    prerelease: buildClean || undefined,
  };
}

export function compareSemVer(v1: string, v2: string): number {
  const sem1 = parseSemVer(v1);
  const sem2 = parseSemVer(v2);

  if (sem1.major !== sem2.major) return sem1.major > sem2.major ? 1 : -1;
  if (sem1.minor !== sem2.minor) return sem1.minor > sem2.minor ? 1 : -1;
  if (sem1.patch !== sem2.patch) return sem1.patch > sem2.patch ? 1 : -1;

  // Bản chính thức (không có prerelease) lớn hơn bản prerelease
  if (!sem1.prerelease && sem2.prerelease) return 1;
  if (sem1.prerelease && !sem2.prerelease) return -1;
  if (sem1.prerelease && sem2.prerelease) {
    return sem1.prerelease.localeCompare(sem2.prerelease);
  }

  return 0;
}

/**
 * Kiểm tra xem chuỗi có phải mã băm SHA-256 hợp lệ (64 ký tự hexa)
 */
export function isValidSha256(hash: string | null | undefined): boolean {
  if (!hash || typeof hash !== 'string') return false;
  return /^[a-fA-F0-9]{64}$/.test(hash.trim());
}

/**
 * Trích xuất mã băm SHA-256 từ nội dung văn bản (file .sha256, checksums.txt, SHA256SUMS hoặc release body)
 */
export function parseSha256Checksum(rawText: string, targetFileName?: string): string | null {
  if (!rawText || typeof rawText !== 'string') return null;

  const lines = rawText.split(/\r?\n/);

  // 1. Nếu có tên file cụ thể (vd: app-release.apk), tìm dòng chứa file đó trước
  if (targetFileName) {
    const cleanTarget = targetFileName.trim().toLowerCase();
    for (const line of lines) {
      if (line.toLowerCase().includes(cleanTarget)) {
        const match = line.match(/\b([a-fA-F0-9]{64})\b/);
        if (match && isValidSha256(match[1])) {
          return match[1].toLowerCase();
        }
      }
    }
  }

  // 2. Định dạng BSD: SHA256 (filename) = hash
  const bsdMatch = rawText.match(/SHA256\s*\([^)]+\)\s*=\s*([a-fA-F0-9]{64})/i);
  if (bsdMatch && isValidSha256(bsdMatch[1])) {
    return bsdMatch[1].toLowerCase();
  }

  // 3. Định dạng nhãn: SHA-256: hash hoặc sha256: hash
  const labelMatch = rawText.match(/sha-?256[\s:=`*]+([a-fA-F0-9]{64})/i);
  if (labelMatch && isValidSha256(labelMatch[1])) {
    return labelMatch[1].toLowerCase();
  }

  // 4. Dòng bắt đầu bằng 64 ký tự hex (chuẩn sha256sum: <hash>  <filename>)
  for (const line of lines) {
    const trimmed = line.trim();
    const tokenMatch = trimmed.match(/^([a-fA-F0-9]{64})\b/);
    if (tokenMatch && isValidSha256(tokenMatch[1])) {
      return tokenMatch[1].toLowerCase();
    }
  }

  // 5. Nội dung thuần chỉ là 1 mã băm 64 ký tự
  const singleMatch = rawText.trim().match(/^([a-fA-F0-9]{64})$/);
  if (singleMatch && isValidSha256(singleMatch[1])) {
    return singleMatch[1].toLowerCase();
  }

  return null;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  [key: string]: any;
}

/**
 * Tìm asset chứa mã băm SHA-256 từ danh sách assets của release
 */
export function findSha256Asset(assets: ReleaseAsset[], targetFileName?: string): ReleaseAsset | null {
  if (!assets || !Array.isArray(assets) || assets.length === 0) return null;

  // 1. Ưu tiên file checksum đi kèm trực tiếp với targetFileName (vd: app.apk.sha256)
  if (targetFileName) {
    const cleanTarget = targetFileName.trim().toLowerCase();
    const directMatch = assets.find((a) => {
      const name = (a.name || '').toLowerCase();
      return (
        name === `${cleanTarget}.sha256` ||
        name === `${cleanTarget}.sha256sum` ||
        name === `${cleanTarget}.sha256sums`
      );
    });
    if (directMatch?.browser_download_url) return directMatch;
  }

  // 2. File có đuôi .sha256 hoặc .sha256sum
  const extMatch = assets.find((a) => {
    const name = (a.name || '').toLowerCase();
    return (
      name.endsWith('.sha256') ||
      name.endsWith('.sha256sum') ||
      name.endsWith('.sha256sums')
    );
  });
  if (extMatch?.browser_download_url) return extMatch;

  // 3. File danh sách checksum chuẩn
  const standardNameMatch = assets.find((a) => {
    const name = (a.name || '').toLowerCase();
    return (
      name === 'sha256sums.txt' ||
      name === 'sha256sums' ||
      name === 'checksums.txt' ||
      name === 'sha256.txt'
    );
  });
  if (standardNameMatch?.browser_download_url) return standardNameMatch;

  // 4. File có chứa chữ 'sha256' hoặc 'checksum'
  const fallbackMatch = assets.find((a) => {
    const name = (a.name || '').toLowerCase();
    return name.includes('sha256') || (name.includes('checksum') && !name.endsWith('.apk'));
  });
  if (fallbackMatch?.browser_download_url) return fallbackMatch;

  return null;
}

/**
 * Kiểm tra lỗi mạng an toàn khi kiểm tra release ngầm (offline, timeout, hủy request)
 */
export function isNetworkError(error: any): boolean {
  if (!error) return false;
  const msg = String(error?.message || error || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();

  return (
    name === 'aborterror' ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('abort') ||
    msg.includes('timeout') ||
    msg.includes('offline') ||
    msg.includes('networkerror') ||
    msg.includes('internet') ||
    msg.includes('connection') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('socket')
  );
}

export interface UpdateInfo {
  hasUpdate: boolean;
  newVersion: string;
  downloadUrl: string;
  releaseNotes: string;
  sha256?: string | null;
  apkFileName?: string;
  isIntegrityVerified?: boolean;
}

export default function UpdateChecker() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const { theme } = useTheme();
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    checkUpdate();
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleCopyHash = async () => {
    if (updateInfo?.sha256) {
      try {
        await Clipboard.setStringAsync(updateInfo.sha256);
        setCopiedHash(true);
        setTimeout(() => {
          if (isMounted.current) {
            setCopiedHash(false);
          }
        }, 2000);
      } catch {
        // Bỏ qua nếu không truy cập được clipboard
      }
    }
  };

  const checkUpdate = async () => {
    try {
      if ((GITHUB_USERNAME as string) === 'YOUR_GITHUB_USERNAME') return;

      // Rate limit check: tối đa 1 lần mỗi giờ để tránh cạn kiệt GitHub API rate limit
      const lastCheckStr = await Storage.getItem(LAST_CHECK_KEY);
      const lastCheck = lastCheckStr ? parseInt(lastCheckStr, 10) : 0;
      const now = Date.now();
      if (now - lastCheck < CHECK_INTERVAL_MS) {
        return; // Bỏ qua nếu vừa kiểm tra gần đây
      }

      const currentVersion = Constants.expoConfig?.version || '1.0.0';
      const apiUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/releases/latest`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      let data: any = null;
      try {
        const response = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Cache-Control': 'no-cache',
          },
          signal: controller.signal,
        });

        // Nếu mã trạng thái không thành công (403 rate limit, 404, 500...), thoát êm dịu không làm phiền người dùng
        if (!response.ok) return;

        data = await response.json();
      } catch (fetchErr) {
        // Xử lý lỗi mạng an toàn: bỏ qua lỗi timeout hoặc offline khi kiểm tra ngầm
        if (isNetworkError(fetchErr)) {
          return;
        }
        return;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!data || !data.tag_name) return;

      // Cập nhật timestamp lần kiểm tra thành công
      await Storage.setItem(LAST_CHECK_KEY, String(now));

      const latestVersion = data.tag_name; // Ví dụ: "v2.5.0"

      if (compareSemVer(latestVersion, currentVersion) > 0) {
        // Ưu tiên tìm file .apk trong assets, nếu không thì dẫn tới trang tải HTML
        let downloadUrl = data.html_url;
        let apkFileName: string | undefined = undefined;
        const assets: ReleaseAsset[] = Array.isArray(data.assets) ? data.assets : [];

        if (assets.length > 0) {
          const apkAsset = assets.find((a) => a.name && a.name.toLowerCase().endsWith('.apk'));
          if (apkAsset) {
            downloadUrl = apkAsset.browser_download_url;
            apkFileName = apkAsset.name;
          }
        }

        // Bổ sung kiểm tra tính toàn vẹn gói cập nhật: kiểm tra mã băm SHA-256 nếu có trong release assets
        let sha256Checksum: string | null = null;
        const checksumAsset = findSha256Asset(assets, apkFileName);

        if (checksumAsset?.browser_download_url) {
          const assetController = new AbortController();
          const assetTimeoutId = setTimeout(() => assetController.abort(), 5000);
          try {
            const assetRes = await fetch(checksumAsset.browser_download_url, {
              headers: { 'Cache-Control': 'no-cache' },
              signal: assetController.signal,
            });
            if (assetRes.ok) {
              const checksumText = await assetRes.text();
              sha256Checksum = parseSha256Checksum(checksumText, apkFileName);
            }
          } catch {
            // Lỗi mạng khi tải file checksum phụ: bỏ qua êm dịu, không gián đoạn app
          } finally {
            clearTimeout(assetTimeoutId);
          }
        }

        // Nếu không có trong release assets riêng biệt, kiểm tra thêm trong nội dung release body
        if (!sha256Checksum && data.body) {
          sha256Checksum = parseSha256Checksum(data.body, apkFileName);
        }

        if (!isMounted.current) return;

        setUpdateInfo({
          hasUpdate: true,
          newVersion: latestVersion,
          downloadUrl: downloadUrl,
          releaseNotes: data.body || 'Bản cập nhật mới có nhiều cải tiến và sửa lỗi.',
          sha256: sha256Checksum,
          apkFileName: apkFileName,
          isIntegrityVerified: Boolean(sha256Checksum && isValidSha256(sha256Checksum)),
        });
      }
    } catch (error) {
      // Xử lý ngoại lệ an toàn tối đa: không ném lỗi ra ngoài và không làm crash app khi offline
      if (!isNetworkError(error)) {
        // Log debug an toàn nếu cần
      }
    }
  };

  if (!updateInfo?.hasUpdate) return null;

  return (
    <Modal visible={true} transparent={true} animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: theme.card }]}>
          <View style={styles.iconContainer}>
            <Ionicons name="cloud-download" size={60} color={theme.accent} />
          </View>

          <Text style={[styles.title, { color: theme.text }]}>Có Phiên Bản Mới!</Text>

          <Text style={[styles.versionText, { color: theme.textSub }]}>
            Phiên bản {updateInfo.newVersion} đã sẵn sàng.
          </Text>

          <ScrollView style={styles.notesContainer}>
            <Text style={[styles.notesText, { color: theme.textSub }]}>
              {updateInfo.releaseNotes}
            </Text>
          </ScrollView>

          {/* Khối hiển thị tính toàn vẹn gói cập nhật (SHA-256) */}
          {updateInfo.sha256 ? (
            <View style={[styles.integrityCard, { backgroundColor: theme.surface }]}>
              <View style={styles.integrityHeader}>
                <Ionicons name="shield-checkmark" size={16} color="#10B981" />
                <Text style={[styles.integrityTitle, { color: theme.text }]}>
                  Toàn vẹn gói (SHA-256):
                </Text>
              </View>
              <TouchableOpacity
                style={styles.hashRow}
                onPress={handleCopyHash}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.hashText, { color: theme.textSub }]}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {updateInfo.sha256}
                </Text>
                <Ionicons
                  name={copiedHash ? 'checkmark-circle' : 'copy-outline'}
                  size={16}
                  color={copiedHash ? '#10B981' : theme.textSub}
                  style={{ marginLeft: 6 }}
                />
              </TouchableOpacity>
              {copiedHash ? (
                <Text style={styles.copiedHint}>Đã sao chép mã SHA-256 vào bộ nhớ tạm!</Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: theme.surface }]}
              onPress={() => setUpdateInfo(null)}
            >
              <Text style={[styles.btnText, { color: theme.textSub }]}>Để sau</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, { backgroundColor: theme.accent }]}
              onPress={() => Linking.openURL(updateInfo.downloadUrl)}
            >
              <Text style={styles.btnPrimaryText}>Tải ngay</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: width * 0.85,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(0,122,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  versionText: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  notesContainer: {
    maxHeight: 120,
    width: '100%',
    marginBottom: 16,
  },
  notesText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  integrityCard: {
    width: '100%',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  integrityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  integrityTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  hashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  hashText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  copiedHint: {
    fontSize: 11,
    color: '#10B981',
    marginTop: 4,
    textAlign: 'center',
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 8,
  },
  btnPrimary: {
    elevation: 2,
  },
  btnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
