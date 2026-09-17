import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { getDocumentDirectory } from '../utils/fileHelper';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import Storage from '../utils/storage';
import { useTheme } from '../theme';
// QRCode, XLSX: lazy-loaded trong từng hàm để tránh crash khởi động

const { width } = Dimensions.get('window');
const STORAGE_KEY = '@camscanner_qr_history_v1';

interface HistoryItem {
  id: string;
  text: string;
  createdAt: number;
  dataUrl: string;
}

const COLOR_PRESETS = [
  { label: 'Đen', fg: '#000000', bg: '#ffffff' },
  { label: 'Xanh dương', fg: '#0066cc', bg: '#f0f7ff' },
  { label: 'Xanh lá', fg: '#1b8a3e', bg: '#f0fff4' },
  { label: 'Tím', fg: '#7c3aed', bg: '#f5f3ff' },
  { label: 'Đỏ', fg: '#dc2626', bg: '#fef2f2' },
];

const ECC_LEVELS: Array<{ label: string; value: 'L' | 'M' | 'Q' | 'H'; desc: string }> = [
  { label: 'Thấp (L)', value: 'L', desc: 'Sửa lỗi 7%' },
  { label: 'Trung bình (M)', value: 'M', desc: 'Sửa lỗi 15%' },
  { label: 'Cao (Q)', value: 'Q', desc: 'Sửa lỗi 25%' },
  { label: 'Rất cao (H)', value: 'H', desc: 'Sửa lỗi 30%' },
];

// Helper: Hex color to RGB
function hexToRgb(hex: string): [number, number, number] {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((char) => char + char).join('');
  const num = parseInt(c, 16) || 0;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Pure JS Base64 encoder for Uint8Array (works cross-platform without canvas/btoa)
function uint8ToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;

    const triplet = (b1 << 16) | (b2 << 8) | b3;

    base64 += chars[(triplet >> 18) & 63];
    base64 += chars[(triplet >> 12) & 63];
    base64 += i + 1 < len ? chars[(triplet >> 6) & 63] : '=';
    base64 += i + 2 < len ? chars[triplet & 63] : '=';
  }
  return base64;
}

// Pure JS BMP QR Code Generator (Zero native dependencies, 100% reliable)
function generateBmpQrUrl(
  text: string,
  fgHex: string = '#000000',
  bgHex: string = '#ffffff',
  ecc: 'L' | 'M' | 'Q' | 'H' = 'M',
  scale: number = 6,
  margin: number = 2
): string {
  const QRCode = require('qrcode');
  const qr = QRCode.create(text, { errorCorrectionLevel: ecc });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const fullSize = size + margin * 2;
  const imgWidth = fullSize * scale;
  const imgHeight = fullSize * scale;

  const [fgR, fgG, fgB] = hexToRgb(fgHex);
  const [bgR, bgG, bgB] = hexToRgb(bgHex);

  const rowSize = Math.floor((24 * imgWidth + 31) / 32) * 4;
  const pixelDataSize = rowSize * imgHeight;
  const fileSize = 54 + pixelDataSize;

  const buf = new Uint8Array(fileSize);
  buf[0] = 0x42; // 'B'
  buf[1] = 0x4d; // 'M'
  buf[2] = fileSize & 0xff;
  buf[3] = (fileSize >> 8) & 0xff;
  buf[4] = (fileSize >> 16) & 0xff;
  buf[5] = (fileSize >> 24) & 0xff;
  buf[10] = 54;
  buf[14] = 40;
  buf[18] = imgWidth & 0xff;
  buf[19] = (imgWidth >> 8) & 0xff;
  buf[20] = (imgWidth >> 16) & 0xff;
  buf[21] = (imgWidth >> 24) & 0xff;
  const negHeight = -imgHeight;
  buf[22] = negHeight & 0xff;
  buf[23] = (negHeight >> 8) & 0xff;
  buf[24] = (negHeight >> 16) & 0xff;
  buf[25] = (negHeight >> 24) & 0xff;
  buf[26] = 1;
  buf[28] = 24;
  buf[34] = pixelDataSize & 0xff;
  buf[35] = (pixelDataSize >> 8) & 0xff;
  buf[36] = (pixelDataSize >> 16) & 0xff;
  buf[37] = (pixelDataSize >> 24) & 0xff;

  for (let y = 0; y < imgHeight; y++) {
    const qrY = Math.floor(y / scale) - margin;
    const rowOffset = 54 + y * rowSize;
    for (let x = 0; x < imgWidth; x++) {
      const qrX = Math.floor(x / scale) - margin;
      let isDark = false;
      if (qrY >= 0 && qrY < size && qrX >= 0 && qrX < size) {
        isDark = Boolean(data[qrY * size + qrX]);
      }
      const r = isDark ? fgR : bgR;
      const g = isDark ? fgG : bgG;
      const b = isDark ? fgB : bgB;

      const pxOffset = rowOffset + x * 3;
      buf[pxOffset] = b;
      buf[pxOffset + 1] = g;
      buf[pxOffset + 2] = r;
    }
  }

  return 'data:image/bmp;base64,' + uint8ToBase64(buf);
}

