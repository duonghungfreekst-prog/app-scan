import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Linking, Dimensions, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
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

export default function UpdateChecker() {
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; newVersion: string; downloadUrl: string; releaseNotes: string } | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    checkUpdate();
  }, []);

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

      try {
        const response = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Cache-Control': 'no-cache'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) return;
        
        // Cập nhật timestamp lần kiểm tra thành công
        await Storage.setItem(LAST_CHECK_KEY, String(now));

        const data = await response.json();
        const latestVersion = data.tag_name; // Ví dụ: "v2.5.0"
        
        if (compareSemVer(latestVersion, currentVersion) > 0) {
          // Ưu tiên tìm file .apk trong assets, nếu không thì dẫn tới trang tải HTML
          let downloadUrl = data.html_url;
          if (data.assets && data.assets.length > 0) {
            const apkAsset = data.assets.find((a: any) => a.name.endsWith('.apk'));
            if (apkAsset) {
              downloadUrl = apkAsset.browser_download_url;
            }
          }
          
          setUpdateInfo({
            hasUpdate: true,
            newVersion: latestVersion,
            downloadUrl: downloadUrl,
            releaseNotes: data.body || 'Bản cập nhật mới có nhiều cải tiến và sửa lỗi.'
          });
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        // Bỏ qua lỗi timeout hoặc mạng không khả dụng khi kiểm tra ngầm
      }
    } catch (error) {
      console.log('Update check error:', error);
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
    padding: 20
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
    shadowOffset: { width: 0, height: 4 }
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(0,122,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center'
  },
  versionText: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center'
  },
  notesContainer: {
    maxHeight: 120,
    width: '100%',
    marginBottom: 20,
  },
  notesText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center'
  },
  actions: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between'
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 8
  },
  btnPrimary: {
    elevation: 2,
  },
  btnText: {
    fontSize: 16,
    fontWeight: '600'
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  }
});
