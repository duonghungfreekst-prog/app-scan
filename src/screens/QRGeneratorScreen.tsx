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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { getDocumentDirectory, saveBase64ToDocuments } from '../utils/fileHelper';
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

// CRC32 table & helper for pure JS PNG chunk generation
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function crc32(buf: Uint8Array): number {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const chunk = new Uint8Array(4 + 4 + len + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, len);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crcData = chunk.subarray(4, 8 + len);
  view.setUint32(8 + len, crc32(crcData));
  return chunk;
}

// Pure JS PNG QR Code Generator (Hỗ trợ tùy chọn độ phân giải cao scale 10 HD)
function generatePngQrUrl(
  text: string,
  fgHex: string = '#000000',
  bgHex: string = '#ffffff',
  ecc: 'L' | 'M' | 'Q' | 'H' = 'M',
  scale: number = 10,
  margin: number = 4
): string {
  const QRCode = require('qrcode');
  const pako = require('pako');

  let qr: any;
  const eccFallbackOrder: Array<'H' | 'Q' | 'M' | 'L'> =
    ecc === 'H' ? ['H', 'Q', 'M', 'L'] : ecc === 'Q' ? ['Q', 'M', 'L'] : [ecc];

  let lastErr: any = null;
  for (const level of eccFallbackOrder) {
    try {
      qr = QRCode.create(text, { errorCorrectionLevel: level });
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!qr) {
    throw new Error(lastErr?.message || 'The amount of data is too big to be stored in a QR code');
  }

  const size = qr.modules.size;
  const data = qr.modules.data;
  const fullSize = size + margin * 2;
  const width = fullSize * scale;
  const height = width;

  const [fgR, fgG, fgB] = hexToRgb(fgHex);
  const [bgR, bgG, bgB] = hexToRgb(bgHex);

  const rawRowLen = 1 + width * 3; // 1 byte filter (0: None) + 3 bytes RGB
  const rawData = new Uint8Array(rawRowLen * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rawRowLen;
    rawData[rowOffset] = 0; // Filter: None
    const qrY = Math.floor(y / scale) - margin;
    for (let x = 0; x < width; x++) {
      const qrX = Math.floor(x / scale) - margin;
      let isDark = false;
      if (qrY >= 0 && qrY < size && qrX >= 0 && qrX < size) {
        isDark = Boolean(data[qrY * size + qrX]);
      }
      const px = rowOffset + 1 + x * 3;
      rawData[px] = isDark ? fgR : bgR;
      rawData[px + 1] = isDark ? fgG : bgG;
      rawData[px + 2] = isDark ? fgB : bgB;
    }
  }

  const compressed = pako.deflate(rawData);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 2; // Color type: RGB
  ihdr[10] = 0; // Compression: deflate
  ihdr[11] = 0; // Filter: standard
  ihdr[12] = 0; // Interlace: none

  const ihdrChunk = createPngChunk('IHDR', ihdr);
  const idatChunk = createPngChunk('IDAT', compressed);
  const iendChunk = createPngChunk('IEND', new Uint8Array(0));

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const pngBuf = new Uint8Array(totalLen);

  let off = 0;
  pngBuf.set(sig, off); off += sig.length;
  pngBuf.set(ihdrChunk, off); off += ihdrChunk.length;
  pngBuf.set(idatChunk, off); off += idatChunk.length;
  pngBuf.set(iendChunk, off); off += iendChunk.length;

  return 'data:image/png;base64,' + uint8ToBase64(pngBuf);
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
  
  // Tự động fallback ECC nếu dữ liệu quá dài đối với mức sửa lỗi cao
  let qr: any;
  const eccFallbackOrder: Array<'H' | 'Q' | 'M' | 'L'> = ecc === 'H' ? ['H', 'Q', 'M', 'L'] : ecc === 'Q' ? ['Q', 'M', 'L'] : [ecc];
  
  let lastErr: any = null;
  for (const level of eccFallbackOrder) {
    try {
      qr = QRCode.create(text, { errorCorrectionLevel: level });
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!qr) {
    throw new Error(lastErr?.message || 'The amount of data is too big to be stored in a QR code');
  }

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

// Helper hàm tạo mã QR chung hỗ trợ tùy chọn định dạng và scale
function generateQrUrl(
  text: string,
  fgHex: string = '#000000',
  bgHex: string = '#ffffff',
  ecc: 'L' | 'M' | 'Q' | 'H' = 'M',
  format: 'png' | 'bmp' = 'png',
  scale: number = 10,
  margin: number = 4
): string {
  if (format === 'bmp') {
    return generateBmpQrUrl(text, fgHex, bgHex, ecc, scale, margin);
  }
  return generatePngQrUrl(text, fgHex, bgHex, ecc, scale, margin);
}

// Helper phân tích và sinh thông báo lỗi thân thiện khi dữ liệu quá dài
function getFriendlyQrErrorMessage(err: any, textLength: number): string {
  const msg = (err?.message || err?.toString() || '').toLowerCase();
  if (
    msg.includes('too big') ||
    msg.includes('amount of data') ||
    msg.includes('overflow') ||
    msg.includes('capacity') ||
    msg.includes('maximum size') ||
    textLength > 2000
  ) {
    return `Nội dung quá dài (${textLength.toLocaleString()} ký tự), vượt quá dung lượng lưu trữ tối đa của chuẩn mã QR. Vui lòng rút ngắn văn bản hoặc chuyển mức sửa lỗi sang "Thấp (L)".`;
  }
  return err?.message || 'Không thể tạo mã QR từ dữ liệu đã nhập.';
}

export default function QRGeneratorScreen({ navigation }: any) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [inputText, setInputText] = useState('WIFI:S:MyNetwork;T:WPA;P:MyPassword;;');
  const [selectedColor, setSelectedColor] = useState(COLOR_PRESETS[0]);
  const [ecc, setEcc] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [qrScale, setQrScale] = useState<number>(10); // Tùy chọn độ phân giải: scale 10 (HD siêu nét) hoặc scale 6
  const [exportFormat, setExportFormat] = useState<'png' | 'bmp'>('png');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrError, setQrError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'generator' | 'history'>('generator');

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  // Generate QR whenever text, color, ecc, format, or scale changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputText.trim().length > 0) {
        handleCreateQR(inputText.trim(), false);
      } else {
        setQrDataUrl('');
        setQrError(null);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [inputText, selectedColor, ecc, exportFormat, qrScale]);

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

  const handleCreateQR = (textToEncode: string, showAlertOnError: boolean = false) => {
    const trimmed = textToEncode.trim();
    if (!trimmed) {
      setQrDataUrl('');
      setQrError(null);
      if (showAlertOnError) {
        Alert.alert('Thông báo', 'Vui lòng nhập văn bản hoặc chọn file Excel trước khi tạo mã QR.');
      }
      return;
    }

    setIsGenerating(true);
    try {
      const url = generateQrUrl(
        trimmed,
        selectedColor.fg,
        selectedColor.bg,
        ecc,
        exportFormat,
        qrScale,
        exportFormat === 'bmp' ? 2 : 4
      );
      setQrDataUrl(url);
      setQrError(null);
      saveToHistory(trimmed, url);
    } catch (err: any) {
      console.log('QR generation failed', err);
      const friendlyMsg = getFriendlyQrErrorMessage(err, trimmed.length);
      setQrDataUrl('');
      setQrError(friendlyMsg);
      if (showAlertOnError) {
        Alert.alert(
          '⚠️ Nội dung quá dài',
          `${friendlyMsg}\n\n💡 Gợi ý khắc phục:\n• Rút ngắn độ dài nội dung văn bản.\n• Chuyển mức sửa lỗi sang "Thấp (L)" để có dung lượng chứa tối đa.\n• Sử dụng link rút gọn nếu là đường dẫn web.`
        );
      }
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
          if (textToUse.length > 2200) {
            Alert.alert(
              '⚠️ Cảnh báo dung lượng',
              `Dữ liệu file Excel (${file.name}) khá lớn (${textToUse.length} ký tự). Ứng dụng đã trích xuất 2,200 ký tự đầu tiên để đảm bảo mã QR dễ quét và không bị tràn dung lượng.`
            );
            textToUse = textToUse.substring(0, 2200);
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

  // Tạo ảnh PNG HD (Scale 10) chuẩn xác
  const getHighResPngDataUrl = (scale: number = 10): string => {
    const trimmed = inputText.trim();
    if (!trimmed) {
      throw new Error('Nội dung văn bản trống.');
    }
    return generatePngQrUrl(trimmed, selectedColor.fg, selectedColor.bg, ecc, scale, 4);
  };

  // Lưu ảnh vào documents/
  const handleSaveToDocuments = async (highRes: boolean = true) => {
    if (!inputText.trim()) {
      Alert.alert('Chưa có mã QR', 'Vui lòng nhập văn bản để tạo mã QR trước.');
      return;
    }

    try {
      const scaleToUse = highRes ? 10 : qrScale;
      // Nếu yêu cầu highRes hoặc đang ở định dạng PNG thì tạo PNG với scale tương ứng
      const dataUrl = highRes ? getHighResPngDataUrl(10) : qrDataUrl || getHighResPngDataUrl(qrScale);
      const base64Data = dataUrl.includes('base64,') ? dataUrl.split('base64,')[1] : dataUrl;
      const isBmp = dataUrl.startsWith('data:image/bmp');
      const ext = isBmp ? '.bmp' : '.png';
      const fileName = `QR_${highRes ? 'HD_' : ''}${Date.now()}${ext}`;

      const savedUri = await saveBase64ToDocuments(base64Data, fileName);
      const cleanFileName = savedUri.split('/').pop() || fileName;

      Alert.alert(
        '✅ Đã lưu vào Documents',
        `Đã lưu ảnh mã QR PNG độ phân giải cao (Scale ${scaleToUse}) thành công vào thư mục Documents của ứng dụng:\n${cleanFileName}\n\nBạn có muốn chia sẻ ảnh này ngay không?`,
        [
          { text: 'Xong', style: 'cancel' },
          {
            text: 'Chia sẻ ngay',
            onPress: async () => {
              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(savedUri, {
                  dialogTitle: `Chia sẻ Mã QR PNG HD (Scale ${scaleToUse})`,
                  mimeType: isBmp ? 'image/bmp' : 'image/png',
                });
              }
            },
          },
        ]
      );
    } catch (e: any) {
      console.log('Save to documents error', e);
      Alert.alert('Lỗi', `Không thể lưu hình ảnh vào Documents: ${e?.message || 'Có lỗi xảy ra'}`);
    }
  };

  // Chia sẻ ảnh mã QR (mặc định xuất PNG độ phân giải cao scale 10)
  const handleShareQr = async (highRes: boolean = true) => {
    if (!inputText.trim()) {
      Alert.alert('Chưa có mã QR', 'Vui lòng nhập văn bản để tạo mã QR trước.');
      return;
    }

    try {
      const scaleToUse = highRes ? 10 : qrScale;
      const dataUrl = highRes ? getHighResPngDataUrl(10) : qrDataUrl || getHighResPngDataUrl(qrScale);
      const base64Data = dataUrl.includes('base64,') ? dataUrl.split('base64,')[1] : dataUrl;
      const isBmp = dataUrl.startsWith('data:image/bmp');
      const ext = isBmp ? '.bmp' : '.png';
      const fileName = `QR_${highRes ? 'HD_' : ''}${Date.now()}${ext}`;

      const savedUri = await saveBase64ToDocuments(base64Data, fileName);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(savedUri, {
          dialogTitle: `Chia sẻ Mã QR PNG HD (Scale ${scaleToUse})`,
          mimeType: isBmp ? 'image/bmp' : 'image/png',
        });
      } else {
        Alert.alert('✅ Thành công', `Đã lưu ảnh mã QR vào thư mục Documents:\n${fileName}`);
      }
    } catch (e: any) {
      console.log('Share QR error', e);
      Alert.alert('Lỗi', `Không thể chia sẻ mã QR: ${e?.message || 'Có lỗi xảy ra'}`);
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
      {/* Header - Áp dụng useSafeAreaInsets() bỏ paddingTop cứng */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.headerBg,
            borderBottomColor: theme.border,
            paddingTop: Math.max(insets.top, 16) + 8,
          },
        ]}
      >
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
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 16) + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
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
                  borderColor: qrError ? theme.danger : theme.border,
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
                <Text
                  style={[
                    styles.charCount,
                    {
                      color:
                        inputText.length > 2200
                          ? theme.danger
                          : inputText.length > 1500
                          ? '#ea580c'
                          : theme.textMuted,
                      fontWeight: inputText.length > 1500 ? '600' : '400',
                    },
                  ]}
                >
                  {inputText.length} ký tự {inputText.length > 2000 ? '(Khá dài - có thể khó quét)' : ''}
                </Text>
                <TouchableOpacity onPress={() => setInputText('')}>
                  <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>Xóa hết</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Cảnh báo thân thiện khi chuỗi quá dài gây lỗi */}
            {qrError && (
              <View style={[styles.errorBanner, { backgroundColor: '#fef2f2', borderColor: '#fca5a5' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <Ionicons name="warning" size={18} color="#dc2626" />
                  <Text style={styles.errorBannerTitle}> Giới hạn dung lượng mã QR</Text>
                </View>
                <Text style={styles.errorBannerText}>{qrError}</Text>
                <View style={styles.errorBannerActions}>
                  {ecc !== 'L' && (
                    <TouchableOpacity
                      style={[styles.errorActionChip, { backgroundColor: '#fee2e2' }]}
                      onPress={() => setEcc('L')}
                    >
                      <Text style={styles.errorActionChipText}>⚡ Chuyển sang mức Thấp (L)</Text>
                    </TouchableOpacity>
                  )}
                  {inputText.length > 2000 && (
                    <TouchableOpacity
                      style={[styles.errorActionChip, { backgroundColor: '#fee2e2' }]}
                      onPress={() => setInputText((prev) => prev.substring(0, 2000))}
                    >
                      <Text style={styles.errorActionChipText}>✂️ Tự động cắt về 2,000 ký tự</Text>
                    </TouchableOpacity>
                  )}
                </View>
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

            {/* Tùy chọn Độ phân giải & Định dạng xuất ảnh (Hỗ trợ PNG Scale 10 HD) */}
            <Text style={[styles.subLabel, { color: theme.textSub, marginTop: 14 }]}>
              Độ phân giải & Định dạng xuất ảnh:
            </Text>
            <View style={styles.formatRow}>
              <TouchableOpacity
                style={[
                  styles.formatChip,
                  exportFormat === 'png' && qrScale === 10
                    ? { backgroundColor: theme.accent, borderColor: theme.accent }
                    : { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
                onPress={() => {
                  setExportFormat('png');
                  setQrScale(10);
                }}
              >
                <Ionicons
                  name="sparkles"
                  size={14}
                  color={exportFormat === 'png' && qrScale === 10 ? '#ffffff' : theme.accent}
                />
                <Text
                  style={[
                    styles.formatChipText,
                    {
                      color: exportFormat === 'png' && qrScale === 10 ? '#ffffff' : theme.text,
                      fontWeight: exportFormat === 'png' && qrScale === 10 ? '700' : '500',
                    },
                  ]}
                >
                  {' '}PNG HD (Scale 10)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.formatChip,
                  exportFormat === 'png' && qrScale === 6
                    ? { backgroundColor: theme.accent, borderColor: theme.accent }
                    : { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
                onPress={() => {
                  setExportFormat('png');
                  setQrScale(6);
                }}
              >
                <Text
                  style={[
                    styles.formatChipText,
                    {
                      color: exportFormat === 'png' && qrScale === 6 ? '#ffffff' : theme.text,
                      fontWeight: exportFormat === 'png' && qrScale === 6 ? '700' : '500',
                    },
                  ]}
                >
                  PNG Chuẩn (Scale 6)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.formatChip,
                  exportFormat === 'bmp'
                    ? { backgroundColor: theme.accent, borderColor: theme.accent }
                    : { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
                onPress={() => {
                  setExportFormat('bmp');
                  setQrScale(6);
                }}
              >
                <Text
                  style={[
                    styles.formatChipText,
                    {
                      color: exportFormat === 'bmp' ? '#ffffff' : theme.text,
                      fontWeight: exportFormat === 'bmp' ? '700' : '500',
                    },
                  ]}
                >
                  BMP (Scale 6)
                </Text>
              </TouchableOpacity>
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
            ) : qrError ? (
              <View style={styles.qrPlaceholder}>
                <Ionicons name="alert-circle-outline" size={56} color={theme.danger} />
                <Text style={[styles.placeholderTitle, { color: theme.danger, marginTop: 8 }]}>
                  Dữ liệu quá dài
                </Text>
                <Text style={[styles.placeholderText, { color: theme.textMuted, maxWidth: 300 }]}>
                  {qrError}
                </Text>
              </View>
            ) : qrDataUrl ? (
              <View style={styles.qrContainer}>
                <View style={[styles.qrWrapper, { backgroundColor: selectedColor.bg }]}>
                  <Image source={{ uri: qrDataUrl }} style={styles.qrImage} resizeMode="contain" />
                </View>

                {/* Badge thông tin độ phân giải */}
                <View style={[styles.resBadge, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Ionicons name="checkmark-circle" size={14} color={theme.green} />
                  <Text style={[styles.resBadgeText, { color: theme.textSub }]}>
                    {' '}Định dạng: {exportFormat.toUpperCase()} • Độ nét: Scale {qrScale} {qrScale === 10 ? '(HD Siêu nét)' : ''}
                  </Text>
                </View>

                {/* Actions: Hỗ trợ lưu vào documents/ và chia sẻ PNG HD */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { backgroundColor: theme.accent }]}
                    onPress={() => handleSaveToDocuments(true)}
                  >
                    <Ionicons name="folder-outline" size={18} color="#ffffff" />
                    <Text style={styles.primaryActionText}> Lưu Documents (HD)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { backgroundColor: theme.green }]}
                    onPress={() => handleShareQr(true)}
                  >
                    <Ionicons name="share-social-outline" size={18} color="#ffffff" />
                    <Text style={styles.primaryActionText}> Chia Sẻ PNG HD</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.secondaryActionBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    onPress={handleShareText}
                  >
                    <Ionicons name="copy-outline" size={18} color={theme.text} />
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
            <ScrollView
              contentContainerStyle={{
                padding: 16,
                paddingBottom: Math.max(insets.bottom, 16) + 24,
              }}
            >
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
  errorBanner: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#dc2626',
  },
  errorBannerText: {
    fontSize: 12,
    color: '#b91c1c',
    lineHeight: 18,
    marginTop: 2,
  },
  errorBannerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  errorActionChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  errorActionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#b91c1c',
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
  formatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  formatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  formatChipText: {
    fontSize: 12,
  },
  qrDisplayCard: {
    alignItems: 'center',
  },
  qrPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  placeholderTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  placeholderText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
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
    marginBottom: 12,
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  resBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  resBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 8,
  },
  primaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
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
