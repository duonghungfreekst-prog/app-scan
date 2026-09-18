import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Switch,
  ScrollView, TextInput, Modal, Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Storage from '../utils/storage';
import SecureStorage from '../core/security/secureStorage';
import Constants from 'expo-constants';
import { useTheme } from '../theme';
import { STORAGE_KEYS, CAPABILITY_MATRIX } from '../constants/config';
import { ScanQuality, ColorMode } from '../types/domain';

const { width } = Dimensions.get('window');

export default function MeScreen({ navigation }: any) {
  const { theme, isDark, toggleDark } = useTheme();
  const [scanQuality, setScanQuality] = useState<ScanQuality>('high');
  const [colorMode, setColorMode] = useState<ColorMode>('color');
  const [saveOriginal, setSaveOriginal] = useState(true);
  const [geminiApiKey, setGeminiApiKey] = useState('');

  // Modal Ma trận năng lực
  const [matrixVisible, setMatrixVisible] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const q = await Storage.getItem(STORAGE_KEYS.SCAN_QUALITY);
      const c = await Storage.getItem(STORAGE_KEYS.COLOR_MODE);
      const s = await Storage.getItem(STORAGE_KEYS.SAVE_ORIGINAL);
      const key = await SecureStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY);
      if (q) setScanQuality(q as ScanQuality);
      if (c) setColorMode(c as ColorMode);
      if (s !== null) setSaveOriginal(s === 'true');
      if (key) setGeminiApiKey(key);
    } catch {
      console.warn('[MeScreen] Failed to load settings');
    }
  };

  const saveSetting = async (key: string, value: string) => {
    try {
      await Storage.setItem(key, value);
    } catch {
      console.warn('[MeScreen] Failed to save setting');
    }
  };

  const handleToggleSaveOriginal = async (val: boolean) => {
    setSaveOriginal(val);
    await saveSetting(STORAGE_KEYS.SAVE_ORIGINAL, String(val));
  };

  const handleSelectQuality = async (q: ScanQuality) => {
    setScanQuality(q);
    await saveSetting(STORAGE_KEYS.SCAN_QUALITY, q);
  };

  const handleSelectColorMode = async (c: ColorMode) => {
    setColorMode(c);
    await saveSetting(STORAGE_KEYS.COLOR_MODE, c);
  };

  const saveGeminiKey = async () => {
    const trimmedKey = geminiApiKey.trim();
    if (trimmedKey && trimmedKey.length < 10) {
      Alert.alert('⚠️ Key không hợp lệ', 'Vui lòng nhập API Key hợp lệ.');
      return;
    }
    try {
      if (trimmedKey) {
        await SecureStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, trimmedKey);
        Alert.alert(
          '✅ Đã lưu API Key',
          'Gemini Vision API Key đã được mã hóa an toàn trong phần cứng thiết bị (Android Keystore / iOS Keychain).\n\nLưu ý: Ảnh tài liệu gửi qua tính năng AI sẽ được truyền trực tiếp tới máy chủ Google Gemini theo chính sách BYOK cá nhân.'
        );
      } else {
        await SecureStorage.removeItem(STORAGE_KEYS.GEMINI_API_KEY);
        Alert.alert(
          '✅ Đã xóa API Key',
          'Đã xóa API Key khỏi máy. Các tính năng AI (OCR, Giải toán AI) sẽ tạm ngưng cho tới khi bạn cấu hình lại key.'
        );
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể lưu API Key an toàn. Vui lòng thử lại.');
    }
  };

  const qualityOptions: { key: ScanQuality; label: string; desc: string }[] = [
    { key: 'high',   label: 'Cao (1600px)',       desc: 'Độ nét cao nhất, phù hợp lưu trữ & in ấn' },
    { key: 'medium', label: 'Trung bình (1200px)', desc: 'Cân bằng giữa chất lượng và dung lượng' },
    { key: 'low',    label: 'Thấp (900px)',        desc: 'File nhẹ, tối ưu chia sẻ qua mạng xã hội' },
  ];

  const colorOptions: { key: ColorMode; label: string }[] = [
    { key: 'color',     label: '🟢 Màu gốc' },
    { key: 'grayscale', label: '⚫ Xám' },
    { key: 'bw',        label: '⬛ Trắng đen' },
  ];

  const appVersion = Constants.expoConfig?.version || '2.5.0';

  return (
    <ScrollView style={[s.container, { backgroundColor: theme.bg }]} contentContainerStyle={{ paddingBottom: 50 }} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={[theme.gradStart, theme.gradEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <View style={s.avatar}>
          <Ionicons name="document-text" size={38} color="#00e5cc" />
        </View>
        <Text style={s.name}>CamScanner</Text>
        <Text style={s.email}>Phiên bản {appVersion} • On-Device & Gemini AI</Text>
      </LinearGradient>

      {/* Dark Mode */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[s.sectionTitle, { color: theme.text }]}>🌙 Giao diện</Text>
        <View style={s.switchRow}>
          <View style={s.switchInfo}>
            <Text style={[s.switchLabel, { color: theme.text }]}>Chế độ tối (Dark Mode)</Text>
            <Text style={[s.switchDesc, { color: theme.textSub }]}>
              {isDark ? 'Giao diện tối tiết kiệm pin' : 'Giao diện sáng'}
            </Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleDark}
            trackColor={{ false: theme.switchTrackOff, true: theme.accent }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Gemini AI API Key */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Ionicons name="sparkles" size={18} color={theme.accent} style={{ marginRight: 6 }} />
          <Text style={[s.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Cấu hình Gemini Vision AI</Text>
        </View>
        <Text style={[s.switchDesc, { color: theme.textSub, marginBottom: 12 }]}>
          Nhập Google Gemini API Key cá nhân để sử dụng tính năng Nhận diện chữ viết (OCR AI) và Giải toán AI qua ảnh.
        </Text>
        <TextInput
          style={[s.apiKeyInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
          placeholder="Dán mã API Key của bạn (AIzaSy...)"
          placeholderTextColor={theme.textMuted}
          value={geminiApiKey}
          onChangeText={setGeminiApiKey}
          secureTextEntry
          autoCapitalize="none"
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={[s.saveKeyBtn, { backgroundColor: theme.accent }]} onPress={saveGeminiKey}>
            <Text style={s.saveKeyText}>Lưu Key An Toàn</Text>
          </TouchableOpacity>
          {geminiApiKey.length > 0 && (
            <TouchableOpacity
              style={[s.saveKeyBtn, { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }]}
              onPress={() => { setGeminiApiKey(''); saveGeminiKey(); }}
            >
              <Text style={[s.saveKeyText, { color: theme.danger }]}>Xóa</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Scan Quality */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[s.sectionTitle, { color: theme.text }]}>📷 Chất lượng quét</Text>
        {qualityOptions.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[s.optionRow, {
              backgroundColor: scanQuality === opt.key ? theme.accent + '15' : 'transparent',
              borderColor: scanQuality === opt.key ? theme.accent : theme.border,
            }]}
            onPress={() => handleSelectQuality(opt.key)}
            activeOpacity={0.7}
          >
            <View style={s.optionInfo}>
              <Text style={[s.optionLabel, { color: theme.text }]}>{opt.label}</Text>
              <Text style={[s.optionDesc, { color: theme.textSub }]}>{opt.desc}</Text>
            </View>
            {scanQuality === opt.key && <Ionicons name="checkmark-circle" size={20} color={theme.accent} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Default Filter Mode */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[s.sectionTitle, { color: theme.text }]}>🎨 Bộ lọc màu mặc định</Text>
        <View style={s.colorRow}>
          {colorOptions.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[s.colorBtn, {
                backgroundColor: colorMode === c.key ? theme.accent + '20' : theme.surface,
                borderColor: colorMode === c.key ? theme.accent : theme.border,
              }]}
              onPress={() => handleSelectColorMode(c.key)}
              activeOpacity={0.7}
            >
              <Text style={[s.colorBtnText, { color: colorMode === c.key ? theme.accent : theme.text }]}>
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Save Original Toggle */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={s.switchRow}>
          <View style={s.switchInfo}>
            <Text style={[s.switchLabel, { color: theme.text }]}>Giữ file quét nháp tạm</Text>
            <Text style={[s.switchDesc, { color: theme.textSub }]}>
              {saveOriginal ? 'Tự động lưu phiên quét dở dang để khôi phục khi cần' : 'Xóa file ảnh tạm ngay sau khi tạo PDF'}
            </Text>
          </View>
          <Switch
            value={saveOriginal}
            onValueChange={handleToggleSaveOriginal}
            trackColor={{ false: theme.switchTrackOff, true: theme.accent }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Menu & About */}
      <View style={[s.menu, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <TouchableOpacity
          style={[s.menuItem, { borderBottomColor: theme.border }]}
          onPress={() => setMatrixVisible(true)}
          activeOpacity={0.6}
        >
          <View style={[s.menuIconBox, { backgroundColor: theme.accent + '20' }]}>
            <Ionicons name="shield-checkmark" size={22} color={theme.accent} />
          </View>
          <Text style={[s.menuText, { color: theme.text }]}>Ma trận năng lực (Offline vs Online)</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.menuItem, { borderBottomColor: theme.border }]}
          onPress={() => Alert.alert(
            'Quyền riêng tư & Dữ liệu',
            '1. Dữ liệu quét, xuất PDF, gộp file, căn chỉnh góc hoạt động 100% On-Device nội bộ trên điện thoại của bạn.\n\n2. Tính năng OCR và Giải toán AI sử dụng API Key cá nhân của bạn để gọi trực tiếp tới Google Gemini. Ứng dụng không thu thập hay lưu trữ trung gian bất kỳ tài liệu nào của bạn.'
          )}
          activeOpacity={0.6}
        >
          <View style={[s.menuIconBox, { backgroundColor: theme.blue + '20' }]}>
            <Ionicons name="lock-closed" size={22} color={theme.blue} />
          </View>
          <Text style={[s.menuText, { color: theme.text }]}>Chính sách Quyền riêng tư</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.menuItem, { borderBottomWidth: 0 }]}
          onPress={() => Alert.alert('CamScanner Pro', `Phiên bản: ${appVersion}\n\nMáy quét tài liệu thông minh chuẩn Production.\n\n© 2026 Developer Team.`)}
          activeOpacity={0.6}
        >
          <View style={[s.menuIconBox, { backgroundColor: '#8e24aa20' }]}>
            <Ionicons name="information-circle" size={22} color="#8e24aa" />
          </View>
          <Text style={[s.menuText, { color: theme.text }]}>Giới thiệu ứng dụng</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      </View>

      {/* Capability Matrix Modal */}
      <Modal visible={matrixVisible} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.matrixBox, { backgroundColor: theme.card }]}>
            <View style={s.matrixHeader}>
              <Text style={[s.matrixTitle, { color: theme.text }]}>📊 Phân định Năng lực Hệ thống</Text>
              <TouchableOpacity onPress={() => setMatrixVisible(false)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {CAPABILITY_MATRIX.map((item) => (
                <View key={item.id} style={[s.matrixItem, { borderBottomColor: theme.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.matrixItemName, { color: theme.text }]}>{item.name}</Text>
                    <Text style={{ fontSize: 12, color: theme.textSub, marginTop: 2 }}>
                      Nhà cung cấp: {item.provider}
                    </Text>
                    {item.privacyNotice && (
                      <Text style={{ fontSize: 11, color: theme.warn, marginTop: 2 }}>
                        ⚠️ {item.privacyNotice}
                      </Text>
                    )}
                  </View>
                  <View style={[s.statusBadge, { backgroundColor: item.isOffline ? '#43a04720' : '#1e88e520' }]}>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: item.isOffline ? theme.green : theme.blue }}>
                      {item.isOffline ? '🟢 On-Device' : '🌐 Cloud AI'}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: 80, paddingBottom: 40, alignItems: 'center',
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
    marginBottom: 16, elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  avatar: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
  },
  name: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 0.3 },
  email: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 6 },
  section: {
    marginHorizontal: 16, marginBottom: 14,
    borderRadius: 18, padding: 18, borderWidth: 1,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  switchInfo: { flex: 1 },
  switchLabel: { fontSize: 15, fontWeight: '700' },
  switchDesc: { fontSize: 12, marginTop: 3 },
  apiKeyInput: {
    height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14,
    fontSize: 14, marginBottom: 12,
  },
  saveKeyBtn: {
    paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  saveKeyText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', padding: 13, borderRadius: 12,
    marginBottom: 8, borderWidth: 1.5,
  },
  optionInfo: { flex: 1 },
  optionLabel: { fontSize: 14, fontWeight: '700' },
  optionDesc: { fontSize: 12, marginTop: 2 },
  colorRow: { flexDirection: 'row', gap: 8 },
  colorBtn: { flex: 1, padding: 10, borderRadius: 11, alignItems: 'center', borderWidth: 1.5 },
  colorBtnText: { fontSize: 11.5, fontWeight: '700', textAlign: 'center' },
  menu: {
    marginHorizontal: 16, borderRadius: 18, borderWidth: 1,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6,
    paddingVertical: 4, overflow: 'hidden',
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  menuIconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  menuText: { fontSize: 15, marginLeft: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  matrixBox: { width: width * 0.92, borderRadius: 24, padding: 20, elevation: 12 },
  matrixHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  matrixTitle: { fontSize: 17, fontWeight: 'bold' },
  matrixItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1 },
  matrixItemName: { fontSize: 14, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginLeft: 8 },
});
