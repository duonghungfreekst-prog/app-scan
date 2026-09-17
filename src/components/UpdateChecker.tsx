import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Linking, Dimensions, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

// Thông tin cấu hình GitHub Repository của bạn
const GITHUB_USERNAME = 'duonghungfreekst-prog';
const GITHUB_REPO = 'app-scan';

const { width } = Dimensions.get('window');

// Hàm so sánh phiên bản (vd: "2.4.0" > "2.3.0")
const compareVersions = (v1: string, v2: string) => {
  const parts1 = v1.replace(/[^0-9.]/g, '').split('.').map(Number);
  const parts2 = v2.replace(/[^0-9.]/g, '').split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
};

export default function UpdateChecker() {
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; newVersion: string; downloadUrl: string; releaseNotes: string } | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    checkUpdate();
  }, []);

  const checkUpdate = async () => {
    try {
      if (GITHUB_USERNAME === 'YOUR_GITHUB_USERNAME') return; // Chưa cấu hình thì bỏ qua

      const currentVersion = Constants.expoConfig?.version || '1.0.0';
      const apiUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/releases/latest`;
      
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) return;
      
      const data = await response.json();
      const latestVersion = data.tag_name; // Ví dụ: "v2.4.0" hoặc "2.4.0"
      
      if (compareVersions(latestVersion, currentVersion) > 0) {
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
