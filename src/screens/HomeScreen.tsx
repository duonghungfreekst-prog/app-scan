import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { RootStackParamList, MainTabParamList } from '../types/navigation';
import { getDocumentDirectory, listDocumentItems, DEFAULT_SUPPORTED_EXTENSIONS } from '../utils/fileHelper';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
import Constants from 'expo-constants';

type HomeScreenNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface HomeScreenProps {
  navigation: HomeScreenNavigationProp;
}

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const { theme } = useTheme();
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  const loadRecentFiles = async () => {
    try {
      const items = await listDocumentItems('', DEFAULT_SUPPORTED_EXTENSIONS);
      // Chỉ lấy các tập tin (không phải thư mục) và lấy 3 file gần nhất
      const filesOnly = items.filter(it => !it.isDirectory).slice(0, 3);
      setRecentFiles(filesOnly.map(m => m.name));
    } catch (e) {
      console.warn('[HomeScreen] Error reading docs', e);
    }
  };

  useFocusEffect(useCallback(() => { loadRecentFiles(); }, []));

  const handleSmartScan = () => navigation.navigate('Scanner', { autoScan: true });
  const handleTriggerTool = (actionName: string) => navigation.navigate('Tools', { triggerAction: actionName });

  const handleOpenFile = async (fileName: string) => {
    try {
      const uri = getDocumentDirectory() + fileName;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: `Mở tài liệu: ${fileName}`,
          mimeType: fileName.endsWith('.pdf')
            ? 'application/pdf'
            : fileName.endsWith('.docx')
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : fileName.endsWith('.xlsx')
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : undefined,
        });
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể mở tài liệu');
    }
  };

  const handleShareFile = async (fileName: string) => {
    try {
      const uri = getDocumentDirectory() + fileName;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { dialogTitle: `Chia sẻ tài liệu: ${fileName}` });
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể chia sẻ file');
    }
  };

  const tools = [
    { action: () => handleSmartScan(),                icon: 'scan',          bg: '#00e5cc22', color: theme.accent,    label: 'Quét Thường' },
    { action: () => navigation.navigate('QRScanner'), icon: 'qr-code',       bg: '#ffb30022', color: theme.warn,      label: 'Quét QR' },
    { action: () => navigation.navigate('QRGenerator'),icon: 'create',       bg: '#7c3aed22', color: '#7c3aed',       label: 'Tạo QR' },
    { action: () => handleTriggerTool('pdfTools'),    icon: 'document-text', bg: '#ff525222', color: theme.danger,    label: 'Gộp PDF' },
    { action: () => handleTriggerTool('importImages'), icon: 'images',        bg: '#64b5f622', color: theme.blue,      label: 'Nhập Ảnh' },
    { action: () => handleTriggerTool('idCard'),       icon: 'card',          bg: '#1e88e522', color: theme.blue,      label: 'Thẻ ID' },
    { action: () => handleTriggerTool('ocr'),          icon: 'text',          bg: '#43a04722', color: theme.green,     label: 'Nhận diện chữ' },
  ];

  return (
    <View style={[s.container, { backgroundColor: theme.bg }]}>
      <LinearGradient
        colors={[theme.gradStart, theme.gradEnd]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={s.header}
      >
        <View style={s.headerInner}>
          <View>
            <Text style={s.headerGreet}>Xin chào 👋</Text>
            <Text style={s.headerTitle}>CamScanner</Text>
          </View>
          <View style={s.premiumBadge}>
            <Ionicons name="shield-checkmark" size={14} color="#00e5cc" />
            <Text style={s.premiumText}>v{Constants.expoConfig?.version || '2.6.0'}</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={[s.sectionTitle, { color: theme.text }]}>Công cụ nhanh</Text>
        <View style={[s.toolsGrid, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {tools.map((t, i) => (
            <TouchableOpacity key={i} style={s.toolItem} onPress={t.action} activeOpacity={0.7}>
              <View style={[s.iconContainer, { backgroundColor: t.bg }]}>
                <Ionicons name={t.icon as any} size={26} color={t.color} />
              </View>
              <Text style={[s.toolText, { color: theme.textSub }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.sectionTitle, { color: theme.text }]}>Tài liệu gần đây</Text>
        {recentFiles.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="documents-outline" size={40} color={theme.textMuted} />
            <Text style={[s.emptyText, { color: theme.textMuted }]}>Chưa có tài liệu nào{'\n'}Bấm nút "+" để bắt đầu</Text>
          </View>
        ) : (
          recentFiles.map((file, idx) => {
            const iconName = file.endsWith('.docx') ? 'document-text' : file.endsWith('.xlsx') ? 'stats-chart' : 'document';
            const iconColor = file.endsWith('.docx') ? theme.blue : file.endsWith('.xlsx') ? theme.green : theme.warn;
            return (
              <TouchableOpacity
                key={idx}
                style={[s.recentFileItem, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => handleOpenFile(file)}
                activeOpacity={0.7}
              >
                <View style={[s.fileIconBg, { backgroundColor: iconColor + '22' }]}>
                  <Ionicons name={iconName as any} size={22} color={iconColor} />
                </View>
                <View style={s.fileInfo}>
                  <Text style={[s.fileName, { color: theme.text }]} numberOfLines={1}>{file}</Text>
                  <Text style={[s.fileMeta, { color: theme.textSub }]}>
                    {file.endsWith('.docx') ? 'Word Document' : file.endsWith('.xlsx') ? 'Excel Spreadsheet' : 'PDF Document'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => handleShareFile(file)} style={[s.shareBtn, { backgroundColor: theme.surface }]}>
                  <Ionicons name="share-social" size={18} color={theme.blue} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <TouchableOpacity style={[s.fab, { backgroundColor: theme.fabBg, shadowColor: theme.fabBg }]} onPress={handleSmartScan}>
        <Ionicons name="camera" size={30} color="white" />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: 56, paddingBottom: 28, paddingHorizontal: 22,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    marginBottom: -6, zIndex: 10,
    elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10,
  },
  headerInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  headerGreet: { fontSize: 14, color: 'rgba(255,255,255,0.75)', fontWeight: '500', letterSpacing: 0.5 },
  headerTitle: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5, marginTop: 2 },
  premiumBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,215,0,0.2)', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)'
  },
  premiumText: { color: '#ffd700', fontWeight: '800', fontSize: 13 },
  content: { padding: 16, paddingTop: 24, paddingBottom: 100 },
  sectionTitle: { fontSize: 17, fontWeight: '800', marginBottom: 12, marginTop: 8, letterSpacing: 0.2 },
  toolsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    borderRadius: 20, padding: 16, marginBottom: 20,
    borderWidth: 1,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6,
  },
  toolItem: { width: '30%', alignItems: 'center', marginBottom: 18 },
  iconContainer: {
    width: 54, height: 54, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  toolText: { fontSize: 11.5, textAlign: 'center', fontWeight: '600' },
  emptyCard: {
    borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1,
    marginBottom: 12,
  },
  emptyText: { textAlign: 'center', marginTop: 12, fontSize: 14, lineHeight: 22 },
  recentFileItem: {
    flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, marginBottom: 10,
    borderWidth: 1,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3,
  },
  fileIconBg: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  fileMeta: { fontSize: 12 },
  shareBtn: { padding: 9, borderRadius: 12 },
  fab: {
    position: 'absolute', bottom: 24, alignSelf: 'center',
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 10,
  },
});
