import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { getDocumentDirectory, copyFileToDocuments, listDocumentFiles } from '../utils/fileHelper';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme';

export default function FilesScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const [files, setFiles] = useState<string[]>([]);
  const [folderDialogVisible, setFolderDialogVisible] = useState(false);
  const [folderName, setFolderName] = useState('');

  const loadFiles = async () => {
    try {
      const supported = await listDocumentFiles(['.pdf', '.docx', '.xlsx']);
      setFiles(supported);
    } catch (e) {
      console.log('[UI] Error loading files', e);
    }
  };

  useFocusEffect(useCallback(() => { loadFiles(); }, []));

  const handleShareFile = async (fileName: string) => {
    try {
      const uri = getDocumentDirectory() + fileName;
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {
      Alert.alert('Lỗi', 'Không thể chia sẻ file');
    }
  };

  const handleDeleteFile = (fileName: string) => {
    Alert.alert('Xác nhận', `Xoá ${fileName}?`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa', style: 'destructive',
        onPress: async () => {
          try {
            const uri = getDocumentDirectory() + fileName;
            const info = await FileSystem.getInfoAsync(uri);
            if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
            loadFiles();
          } catch {
            Alert.alert('Lỗi', 'Không thể xóa file');
          }
        }
      }
    ]);
  };

  const handleImportImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, allowsMultipleSelection: true, quality: 1 });
    if (!result.canceled && result.assets?.length > 0) {
      navigation.navigate('Scanner', { importImages: result.assets.map(a => a.uri) });
    }
  };

  const handleImportPdf = async () => {
    try {
      let result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
      if (!result.canceled && result.assets?.length > 0) {
        const { uri: sourceUri, name: originalName } = result.assets[0];
        const safeName = (originalName || 'PDF_' + Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_').replace('.pdf', '');
        const targetUri = await copyFileToDocuments(sourceUri, safeName + '.pdf');
        Alert.alert('✅ Thành công', `Đã nhập: ${safeName}.pdf`);
        loadFiles();
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể chọn file PDF.');
    }
  };

  const doCreateFolder = async () => {
    if (!folderName.trim()) { Alert.alert('Lỗi', 'Vui lòng nhập tên thư mục'); return; }
    try {
      const folderPath = getDocumentDirectory() + folderName.trim().replace(/[^a-zA-Z0-9_\-À-ÿ\s]/g, '_');
      await FileSystem.makeDirectoryAsync(folderPath, { intermediates: true });
      setFolderDialogVisible(false);
      loadFiles();
    } catch {
      Alert.alert('Lỗi', 'Không thể tạo thư mục');
    }
  };

  const getFileInfo = (name: string) => {
    if (name.endsWith('.pdf'))  return { icon: 'document',      color: theme.warn,   label: 'PDF Document',     bg: theme.warn  + '20' };
    if (name.endsWith('.docx')) return { icon: 'document-text', color: theme.blue,   label: 'Word Document',    bg: theme.blue  + '20' };
    if (name.endsWith('.xlsx')) return { icon: 'stats-chart',   color: theme.green,  label: 'Excel Spreadsheet',bg: theme.green + '20' };
    return                             { icon: 'folder',        color: '#ffa000',    label: 'Thư mục',          bg: '#ffa00020' };
  };

  const isDir = (name: string) => !name.includes('.');

  return (
    <View style={[s.container, { backgroundColor: theme.bg }]}>
      <View style={[s.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
        <Text style={[s.headerTitle, { color: theme.headerText }]}>Tài liệu</Text>
        <View style={s.headerActions}>
          {[
            { icon: 'images-outline',          action: handleImportImage,                       tip: 'Nhập ảnh' },
            { icon: 'document-attach-outline', action: handleImportPdf,                         tip: 'Nhập PDF' },
            { icon: 'folder-open-outline',     action: () => { setFolderName('Thư mục mới'); setFolderDialogVisible(true); }, tip: 'Tạo thư mục' },
          ].map((btn, i) => (
            <TouchableOpacity key={i} style={[s.headerBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={btn.action}>
              <Ionicons name={btn.icon as any} size={20} color={theme.text} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {files.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="documents-outline" size={52} color={theme.textMuted} />
            <Text style={[s.emptyText, { color: theme.textMuted }]}>Chưa có tài liệu nào.</Text>
          </View>
        ) : (
          files.map((file, index) => {
            const info = getFileInfo(file);
            const dir = isDir(file);
            return (
              <View key={index} style={[s.fileItem, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={[s.fileIconBg, { backgroundColor: info.bg }]}>
                  <Ionicons name={info.icon as any} size={24} color={info.color} />
                </View>
                <View style={s.fileInfo}>
                  <Text style={[s.fileName, { color: theme.text }]} numberOfLines={1}>{file}</Text>
                  <Text style={[s.fileMeta, { color: theme.textSub }]}>{info.label}</Text>
                </View>
                {!dir && (
                  <TouchableOpacity onPress={() => handleShareFile(file)} style={[s.iconBtn, { backgroundColor: theme.surface }]}>
                    <Ionicons name="share-social" size={20} color={theme.blue} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => handleDeleteFile(file)} style={[s.iconBtn, { backgroundColor: theme.surface }]}>
                  <Ionicons name="trash" size={20} color={theme.danger} />
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={folderDialogVisible} animationType="fade" transparent>
        <View style={s.modalBg}>
          <View style={[s.dialog, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[s.dialogTitle, { color: theme.text }]}>Tạo thư mục mới</Text>
            <TextInput
              style={[s.dialogInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
              value={folderName} onChangeText={setFolderName}
              placeholder="Nhập tên thư mục" placeholderTextColor={theme.textMuted} autoFocus
            />
            <View style={s.dialogActions}>
              <TouchableOpacity style={[s.dialogBtn, { backgroundColor: theme.surface }]} onPress={() => setFolderDialogVisible(false)}>
                <Text style={[s.btnCancel, { color: theme.textSub }]}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.dialogBtn, { backgroundColor: '#ffa000' }]} onPress={doCreateFolder}>
                <Text style={s.btnConfirm}>Tạo</Text>
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
    paddingTop: 56, paddingBottom: 18, paddingHorizontal: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 4,
  },
  headerTitle: { fontSize: 26, fontWeight: '900', letterSpacing: -0.3 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: { padding: 9, borderRadius: 12, borderWidth: 1 },
  content: { padding: 16, paddingBottom: 30 },
  emptyCard: { borderRadius: 20, padding: 48, alignItems: 'center', borderWidth: 1, marginTop: 20 },
  emptyText: { marginTop: 14, fontSize: 15 },
  fileItem: {
    flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, marginBottom: 10,
    borderWidth: 1, elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3,
  },
  fileIconBg: { width: 46, height: 46, borderRadius: 13, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  fileMeta: { fontSize: 12 },
  iconBtn: { padding: 9, borderRadius: 12, marginLeft: 6 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  dialog: { width: '88%', borderRadius: 24, padding: 24, borderWidth: 1 },
  dialogTitle: { fontSize: 20, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
  dialogInput: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16 },
  dialogActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  dialogBtn: { flex: 1, padding: 15, borderRadius: 12, alignItems: 'center' },
  btnCancel: { fontWeight: '700', fontSize: 15 },
  btnConfirm: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
