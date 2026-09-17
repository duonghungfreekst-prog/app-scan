import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Switch, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Storage from '../utils/storage';
import { useTheme } from '../theme';

const SCAN_QUALITY_KEY = '@camscanner_scan_quality';
const COLOR_MODE_KEY = '@camscanner_color_mode';

export default function MeScreen({ navigation }: any) {
  const { theme, isDark, toggleDark } = useTheme();
  const [scanQuality, setScanQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [colorMode, setColorMode] = useState<'color' | 'grayscale' | 'bw'>('color');
  const [saveOriginal, setSaveOriginal] = useState(true);

  const [geminiApiKey, setGeminiApiKey] = useState('');

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    try {
      const q = await Storage.getItem(SCAN_QUALITY_KEY);
      const c = await Storage.getItem(COLOR_MODE_KEY);
      const key = await Storage.getItem('@camscanner_gemini_api_key');
      if (q) setScanQuality(q as any);
      if (c) setColorMode(c as any);
      if (key) setGeminiApiKey(key);
    } catch {
      // KHÔNG log lỗi với dữ liệu nhạy cảm
      console.warn('[UI] Failed to load settings');
    }
  };

  const saveSetting = async (key: string, value: string) => {
    try { await Storage.setItem(key, value); }
    catch { console.warn('[UI] Failed to save setting'); }
  };

  const saveGeminiKey = async () => {
    const trimmedKey = geminiApiKey.trim();
    // Validate cơ bản (chiều dài tối thiểu) thay vì ép buộc prefix
    if (trimmedKey && trimmedKey.length < 10) {
      Alert.alert('⚠️ Key không hợp lệ', 'Vui lòng nhập API Key hợp lệ.');
      return;
    }
    try {
      await Storage.setItem('@camscanner_gemini_api_key', trimmedKey);
      if (trimmedKey) {
        Alert.alert('✅ Đã lưu', 'Gemini Vision API Key đã được lưu an toàn!');
      } else {
        Alert.alert('✅ Đã xóa', 'API Key đã được xóa. App sẽ dùng chế độ On-Device.');
      }
    } catch {
      // KHÔNG log lỗi chi tiết liên quan đến key
      console.warn('[UI] Failed to save API key');
      Alert.alert('Lỗi', 'Không thể lưu API Key. Vui lòng thử lại.');
    }
  };

  const qualityOptions: { key: 'high' | 'medium' | 'low'; label: string; desc: string }[] = [
    { key: 'high',   label: 'Cao (100%)',         desc: 'File lớn hơn, chất lượng siêu nét' },
    { key: 'medium', label: 'Trung bình (85%)',   desc: 'Cân bằng giữa dung lượng và chất lượng' },
    { key: 'low',    label: 'Thấp (70%)',         desc: 'File nhỏ, phù hợp để chia sẻ nhanh' },
  ];

  const colorOptions: { key: 'color' | 'grayscale' | 'bw'; label: string }[] = [
    { key: 'color',     label: '🟢 Màu gốc' },
    { key: 'grayscale', label: '⚫ Xám' },
    { key: 'bw',        label: '⬛ Trắng đen' },
  ];

  return (
    <ScrollView style={[s.container, { backgroundColor: theme.bg }]} contentContainerStyle={{ paddingBottom: 50 }} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={[theme.gradStart, theme.gradEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <View style={s.avatar}>
          <Ionicons name="ribbon" size={38} color="#ffd700" />
        </View>
        <Text style={s.name}>Premium Member</Text>
        <Text style={s.email}>Đã kích hoạt bản quyền PRO trọn đời</Text>
      </LinearGradient>

      {/* Dark Mode Toggle */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[s.sectionTitle, { color: theme.text }]}>🌙 Giao diện</Text>
        <View style={s.switchRow}>
          <View style={s.switchInfo}>
            <Text style={[s.switchLabel, { color: theme.text }]}>Chế độ tối (Dark Mode)</Text>
            <Text style={[s.switchDesc, { color: theme.textSub }]}>
              {isDark ? 'Đang bật — giao diện tối sang trọng' : 'Đang tắt — giao diện sáng ban ngày'}
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

      {/* Scan Quality */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[s.sectionTitle, { color: theme.text }]}>⚡ Chất lượng quét mặc định</Text>
        {qualityOptions.map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[s.optionRow, { backgroundColor: theme.surface, borderColor: scanQuality === opt.key ? theme.accent : theme.border }]}
            onPress={() => { setScanQuality(opt.key); saveSetting(SCAN_QUALITY_KEY, opt.key); }}
          >
            <View style={s.optionInfo}>
              <Text style={[s.optionLabel, { color: scanQuality === opt.key ? theme.accent : theme.text }]}>{opt.label}</Text>
              <Text style={[s.optionDesc, { color: theme.textSub }]}>{opt.desc}</Text>
            </View>
            {scanQuality === opt.key && <Ionicons name="checkmark-circle" size={22} color={theme.accent} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Default Color Mode */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[s.sectionTitle, { color: theme.text }]}>🎨 Chế độ màu mặc định</Text>
        <View style={s.colorRow}>
          {colorOptions.map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[s.colorBtn, { backgroundColor: theme.surface, borderColor: colorMode === opt.key ? theme.accent : theme.border }]}
              onPress={() => { setColorMode(opt.key); saveSetting(COLOR_MODE_KEY, opt.key); }}
            >
              <Text style={[s.colorBtnText, { color: colorMode === opt.key ? theme.accent : theme.textSub }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Gemini AI Key Config */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[s.sectionTitle, { color: theme.text }]}>🤖 Cấu hình Gemini AI Vision</Text>
        <Text style={[s.switchDesc, { color: theme.textSub, marginBottom: 10 }]}>
          Nhập Gemini API Key cá nhân để giải toán & phân tích hình ảnh AI không giới hạn:
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            style={{
              flex: 1, borderWidth: 1.5, borderColor: theme.border, backgroundColor: theme.surface,
              borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: theme.text
            }}
            value={geminiApiKey}
            onChangeText={setGeminiApiKey}
            placeholder="Dán Gemini API Key tại đây"
            placeholderTextColor={theme.textMuted}
            secureTextEntry
          />
          <TouchableOpacity
            style={{ backgroundColor: theme.accent, paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center' }}
            onPress={saveGeminiKey}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>Lưu Key</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Storage */}
      <View style={[s.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[s.sectionTitle, { color: theme.text }]}>📁 Tùy chọn lưu trữ</Text>
        <View style={s.switchRow}>
          <View style={s.switchInfo}>
            <Text style={[s.switchLabel, { color: theme.text }]}>Giữ ảnh gốc sau khi tạo PDF</Text>
            <Text style={[s.switchDesc, { color: theme.textSub }]}>Ảnh quét sẽ không bị xóa khỏi thiết bị</Text>
          </View>
          <Switch
            value={saveOriginal}
            onValueChange={setSaveOriginal}
            trackColor={{ false: theme.switchTrackOff, true: theme.accent }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Other */}
      <View style={[s.menu, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {[
          { icon: 'help-circle',        color: theme.blue,   bg: theme.blue  + '20', label: 'Trợ giúp & Phản hồi',
            onPress: () => Alert.alert('Trợ giúp', 'Liên hệ nhà phát triển qua email hỗ trợ của dự án.') },
          { icon: 'information-circle', color: '#8e24aa',    bg: '#8e24aa20', label: 'Giới thiệu',
            onPress: () => Alert.alert('CamScanner Pro', 'Phiên bản: 2.3.0 (Sửa lỗi Lưu/Chia sẻ QR)\n\nMáy quét tài liệu AI đa năng.\n\n© 2026 Developer Team.') },
        ].map((item, i) => (
          <TouchableOpacity key={i} style={[s.menuItem, { borderBottomColor: theme.border }]} onPress={item.onPress} activeOpacity={0.6}>
            <View style={[s.menuIconBox, { backgroundColor: item.bg }]}>
              <Ionicons name={item.icon as any} size={22} color={item.color} />
            </View>
            <Text style={[s.menuText, { color: theme.text }]}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.textMuted} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
        ))}
      </View>
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
});
