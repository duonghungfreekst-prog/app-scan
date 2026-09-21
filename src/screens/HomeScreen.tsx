import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { RootStackParamList, MainTabParamList, ToolsActionType } from '../types/navigation';
import { getDocumentDirectory, removeDocumentOcrText } from '../utils/fileHelper';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, Theme } from '../theme';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type HomeScreenNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface HomeScreenProps {
  navigation: HomeScreenNavigationProp;
}

const getFileMeta = (fileName: string, theme: Theme) => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return {
      type: 'PDF Document',
      icon: 'document' as const,
      color: theme.warn,
      mimeType: 'application/pdf',
    };
  }
  if (lower.endsWith('.docx')) {
    return {
      type: 'Word Document',
      icon: 'document-text' as const,
      color: theme.blue,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  if (lower.endsWith('.xlsx')) {
    return {
      type: 'Excel Spreadsheet',
      icon: 'stats-chart' as const,
      color: theme.green,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return {
      type: 'JPG Image',
      icon: 'image' as const,
      color: theme.accent,
      mimeType: 'image/jpeg',
    };
  }
  if (lower.endsWith('.png')) {
    return {
      type: 'PNG Image',
      icon: 'image' as const,
      color: theme.accent,
      mimeType: 'image/png',
    };
  }
  const ext = lower.split('.').pop()?.toUpperCase();
  return {
    type: ext ? `${ext} File` : 'Tài liệu',
    icon: 'document-outline' as const,
    color: theme.textSub,
    mimeType: undefined,
  };
};

interface RecentFileItemProps {
  fileName: string;
  theme: Theme;
  onOpen: (fileName: string) => void;
  onShare: (fileName: string) => void;
  onDelete: (fileName: string) => void;
}

const RecentFileItem = React.memo(function RecentFileItem({
  fileName,
  theme,
  onOpen,
  onShare,
  onDelete,
}: RecentFileItemProps) {
  const meta = getFileMeta(fileName, theme);

  return (
    <View style={[s.recentFileItem, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {/* Vùng bấm mở file tách biệt, không lồng touchable */}
      <TouchableOpacity
        style={s.recentFileContent}
        onPress={() => onOpen(fileName)}
        activeOpacity={0.7}
      >
        <View style={[s.fileIconBg, { backgroundColor: meta.color + '22' }]}>
          <Ionicons name={meta.icon as any} size={22} color={meta.color} />
        </View>
        <View style={s.fileInfo}>
          <Text style={[s.fileName, { color: theme.text }]} numberOfLines={1}>
            {fileName}
          </Text>
          <Text style={[s.fileMeta, { color: theme.textSub }]}>
            {meta.type}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Cụm nút thao tác chia sẻ / xóa nằm độc lập bên cạnh, ngăn chặn xung đột sự kiện chạm */}
      <View style={s.recentFileActions}>
        <TouchableOpacity
          onPress={() => onShare(fileName)}
          style={[s.actionBtn, { backgroundColor: theme.surface }]}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        >
          <Ionicons name="share-social" size={18} color={theme.blue} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onDelete(fileName)}
          style={[s.actionBtn, { backgroundColor: theme.surface }]}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        >
          <Ionicons name="trash-outline" size={18} color={theme.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  const loadRecentFiles = useCallback(async () => {
    try {
      const root = getDocumentDirectory();
      const dirInfo = await FileSystem.getInfoAsync(root);
      if (!dirInfo.exists) {
        setRecentFiles([]);
        return;
      }
      const fileNames = await FileSystem.readDirectoryAsync(root);
      const supportedExtensions = ['.pdf', '.docx', '.xlsx', '.jpg', '.jpeg', '.png'];

      // Lọc nhanh theo phần mở rộng hợp lệ để tránh đọc info các file không cần thiết
      const validFiles = fileNames.filter(name => {
        if (name.startsWith('.')) return false;
        const lower = name.toLowerCase();
        return supportedExtensions.some(ext => lower.endsWith(ext));
      });

      // Lấy thông tin thời gian sửa đổi song song
      const fileStats = await Promise.all(
        validFiles.map(async (name) => {
          try {
            const info = await FileSystem.getInfoAsync(`${root}${name}`);
            if (info.exists && !info.isDirectory) {
              return {
                name,
                modificationTime: (info as any).modificationTime ?? 0,
              };
            }
          } catch {
            // Bỏ qua lỗi đọc info từng file
          }
          return null;
        })
      );

      // Sắp xếp theo thời gian mới nhất và giới hạn tối đa 5 file gần nhất
      const sorted = fileStats
        .filter((item): item is { name: string; modificationTime: number } => item !== null)
        .sort((a, b) => b.modificationTime - a.modificationTime)
        .slice(0, 5)
        .map(item => item.name);

      setRecentFiles(sorted);
    } catch (e) {
      console.warn('[HomeScreen] Error reading docs', e);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadRecentFiles(); }, [loadRecentFiles]));

  const handleSmartScan = useCallback(() => {
    navigation.navigate('Scanner', { autoScan: true });
  }, [navigation]);

  const handleTriggerTool = useCallback((actionName: ToolsActionType) => {
    navigation.navigate('Tools', { triggerAction: actionName });
  }, [navigation]);

  const handleOpenFile = useCallback(async (fileName: string) => {
    try {
      const uri = getDocumentDirectory() + fileName;
      if (await Sharing.isAvailableAsync()) {
        const meta = getFileMeta(fileName, theme);
        await Sharing.shareAsync(uri, {
          dialogTitle: `Mở tài liệu: ${fileName}`,
          mimeType: meta.mimeType,
        });
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể mở tài liệu');
    }
  }, [theme]);

  const handleShareFile = useCallback(async (fileName: string) => {
    try {
      const uri = getDocumentDirectory() + fileName;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { dialogTitle: `Chia sẻ tài liệu: ${fileName}` });
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể chia sẻ file');
    }
  }, []);

  const handleDeleteFile = useCallback((fileName: string) => {
    Alert.alert('Xác nhận', `Bạn có chắc muốn xóa "${fileName}"?`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            const uri = getDocumentDirectory() + fileName;
            await FileSystem.deleteAsync(uri, { idempotent: true });
            await removeDocumentOcrText(fileName);
            loadRecentFiles();
          } catch {
            Alert.alert('Lỗi', 'Không thể xóa tài liệu.');
          }
        },
      },
    ]);
  }, [loadRecentFiles]);

  const tools: Array<{
    action: () => void;
    icon: string;
    bg: string;
    color: string;
    label: string;
  }> = [
    { action: () => handleSmartScan(),                icon: 'scan',          bg: '#00e5cc22', color: theme.accent,    label: 'Quét Thường' },
    { action: () => navigation.navigate('QRScanner'), icon: 'qr-code',       bg: '#ffb30022', color: theme.warn,      label: 'Quét QR' },
    { action: () => navigation.navigate('QRGenerator'),icon: 'create',       bg: '#7c3aed22', color: '#7c3aed',       label: 'Tạo QR' },
    { action: () => handleTriggerTool('pdfTools'),    icon: 'document-text', bg: '#ff525222', color: theme.danger,    label: 'Gộp PDF' },
    { action: () => handleTriggerTool('importImages'), icon: 'images',        bg: '#64b5f622', color: theme.blue,      label: 'Nhập Ảnh' },
    { action: () => handleTriggerTool('idCard'),       icon: 'card',          bg: '#1e88e522', color: theme.blue,      label: 'Thẻ ID' },
    { action: () => handleTriggerTool('ocr'),          icon: 'text',          bg: '#43a04722', color: theme.green,     label: 'Nhận diện chữ' },
  ];

  const renderHeader = () => (
    <>
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
    </>
  );

  const renderEmpty = () => (
    <View style={[s.emptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Ionicons name="documents-outline" size={40} color={theme.textMuted} />
      <Text style={[s.emptyText, { color: theme.textMuted }]}>Chưa có tài liệu nào{'\n'}Bấm nút "+" để bắt đầu</Text>
    </View>
  );

  const renderRecentItem = useCallback(({ item }: { item: string }) => (
    <RecentFileItem
      fileName={item}
      theme={theme}
      onOpen={handleOpenFile}
      onShare={handleShareFile}
      onDelete={handleDeleteFile}
    />
  ), [theme, handleOpenFile, handleShareFile, handleDeleteFile]);

  const keyExtractor = useCallback((item: string) => item, []);

  return (
    <View style={[s.container, { backgroundColor: theme.bg }]}>
      <LinearGradient
        colors={[theme.gradStart, theme.gradEnd]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[s.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}
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

      <FlatList
        data={recentFiles}
        keyExtractor={keyExtractor}
        renderItem={renderRecentItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      />

      <TouchableOpacity style={[s.fab, { backgroundColor: theme.fabBg, shadowColor: theme.fabBg }]} onPress={handleSmartScan}>
        <Ionicons name="camera" size={30} color="white" />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingBottom: 28, paddingHorizontal: 22,
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
    flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, marginBottom: 10,
    borderWidth: 1,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3,
  },
  recentFileContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center', marginRight: 10,
  },
  fileIconBg: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  fileMeta: { fontSize: 12 },
  recentFileActions: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  actionBtn: { padding: 9, borderRadius: 12 },
  fab: {
    position: 'absolute', bottom: 24, alignSelf: 'center',
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 10,
  },
});
