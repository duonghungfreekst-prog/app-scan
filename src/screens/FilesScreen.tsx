import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal,
  TextInput, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import {
  getDocumentDirectory, copyFileToDocuments, listDocumentItems,
  DocumentItem
} from '../utils/fileHelper';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme';

export default function FilesScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string>(''); // Thư mục con hiện tại
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [folderDialogVisible, setFolderDialogVisible] = useState(false);
  const [folderName, setFolderName] = useState('');

  const loadFiles = async () => {
    try {
      const docs = await listDocumentItems(currentFolder, ['.pdf', '.docx', '.xlsx']);
      setItems(docs);
    } catch (e) {
      console.log('[UI] Error loading files', e);
    }
  };

  useFocusEffect(useCallback(() => {
    loadFiles();
  }, [currentFolder]));

  const handleShareFile = async (item: DocumentItem) => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(item.uri);
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể chia sẻ file.');
    }
  };

  const handleDeleteItem = (item: DocumentItem) => {
    const isFolder = item.isDirectory;
    Alert.alert('Xác nhận', `Bạn có chắc muốn xóa ${isFolder ? 'thư mục' : 'tập tin'} "${item.name}"?`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            await FileSystem.deleteAsync(item.uri, { idempotent: true });
            loadFiles();
          } catch {
            Alert.alert('Lỗi', `Không thể xóa ${isFolder ? 'thư mục' : 'tập tin'}.`);
          }
        }
      }
    ]);
  };

  const handleImportImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      quality: 1
    });
    if (!result.canceled && result.assets?.length > 0) {
      navigation.navigate('Scanner', { importImages: result.assets.map(a => a.uri) });
    }
  };

  const handleImportPdf = async () => {
    try {
      let result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
      if (!result.canceled && result.assets?.length > 0) {
        const { uri: sourceUri, name: originalName } = result.assets[0];
        const safeName = (originalName || 'PDF_' + Date.now()).replace(/[^a-zA-Z0-9_\-\sÀ-ÿ]/g, '_').replace(/\.pdf$/i, '');
        await copyFileToDocuments(sourceUri, safeName + '.pdf', currentFolder);
        Alert.alert('✅ Thành công', `Đã nhập tài liệu: ${safeName}.pdf`);
        loadFiles();
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể chọn file PDF.');
    }
  };

  const doCreateFolder = async () => {
    const trimmed = folderName.trim().replace(/[^a-zA-Z0-9_\-À-ÿ\s]/g, '_');
    if (!trimmed) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên thư mục hợp lệ.');
      return;
    }
    try {
      const root = getDocumentDirectory();
      const targetDir = currentFolder ? `${root}${currentFolder}/${trimmed}` : `${root}${trimmed}`;
      await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
      setFolderDialogVisible(false);
      setFolderName('');
      loadFiles();
    } catch {
      Alert.alert('Lỗi', 'Không thể tạo thư mục.');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getItemVisual = (item: DocumentItem) => {
    if (item.isDirectory) {
      return { icon: 'folder', color: '#ffa000', label: 'Thư mục', bg: '#ffa00020' };
    }
    if (item.name.endsWith('.pdf')) {
      return { icon: 'document', color: theme.warn, label: 'Tài liệu PDF', bg: theme.warn + '20' };
    }
    if (item.name.endsWith('.docx')) {
      return { icon: 'document-text', color: theme.blue, label: 'Văn bản Word', bg: theme.blue + '20' };
    }
    if (item.name.endsWith('.xlsx')) {
      return { icon: 'stats-chart', color: theme.green, label: 'Bảng tính Excel', bg: theme.green + '20' };
    }
    return { icon: 'document-outline', color: theme.textSub, label: 'Tập tin', bg: theme.border };
  };

  const handleItemPress = (item: DocumentItem) => {
    if (item.isDirectory) {
      // Mở thư mục con
      const nextPath = currentFolder ? `${currentFolder}/${item.name}` : item.name;
      setCurrentFolder(nextPath);
    } else {
      // Chia sẻ hoặc xem
      handleShareFile(item);
    }
  };

  const handleGoBackFolder = () => {
    if (!currentFolder) return;
    const parts = currentFolder.split('/');
    parts.pop();
    setCurrentFolder(parts.join('/'));
  };

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <View style={[s.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: theme.headerText }]}>Tài liệu</Text>
          {currentFolder ? (
            <Text style={{ fontSize: 12, color: theme.accent, marginTop: 2 }} numberOfLines={1}>
              📂 /{currentFolder}
            </Text>
          ) : null}
        </View>

        <View style={s.headerActions}>
          {[
            { icon: 'images-outline', action: handleImportImage, tip: 'Nhập ảnh' },
            { icon: 'document-attach-outline', action: handleImportPdf, tip: 'Nhập PDF' },
            { icon: 'folder-open-outline', action: () => { setFolderName('Thư mục mới'); setFolderDialogVisible(true); }, tip: 'Tạo thư mục' },
          ].map((btn, i) => (
            <TouchableOpacity key={i} style={[s.headerBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={btn.action}>
              <Ionicons name={btn.icon as any} size={20} color={theme.text} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Search & Breadcrumb Bar */}
      <View style={[s.searchBarContainer, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <View style={[s.searchBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Ionicons name="search" size={18} color={theme.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={[s.searchInput, { color: theme.text }]}
            placeholder="Tìm kiếm tài liệu..."
            placeholderTextColor={theme.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {currentFolder ? (
          <TouchableOpacity style={[s.backBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={handleGoBackFolder}>
            <Ionicons name="arrow-up" size={18} color={theme.accent} />
            <Text style={[s.backBtnText, { color: theme.accent }]}>Lên thư mục cha</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* File List */}
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {filteredItems.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="documents-outline" size={52} color={theme.textMuted} />
            <Text style={[s.emptyText, { color: theme.textMuted }]}>
              {searchQuery ? 'Không tìm thấy tài liệu phù hợp.' : 'Thư mục này đang trống.'}
            </Text>
          </View>
        ) : (
          filteredItems.map((item, index) => {
            const visual = getItemVisual(item);
            const sizeStr = formatFileSize(item.size);

            return (
              <TouchableOpacity
                key={item.id || index}
                style={[s.fileItem, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => handleItemPress(item)}
                activeOpacity={0.7}
              >
                <View style={[s.fileIconBg, { backgroundColor: visual.bg }]}>
                  <Ionicons name={visual.icon as any} size={24} color={visual.color} />
                </View>

                <View style={s.fileInfo}>
                  <Text style={[s.fileName, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[s.fileMeta, { color: theme.textSub }]}>
                    {visual.label} {sizeStr ? `• ${sizeStr}` : ''}
                  </Text>
                </View>

                {!item.isDirectory && (
                  <TouchableOpacity onPress={() => handleShareFile(item)} style={[s.iconBtn, { backgroundColor: theme.surface }]}>
                    <Ionicons name="share-social" size={18} color={theme.blue} />
                  </TouchableOpacity>
                )}

                <TouchableOpacity onPress={() => handleDeleteItem(item)} style={[s.iconBtn, { backgroundColor: theme.surface }]}>
                  <Ionicons name="trash" size={18} color={theme.danger} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Create Folder Modal */}
      <Modal visible={folderDialogVisible} animationType="fade" transparent>
        <View style={s.modalBg}>
          <View style={[s.dialog, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[s.dialogTitle, { color: theme.text }]}>Tạo thư mục mới</Text>
            <TextInput
              style={[s.dialogInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
              value={folderName}
              onChangeText={setFolderName}
              placeholder="Nhập tên thư mục"
              placeholderTextColor={theme.textMuted}
              autoFocus
            />
            <View style={s.dialogActions}>
              <TouchableOpacity style={[s.dialogBtn, { backgroundColor: theme.surface }]} onPress={() => setFolderDialogVisible(false)}>
                <Text style={{ color: theme.textSub, fontWeight: '600' }}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.dialogBtn, { backgroundColor: theme.accent }]} onPress={doCreateFolder}>
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Tạo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 54 : 44,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 24, fontWeight: 'bold' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  content: { padding: 16, paddingBottom: 50 },
  emptyCard: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginTop: 30,
  },
  emptyText: { marginTop: 12, fontSize: 15, fontWeight: '500' },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  fileIconBg: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 15, fontWeight: '600', marginBottom: 3 },
  fileMeta: { fontSize: 12 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    elevation: 5,
  },
  dialogTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  dialogInput: {
    height: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 20,
  },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  dialogBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
});
