import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, Modal,
  TextInput, Platform, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import {
  getDocumentDirectory, copyFileToDocuments, listDocumentItems,
  DocumentItem, sanitizeFileName, removeDocumentOcrText, renameDocumentOcrText
} from '../utils/fileHelper';
import { signInWithGoogle, uploadToGoogleDrive } from '../utils/googleSync';
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
  const [syncingGoogle, setSyncingGoogle] = useState(false);

  // File action modal & rename
  const [selectedItem, setSelectedItem] = useState<DocumentItem | null>(null);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');

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

  const handleOpenFile = async (item: DocumentItem) => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(item.uri, {
          dialogTitle: `Mở tài liệu: ${item.name}`,
          mimeType: item.name.endsWith('.pdf')
            ? 'application/pdf'
            : item.name.endsWith('.docx')
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : item.name.endsWith('.xlsx')
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : undefined,
        });
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể mở tài liệu.');
    }
  };

  const handleShareFile = async (item: DocumentItem) => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(item.uri, { dialogTitle: `Chia sẻ: ${item.name}` });
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể chia sẻ file.');
    }
  };

  const handleUploadToGoogleDrive = async (item: DocumentItem) => {
    try {
      setSyncingGoogle(true);
      const token = await signInWithGoogle();
      if (!token) {
        setSyncingGoogle(false);
        return;
      }
      const mimeType = item.name.endsWith('.pdf')
        ? 'application/pdf'
        : item.name.endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : item.name.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/octet-stream';

      await uploadToGoogleDrive(token, item.uri, mimeType, item.name);
      setSyncingGoogle(false);
      Alert.alert('✅ Thành công', `Đã tải tập tin "${item.name}" lên Google Drive an toàn!`);
    } catch (e: any) {
      setSyncingGoogle(false);
      Alert.alert('Lỗi tải lên', e.message || 'Không thể upload lên Google Drive.');
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
            await removeDocumentOcrText(item.name);
            setActionModalVisible(false);
            setSelectedItem(null);
            loadFiles();
          } catch {
            Alert.alert('Lỗi', `Không thể xóa ${isFolder ? 'thư mục' : 'tập tin'}.`);
          }
        }
      }
    ]);
  };

  const handleStartRename = (item: DocumentItem) => {
    setSelectedItem(item);
    setActionModalVisible(false);
    const lastDot = item.name.lastIndexOf('.');
    setRenameValue(lastDot !== -1 ? item.name.substring(0, lastDot) : item.name);
    setRenameDialogVisible(true);
  };

  const handleConfirmRename = async () => {
    if (!selectedItem || !renameValue.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên tài liệu hợp lệ.');
      return;
    }
    try {
      const lastDot = selectedItem.name.lastIndexOf('.');
      const ext = lastDot !== -1 ? selectedItem.name.substring(lastDot) : '';
      const cleanName = renameValue.trim().replace(/[^\p{L}\p{N}_\-\s]/gu, '');
      if (!cleanName) {
        Alert.alert('Lỗi', 'Vui lòng nhập tên tài liệu hợp lệ.');
        return;
      }
      let finalFileName = cleanName + ext;
      if (finalFileName === selectedItem.name) {
        setRenameDialogVisible(false);
        setSelectedItem(null);
        return;
      }

      const root = getDocumentDirectory();
      const targetDir = currentFolder ? `${root}${currentFolder}/` : root;
      let targetUri = targetDir + finalFileName;

      let fileInfo = await FileSystem.getInfoAsync(targetUri);
      let counter = 1;
      while (fileInfo.exists) {
        finalFileName = `${cleanName}_${counter}${ext}`;
        targetUri = targetDir + finalFileName;
        fileInfo = await FileSystem.getInfoAsync(targetUri);
        counter++;
      }

      await FileSystem.moveAsync({ from: selectedItem.uri, to: targetUri });
      await renameDocumentOcrText(selectedItem.name, finalFileName);
      setRenameDialogVisible(false);
      setSelectedItem(null);
      loadFiles();
      Alert.alert('✅ Thành công', `Đã đổi tên thành "${finalFileName}"`);
    } catch {
      Alert.alert('Lỗi', 'Không thể đổi tên file.');
    }
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
        const safeName = sanitizeFileName((originalName || 'PDF_' + Date.now()).replace(/\.pdf$/i, ''), 'PDF');
        await copyFileToDocuments(sourceUri, safeName + '.pdf', currentFolder);
        Alert.alert('✅ Thành công', `Đã nhập tài liệu: ${safeName}.pdf`);
        loadFiles();
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể chọn file PDF.');
    }
  };

  const doCreateFolder = async () => {
    const trimmed = sanitizeFileName(folderName.trim(), '');
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
      // Mở menu thao tác tài liệu
      setSelectedItem(item);
      setActionModalVisible(true);
    }
  };

  const handleGoBackFolder = () => {
    if (!currentFolder) return;
    const parts = currentFolder.split('/');
    parts.pop();
    setCurrentFolder(parts.join('/'));
  };

  const trimmedQuery = searchQuery.toLowerCase().trim();
  const filteredItems = items.filter(item => {
    if (!trimmedQuery) return true;
    const nameMatch = item.name.toLowerCase().includes(trimmedQuery);
    const ocrMatch = item.ocrText && item.ocrText.toLowerCase().includes(trimmedQuery);
    return nameMatch || ocrMatch;
  });

  const getOcrSnippet = (text: string, query: string): string => {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);
    if (idx === -1) return text.substring(0, 45).replace(/[\r\n]+/g, ' ');
    const start = Math.max(0, idx - 15);
    const end = Math.min(text.length, idx + query.length + 25);
    return text.substring(start, end).replace(/[\r\n]+/g, ' ');
  };

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
            placeholder="Tìm kiếm theo tên hoặc nội dung chữ..."
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
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id || item.uri}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={5}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={[s.emptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="documents-outline" size={52} color={theme.textMuted} />
            <Text style={[s.emptyText, { color: theme.textMuted }]}>
              {searchQuery ? 'Không tìm thấy tài liệu phù hợp tên hoặc nội dung.' : 'Thư mục này đang trống.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const visual = getItemVisual(item);
          const sizeStr = formatFileSize(item.size);

          return (
            <TouchableOpacity
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
                {trimmedQuery.length > 0 && item.ocrText && item.ocrText.toLowerCase().includes(trimmedQuery) && (
                  <Text style={[s.ocrSnippet, { color: theme.accent }]} numberOfLines={1}>
                    🔍 Khớp nội dung: "{getOcrSnippet(item.ocrText, trimmedQuery)}"
                  </Text>
                )}
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
        }}
      />

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

      {/* File Action Modal */}
      <Modal visible={actionModalVisible} animationType="slide" transparent>
        <TouchableOpacity
          style={s.modalBg}
          activeOpacity={1}
          onPress={() => setActionModalVisible(false)}
        >
          <View style={[s.actionSheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
            {selectedItem && (
              <>
                <View style={s.actionHeader}>
                  <View style={[s.fileIconBg, { backgroundColor: getItemVisual(selectedItem).bg, marginRight: 12 }]}>
                    <Ionicons name={getItemVisual(selectedItem).icon as any} size={24} color={getItemVisual(selectedItem).color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.actionFileName, { color: theme.text }]} numberOfLines={1}>
                      {selectedItem.name}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.textSub, marginTop: 2 }}>
                      {getItemVisual(selectedItem).label} • {formatFileSize(selectedItem.size)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setActionModalVisible(false)}>
                    <Ionicons name="close" size={24} color={theme.textSub} />
                  </TouchableOpacity>
                </View>

                <View style={[s.actionDivider, { backgroundColor: theme.border }]} />

                <TouchableOpacity
                  style={s.actionRow}
                  onPress={() => {
                    setActionModalVisible(false);
                    handleOpenFile(selectedItem);
                  }}
                >
                  <View style={[s.actionRowIcon, { backgroundColor: theme.accent + '20' }]}>
                    <Ionicons name="eye-outline" size={20} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.actionRowText, { color: theme.text }]}>Mở / Xem tài liệu</Text>
                    <Text style={{ fontSize: 12, color: theme.textSub }}>Xem nội dung hoặc mở bằng ứng dụng mặc định</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.actionRow}
                  onPress={() => {
                    setActionModalVisible(false);
                    handleShareFile(selectedItem);
                  }}
                >
                  <View style={[s.actionRowIcon, { backgroundColor: theme.blue + '20' }]}>
                    <Ionicons name="share-social-outline" size={20} color={theme.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.actionRowText, { color: theme.text }]}>Chia sẻ tập tin</Text>
                    <Text style={{ fontSize: 12, color: theme.textSub }}>Gửi qua Zalo, Mail, Bluetooth, Tin nhắn...</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                </TouchableOpacity>

                {!selectedItem.isDirectory && (
                  <TouchableOpacity
                    style={s.actionRow}
                    onPress={() => {
                      setActionModalVisible(false);
                      handleUploadToGoogleDrive(selectedItem);
                    }}
                    disabled={syncingGoogle}
                  >
                    <View style={[s.actionRowIcon, { backgroundColor: theme.green + '20' }]}>
                      {syncingGoogle ? (
                        <ActivityIndicator size="small" color={theme.green} />
                      ) : (
                        <Ionicons name="cloud-upload-outline" size={20} color={theme.green} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.actionRowText, { color: theme.text }]}>Tải lên Google Drive</Text>
                      <Text style={{ fontSize: 12, color: theme.textSub }}>Sao lưu đám mây an toàn với tài khoản Google</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={s.actionRow}
                  onPress={() => handleStartRename(selectedItem)}
                >
                  <View style={[s.actionRowIcon, { backgroundColor: '#ff980020' }]}>
                    <Ionicons name="create-outline" size={20} color="#ff9800" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.actionRowText, { color: theme.text }]}>Đổi tên tài liệu</Text>
                    <Text style={{ fontSize: 12, color: theme.textSub }}>Thay đổi tên hiển thị của tập tin</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.actionRow}
                  onPress={() => handleDeleteItem(selectedItem)}
                >
                  <View style={[s.actionRowIcon, { backgroundColor: theme.danger + '20' }]}>
                    <Ionicons name="trash-outline" size={20} color={theme.danger} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.actionRowText, { color: theme.danger }]}>Xóa tài liệu</Text>
                    <Text style={{ fontSize: 12, color: theme.textSub }}>Xóa vĩnh viễn khỏi bộ nhớ máy</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={renameDialogVisible} animationType="fade" transparent>
        <View style={s.modalBg}>
          <View style={[s.dialog, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[s.dialogTitle, { color: theme.text }]}>Đổi tên tài liệu</Text>
            <TextInput
              style={[s.dialogInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Nhập tên mới"
              placeholderTextColor={theme.textMuted}
              autoFocus
              selectTextOnFocus
            />
            <View style={s.dialogActions}>
              <TouchableOpacity style={[s.dialogBtn, { backgroundColor: theme.surface }]} onPress={() => setRenameDialogVisible(false)}>
                <Text style={{ color: theme.textSub, fontWeight: '600' }}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.dialogBtn, { backgroundColor: theme.accent }]} onPress={handleConfirmRename}>
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Lưu</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s: any = StyleSheet.create({
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
  ocrSnippet: {
    fontSize: 12,
    marginTop: 3,
    fontStyle: 'italic',
  },
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
  actionSheet: {
    width: '100%',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    elevation: 8,
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionFileName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  actionDivider: {
    height: 1,
    marginVertical: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  actionRowIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionRowText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