export default function QRGeneratorScreen({ navigation }: any) {
  const { theme } = useTheme();

  const [inputText, setInputText] = useState('WIFI:S:MyNetwork;T:WPA;P:MyPassword;;');
  const [selectedColor, setSelectedColor] = useState(COLOR_PRESETS[0]);
  const [ecc, setEcc] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'generator' | 'history'>('generator');

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  // Generate QR whenever text, color, or ecc changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputText.trim().length > 0) {
        handleCreateQR(inputText.trim(), false);
      } else {
        setQrDataUrl('');
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputText, selectedColor, ecc]);

  const loadHistory = async () => {
    try {
      const raw = await Storage.getItem(STORAGE_KEY);
      if (raw) {
        setHistory(JSON.parse(raw));
      }
    } catch (e) {
      console.log('Error loading QR history', e);
    }
  };

  const saveToHistory = async (text: string, dataUrl: string) => {
    try {
      const newItem: HistoryItem = {
        id: Date.now().toString(),
        text,
        createdAt: Date.now(),
        dataUrl,
      };

      const updated = [newItem, ...history.filter((h) => h.text !== text)].slice(0, 30);
      setHistory(updated);
      await Storage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.log('Error saving history', e);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      const updated = history.filter((item) => item.id !== id);
      setHistory(updated);
      await Storage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.log('Error deleting history item', e);
    }
  };

  const clearAllHistory = () => {
    Alert.alert('Xóa lịch sử', 'Bạn có chắc chắn muốn xóa toàn bộ lịch sử tạo mã QR?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa tất cả',
        style: 'destructive',
        onPress: async () => {
          setHistory([]);
          await Storage.removeItem(STORAGE_KEY);
        },
      },
    ]);
  };

  const handleCreateQR = (textToEncode: string, showAlertOnEmpty: boolean = true) => {
    const trimmed = textToEncode.trim();
    if (!trimmed) {
      setQrDataUrl('');
      if (showAlertOnEmpty) {
        Alert.alert('Thông báo', 'Vui lòng nhập văn bản hoặc chọn file Excel trước khi tạo mã QR.');
      }
      return;
    }

    setIsGenerating(true);
    try {
      const url = generateBmpQrUrl(trimmed, selectedColor.fg, selectedColor.bg, ecc);
      setQrDataUrl(url);
      saveToHistory(trimmed, url);
    } catch (err) {
      console.log('QR generation failed', err);
      Alert.alert('Lỗi', 'Không thể tạo mã QR cho đoạn văn bản này.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) {
        setInputText(text.trim());
      } else {
        Alert.alert('Thông báo', 'Bộ nhớ tạm không có nội dung văn bản.');
      }
    } catch (e) {
      Alert.alert('Lỗi', 'Không thể đọc nội dung từ khay nhớ tạm.');
    }
  };

  const handlePickExcelFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const file = res.assets[0];
        const fileUri = file.uri;

        const b64 = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const XLSX = require('xlsx');
        const workbook = XLSX.read(b64, { type: 'base64' });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          Alert.alert('Lỗi', 'File Excel không chứa sheet nào.');
          return;
        }

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const csvText = XLSX.utils.sheet_to_csv(worksheet);

        if (csvText && csvText.trim()) {
          let textToUse = csvText.trim();
          if (textToUse.length > 2500) {
            Alert.alert(
              '⚠️ Cảnh báo dung lượng',
              `Dữ liệu file Excel (${file.name}) khá lớn. Ứng dụng đã trích xuất 2,500 ký tự đầu tiên để đảm bảo mã QR dễ quét.`
            );
            textToUse = textToUse.substring(0, 2500);
          } else {
            Alert.alert('✅ Đã trích xuất', `Đã nhập dữ liệu thành công từ file "${file.name}" (Sheet: ${firstSheetName}).`);
          }
          setInputText(textToUse);
        } else {
          Alert.alert('Thông báo', 'File Excel được chọn không chứa dữ liệu.');
        }
      }
    } catch (e: any) {
      console.log('Error reading Excel file:', e);
      Alert.alert('Lỗi', 'Không thể đọc dữ liệu từ tệp Excel này.');
    }
  };

  const handleSaveImage = async () => {
    if (!qrDataUrl) {
      Alert.alert('Chưa có mã QR', 'Vui lòng nhập văn bản để tạo mã QR trước.');
      return;
    }

    try {
      const base64Data = qrDataUrl.includes('base64,')
        ? qrDataUrl.split('base64,')[1]
        : qrDataUrl;

      const filename = `QR_${Date.now()}.png`;
      const docDir = getDocumentDirectory();
      const fileUri = `${docDir}${filename}`;

      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          dialogTitle: 'Lưu hoặc Chia sẻ Mã QR',
          mimeType: 'image/png',
        });
      } else {
        Alert.alert('✅ Thành công', `Đã lưu ảnh mã QR vào thiết bị:\n${filename}`);
      }
    } catch (e: any) {
      console.log('Save QR image error', e);
      Alert.alert('Lỗi', `Không thể lưu/chia sẻ hình ảnh mã QR: ${e?.message || 'Có lỗi xảy ra'}`);
    }
  };

  const handleShareText = async () => {
    if (!inputText.trim()) return;
    try {
      await Clipboard.setStringAsync(inputText.trim());
      Alert.alert('✅ Đã sao chép', 'Đã sao chép nội dung văn bản vào khay nhớ tạm.');
    } catch {
      Alert.alert('Lỗi', 'Không thể sao chép văn bản.');
    }
  };

  const handleApplyTemplate = (type: 'url' | 'wifi' | 'phone' | 'email') => {
    let sample = '';
    if (type === 'url') sample = 'https://example.com';
    else if (type === 'wifi') sample = 'WIFI:S:MyNetwork;T:WPA;P:MyPassword;;';
    else if (type === 'phone') sample = 'tel:0912345678';
    else if (type === 'email') sample = 'mailto:contact@example.com?subject=Hello';

    setInputText(sample);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.headerText }]}>Tạo Mã QR</Text>
        <TouchableOpacity style={styles.headerRightBtn} onPress={() => navigation.navigate('QRScanner')}>
          <Ionicons name="qr-code-outline" size={22} color={theme.accent} />
          <Text style={[styles.headerRightText, { color: theme.accent }]}> Quét QR</Text>
        </TouchableOpacity>
      </View>

      {/* Navigation Sub-Tabs */}
      <View style={[styles.tabBar, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'generator' && { borderBottomColor: theme.accent }]}
          onPress={() => setActiveTab('generator')}
        >
          <Ionicons
            name="create-outline"
            size={18}
            color={activeTab === 'generator' ? theme.accent : theme.textMuted}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'generator' ? theme.accent : theme.textMuted },
            ]}
          >
            Tạo Mã QR
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'history' && { borderBottomColor: theme.accent }]}
          onPress={() => setActiveTab('history')}
        >
          <Ionicons
            name="time-outline"
            size={18}
            color={activeTab === 'history' ? theme.accent : theme.textMuted}
          />
          <Text
            style={[
              styles.tabText,
            { color: activeTab === 'history' ? theme.accent : theme.textMuted },
            ]}
          >
            Lịch sử ({history.length})
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'generator' ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Input Section */}
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>✏️ Nhập nội dung văn bản</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity style={[styles.pasteBtn, { marginRight: 10 }]} onPress={handlePickExcelFile}>
                  <Ionicons name="stats-chart-outline" size={16} color={theme.green} />
                  <Text style={[styles.pasteBtnText, { color: theme.green }]}>Nhập Excel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pasteBtn} onPress={handlePasteFromClipboard}>
                  <Ionicons name="clipboard-outline" size={16} color={theme.accent} />
                  <Text style={[styles.pasteBtnText, { color: theme.accent }]}>Dán</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              multiline
              numberOfLines={4}
              placeholder="Nhập bất kỳ văn bản, đường dẫn URL, số ĐT hoặc chọn file Excel..."
              placeholderTextColor={theme.textMuted}
              value={inputText}
              onChangeText={setInputText}
            />

            {inputText.length > 0 && (
              <View style={styles.inputFooter}>
                <Text style={[styles.charCount, { color: theme.textMuted }]}>
                  {inputText.length} ký tự
                </Text>
                <TouchableOpacity onPress={() => setInputText('')}>
                  <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>Xóa hết</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Quick Templates */}
            <Text style={[styles.subLabel, { color: theme.textSub, marginTop: 12 }]}>📌 Mẫu nhanh & Nhập Tệp:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.templateList}>
              <TouchableOpacity
                style={[styles.templateChip, { backgroundColor: theme.green + '18', borderColor: theme.green }]}
                onPress={handlePickExcelFile}
              >
                <Ionicons name="stats-chart" size={14} color={theme.green} />
                <Text style={[styles.templateChipText, { color: theme.green, fontWeight: '700' }]}> 📂 Chọn File Excel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.templateChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => handleApplyTemplate('url')}
              >
                <Ionicons name="link" size={14} color={theme.blue} />
                <Text style={[styles.templateChipText, { color: theme.text }]}> Website (URL)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.templateChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => handleApplyTemplate('wifi')}
              >
                <Ionicons name="wifi" size={14} color={theme.green} />
                <Text style={[styles.templateChipText, { color: theme.text }]}> Wi-Fi</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.templateChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => handleApplyTemplate('phone')}
              >
                <Ionicons name="call" size={14} color={theme.warn} />
                <Text style={[styles.templateChipText, { color: theme.text }]}> Số ĐT</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.templateChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={() => handleApplyTemplate('email')}
              >
                <Ionicons name="mail" size={14} color="#8e24aa" />
                <Text style={[styles.templateChipText, { color: theme.text }]}> Email</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Explicit Generate Button */}
            <TouchableOpacity
              style={[styles.generateSubmitBtn, { backgroundColor: theme.accent }]}
              onPress={() => handleCreateQR(inputText, true)}
              activeOpacity={0.8}
            >
              <Ionicons name="qr-code" size={20} color="#ffffff" />
              <Text style={styles.generateSubmitBtnText}> ⚡ TẠO MÃ QR NGAY</Text>
            </TouchableOpacity>
          </View>

          {/* Style Customization */}
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>🎨 Tùy chỉnh màu sắc & độ phân giải</Text>

            <Text style={[styles.subLabel, { color: theme.textSub }]}>Màu sắc mã QR:</Text>
            <View style={styles.colorRow}>
              {COLOR_PRESETS.map((item, idx) => {
                const isSelected = selectedColor.fg === item.fg;
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      styles.colorBadge,
                      { backgroundColor: item.fg },
                      isSelected && styles.colorBadgeSelected,
                    ]}
                    onPress={() => setSelectedColor(item)}
                  >
                    {isSelected && <Ionicons name="checkmark" size={16} color="#ffffff" />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.subLabel, { color: theme.textSub, marginTop: 12 }]}>
              Khả năng sửa lỗi (Error Correction):
            </Text>
            <View style={styles.eccRow}>
              {ECC_LEVELS.map((item) => {
                const isSelected = ecc === item.value;
                return (
                  <TouchableOpacity
                    key={item.value}
                    style={[
                      styles.eccChip,
                      { backgroundColor: isSelected ? theme.accent : theme.surface },
                      { borderColor: isSelected ? theme.accent : theme.border },
                    ]}
                    onPress={() => setEcc(item.value)}
                  >
                    <Text
                      style={[
                        styles.eccChipText,
                        { color: isSelected ? '#ffffff' : theme.text },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* QR Code Output Display Card */}
          <View style={[styles.card, styles.qrDisplayCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text, marginBottom: 12 }]}>🖼️ Mã QR Của Bạn</Text>

            {isGenerating ? (
              <View style={styles.qrPlaceholder}>
                <ActivityIndicator size="large" color={theme.accent} />
                <Text style={[styles.placeholderText, { color: theme.textMuted }]}>Đang tạo mã QR...</Text>
              </View>
            ) : qrDataUrl ? (
              <View style={styles.qrContainer}>
                <View style={[styles.qrWrapper, { backgroundColor: selectedColor.bg }]}>
                  <Image source={{ uri: qrDataUrl }} style={styles.qrImage} resizeMode="contain" />
                </View>

                {/* Actions */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { backgroundColor: theme.accent }]}
                    onPress={handleSaveImage}
                  >
                    <Ionicons name="share-outline" size={20} color="#ffffff" />
                    <Text style={styles.primaryActionText}> Lưu / Chia Sẻ QR</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.secondaryActionBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    onPress={handleShareText}
                  >
                    <Ionicons name="copy-outline" size={18} color={theme.text} />
                    <Text style={[styles.secondaryActionText, { color: theme.text }]}> Sao chép</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code-outline" size={64} color={theme.textMuted} />
                <Text style={[styles.placeholderText, { color: theme.textMuted }]}>
                  Nhập nội dung và bấm nút "⚡ TẠO MÃ QR NGAY" ở trên
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      ) : (
        /* History View */
        <View style={styles.historyContainer}>
          {history.length > 0 && (
            <View style={styles.historyHeader}>
              <Text style={[styles.historyCountText, { color: theme.textSub }]}>
                Đã lưu {history.length} mã QR gần đây
              </Text>
              <TouchableOpacity onPress={clearAllHistory}>
                <Text style={{ color: theme.danger, fontWeight: '600', fontSize: 13 }}>Xóa tất cả</Text>
              </TouchableOpacity>
            </View>
          )}

          {history.length === 0 ? (
            <View style={styles.emptyHistory}>
              <Ionicons name="time-outline" size={56} color={theme.textMuted} />
              <Text style={[styles.emptyHistoryText, { color: theme.textMuted }]}>
                Chưa có lịch sử tạo mã QR nào.{'\n'}Các mã QR bạn tạo sẽ tự động lưu tại đây.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {history.map((item) => (
                <View
                  key={item.id}
                  style={[styles.historyCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                >
                  <Image source={{ uri: item.dataUrl }} style={styles.historyThumb} />
                  <View style={styles.historyInfo}>
                    <Text style={[styles.historyText, { color: theme.text }]} numberOfLines={2}>
                      {item.text}
                    </Text>
                    <Text style={[styles.historyDate, { color: theme.textMuted }]}>
                      {new Date(item.createdAt).toLocaleString('vi-VN')}
                    </Text>
                  </View>
                  <View style={styles.historyActions}>
                    <TouchableOpacity
                      style={styles.historyIconBtn}
                      onPress={() => {
                        setInputText(item.text);
                        setActiveTab('generator');
                      }}
                    >
                      <Ionicons name="create-outline" size={20} color={theme.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.historyIconBtn}
                      onPress={() => deleteHistoryItem(item.id)}
                    >
                      <Ionicons name="trash-outline" size={20} color={theme.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerRightBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
  },
  headerRightText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  content: {
    padding: 16,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pasteBtnText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  textInput: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    textAlignVertical: 'top',
    minHeight: 90,
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  charCount: {
    fontSize: 12,
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  templateList: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  templateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  templateChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  generateSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  generateSubmitBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  colorBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorBadgeSelected: {
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  eccRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  eccChip: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  eccChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  qrDisplayCard: {
    alignItems: 'center',
  },
  qrPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  placeholderText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
  qrContainer: {
    alignItems: 'center',
    width: '100%',
  },
  qrWrapper: {
    padding: 16,
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    marginBottom: 16,
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  primaryActionBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  historyContainer: {
    flex: 1,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  historyCountText: {
    fontSize: 13,
  },
  emptyHistory: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyHistoryText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  historyThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  historyInfo: {
    flex: 1,
    marginLeft: 12,
  },
  historyText: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyDate: {
    fontSize: 11,
    marginTop: 4,
  },
  historyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyIconBtn: {
    padding: 6,
  },
});
