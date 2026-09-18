import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert,
  Modal, TextInput, ActivityIndicator, Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme';

import Storage from '../utils/storage';
import { STORAGE_KEYS } from '../constants/config';
import { listDocumentFiles, sanitizeFileName } from '../utils/fileHelper';

import GeminiService from '../services/ai/gemini.service';
import MathSolverService from '../services/ai/math.solver';
import TranslationService from '../services/translation/translation.service';
import OfficeExportService from '../services/office/officeExport.service';
import PdfToolsService from '../services/pdf/pdfTools.service';

const { width } = Dimensions.get('window');

export default function ToolsScreen({ route }: any) {
  const navigation = useNavigation<any>();
  const { theme } = useTheme();
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Modals state
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>('Đang xử lý...');
  const [ocrModalVisible, setOcrModalVisible] = useState<boolean>(false);
  const [ocrResultText, setOcrResultText] = useState<string>('');
  const [solverModalVisible, setSolverModalVisible] = useState<boolean>(false);
  const [solverResult, setSolverResult] = useState<string>('');
  const [translateModalVisible, setTranslateModalVisible] = useState<boolean>(false);
  const [translateOriginal, setTranslateOriginal] = useState<string>('');
  const [translateResult, setTranslateResult] = useState<string>('');
  const [mergeModalVisible, setMergeModalVisible] = useState<boolean>(false);

  // File name dialog
  const [nameDialogVisible, setNameDialogVisible] = useState<boolean>(false);
  const [nameDialogTitle, setNameDialogTitle] = useState<string>('');
  const [nameDialogValue, setNameDialogValue] = useState<string>('');
  const [nameDialogCallback, setNameDialogCallback] = useState<((name: string) => void) | null>(null);

  // PDF Merge data
  const [pdfFiles, setPdfFiles] = useState<string[]>([]);
  const [file1, setFile1] = useState<string>('');
  const [file2, setFile2] = useState<string>('');
  const [mergedName, setMergedName] = useState<string>('');

  const captureImageForProcessing = async (): Promise<string[]> => {
    try {
      const cachedPerm = await Storage.getItem(STORAGE_KEYS.CAM_PERM);
      let granted = cachedPerm === 'granted';

      if (!granted) {
        const perm = await ImagePicker.getCameraPermissionsAsync();
        if (perm.granted) {
          granted = true;
          await Storage.setItem(STORAGE_KEYS.CAM_PERM, 'granted');
        } else if (perm.canAskAgain) {
          const result = await ImagePicker.requestCameraPermissionsAsync();
          granted = result.granted;
          if (granted) await Storage.setItem(STORAGE_KEYS.CAM_PERM, 'granted');
        }
      }

      if (!granted) {
        Alert.alert('Cần quyền Camera', 'Vui lòng cấp quyền máy ảnh trong Cài đặt hệ thống.');
        return [];
      }

      try {
        const cam = await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: true });
        if (!cam.canceled && cam.assets && cam.assets.length > 0) {
          return [cam.assets[0].uri];
        }
        return [];
      } catch {
        const lib = await ImagePicker.launchImageLibraryAsync({ quality: 1, allowsEditing: true });
        if (!lib.canceled && lib.assets && lib.assets.length > 0) {
          return [lib.assets[0].uri];
        }
        return [];
      }
    } catch {
      return [];
    }
  };

  const loadSavedPdfs = async () => {
    try {
      const allFiles = await listDocumentFiles(['.pdf']);
      if (isMounted.current) {
        setPdfFiles(allFiles.filter(f => f.endsWith('.pdf')));
      }
    } catch (e) {
      console.warn('[Tools] Error listing PDF files', e);
    }
  };

  useEffect(() => {
    if (route.params?.triggerAction) {
      const action = route.params.triggerAction;
      navigation.setParams({ triggerAction: null });
      setTimeout(() => {
        if (!isMounted.current) return;
        if (action === 'idCard') handleIdCardScan();
        else if (action === 'book') handleBookScan();
        else if (action === 'ocr') handleExtractText();
        else if (action === 'importImages') handleImportImage();
        else if (action === 'importFiles') handleImportPdf();
        else if (action === 'pdfTools') handleOpenMergeDialog();
        else if (action === 'qrGen') navigation.navigate('QRGenerator');
      }, 300);
    }
  }, [route.params?.triggerAction]);

  const showNameDialog = (title: string, defaultName: string, onConfirm: (name: string) => void) => {
    setNameDialogTitle(title);
    setNameDialogValue(defaultName);
    setNameDialogCallback(() => onConfirm);
    setNameDialogVisible(true);
  };

  const handleNameDialogConfirm = () => {
    if (nameDialogCallback) {
      nameDialogCallback(nameDialogValue);
    }
    setNameDialogVisible(false);
  };

  // 1. SMART SCAN
  const handleSmartScan = () => {
    navigation.navigate('Scanner', { autoScan: true });
  };

  // 2. ID CARDS SCAN
  const handleIdCardScan = async () => {
    try {
      Alert.alert(
        'Quét Thẻ ID 2 mặt',
        'Bước 1: Chụp MẶT TRƯỚC của thẻ.\nBước 2: Chụp MẶT SAU của thẻ.',
        [
          { text: 'Hủy', style: 'cancel' },
          {
            text: 'Bắt đầu',
            onPress: async () => {
              const front = await captureImageForProcessing();
              if (front.length === 0) return;
              Alert.alert('Mặt trước hoàn tất', 'Bây giờ hãy chụp tiếp MẶT SAU của thẻ.', [
                {
                  text: 'Chụp mặt sau',
                  onPress: async () => {
                    const back = await captureImageForProcessing();
                    if (back.length === 0) return;

                    showNameDialog(
                      'Đặt tên tài liệu Thẻ ID',
                      `IDCard_${Math.floor(Date.now() / 1000)}`,
                      async (fileName) => {
                        setLoadingText('Đang tạo PDF Thẻ ID...');
                        setLoading(true);
                        try {
                          const targetUri = await PdfToolsService.createIdCardPdf(
                            front[0],
                            back[0],
                            fileName
                          );
                          setLoading(false);
                          Alert.alert('✅ Thành công', 'Đã lưu PDF Thẻ ID hoàn chỉnh!', [
                            { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
                            { text: 'OK', style: 'cancel' }
                          ]);
                        } catch {
                          setLoading(false);
                          Alert.alert('Lỗi', 'Không thể tạo file PDF Thẻ ID.');
                        }
                      }
                    );
                  }
                }
              ]);
            }
          }
        ]
      );
    } catch {
      Alert.alert('Lỗi', 'Không thể khởi chạy máy ảnh.');
    }
  };

  // 3. BOOK SCAN (Tách trang đôi)
  const handleBookScan = async () => {
    try {
      const scannedImages = await captureImageForProcessing();
      if (scannedImages && scannedImages.length > 0) {
        const bookUri = scannedImages[0];
        showNameDialog(
          'Đặt tên file sách tách trang',
          `Book_${Math.floor(Date.now() / 1000)}`,
          async (fileName) => {
            setLoadingText('Đang tách trang sách thành PDF...');
            setLoading(true);
            try {
              await PdfToolsService.createSplitBookPdf(bookUri, fileName);
              setLoading(false);
              Alert.alert('✅ Thành công', 'Đã tách trang sách đôi thành 2 trang PDF riêng biệt!', [
                { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
                { text: 'OK', style: 'cancel' }
              ]);
            } catch {
              setLoading(false);
              Alert.alert('Lỗi', 'Không thể tạo PDF tách trang sách.');
            }
          }
        );
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể khởi chạy máy quét sách.');
    }
  };

  // 4. OCR NHẬN DIỆN CHỮ
  const handleExtractText = async () => {
    const apiKey = await GeminiService.getApiKey();
    if (!apiKey) {
      Alert.alert(
        '⚠️ Cần Gemini API Key',
        'Tính năng nhận diện chữ viết (OCR) sử dụng trí tuệ nhân tạo Gemini Multimodal Vision API.\n\nVui lòng vào tab "Cài đặt" để nhập API Key cá nhân miễn phí của bạn.',
        [
          { text: 'Đến Cài đặt', onPress: () => navigation.navigate('Me') },
          { text: 'Để sau', style: 'cancel' }
        ]
      );
      return;
    }

    try {
      const scannedImages = await captureImageForProcessing();
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText('AI đang nhận dạng chữ viết...');
        setLoading(true);
        try {
          const text = await GeminiService.ocrImage(scannedImages[0]);
          if (!isMounted.current) return;
          setLoading(false);
          setOcrResultText(text || 'Không nhận diện được văn bản trong ảnh.');
          setOcrModalVisible(true);
        } catch (e: any) {
          if (!isMounted.current) return;
          setLoading(false);
          Alert.alert('⚠️ Lỗi OCR', e.message || 'Không thể trích xuất văn bản.');
        }
      }
    } catch {
      setLoading(false);
      Alert.alert('Lỗi', 'Không thể mở máy ảnh.');
    }
  };

  // 5. AI SOLVER & CAS ALGEBRA
  const solveViaCamera = async () => {
    try {
      const scannedImages = await captureImageForProcessing();
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText('Đang phân tích bài toán...');
        setLoading(true);
        const imageUri = scannedImages[0];

        const apiKey = await GeminiService.getApiKey();
        if (apiKey) {
          try {
            const aiText = await GeminiService.solveMathProblem(imageUri);
            if (!isMounted.current) return;
            setLoading(false);
            setSolverResult(aiText);
            setSolverModalVisible(true);
            return;
          } catch (aiErr: any) {
            console.warn('[Tools] Gemini solver error:', aiErr);
          }
        }

        // Nếu không có API Key, thông báo hướng dẫn rõ ràng
        setLoading(false);
        setSolverResult(
          '💡 Để giải bài toán qua hình ảnh (kèm sơ đồ hình học, phương trình), vui lòng nhập Gemini API Key trong tab Cài đặt.\n\nHoặc bạn có thể chọn "Nhập biểu thức" để giải phương trình/tính toán offline bằng bộ giải CAS trên thiết bị.'
        );
        setSolverModalVisible(true);
      }
    } catch {
      setLoading(false);
      Alert.alert('Lỗi', 'Lỗi khi khởi chạy máy ảnh.');
    }
  };

  const handleAiSolver = () => {
    Alert.alert(
      '🧮 Bộ giải toán thông minh',
      'Chọn phương thức giải bài toán:',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: '⌨️ Nhập biểu thức (Offline CAS)',
          onPress: () => {
            showNameDialog(
              'Nhập biểu thức đại số / phương trình',
              '2x + 10 = 30',
              (equation) => {
                if (!equation.trim()) return;
                const casRes = MathSolverService.solveWithCas(equation.trim());
                setSolverResult(casRes.result);
                setSolverModalVisible(true);
              }
            );
          },
        },
        {
          text: '📷 Chụp ảnh bài toán (AI Vision)',
          onPress: solveViaCamera,
        },
      ]
    );
  };

  // 6. DỊCH THUẬT
  const handleTranslate = async () => {
    try {
      const scannedImages = await captureImageForProcessing();
      if (scannedImages && scannedImages.length > 0) {
        const apiKey = await GeminiService.getApiKey();
        if (!apiKey) {
          Alert.alert(
            '⚠️ Cần API Key',
            'Tính năng dịch ảnh yêu cầu Gemini Vision OCR để nhận dạng văn bản trước khi dịch.\n\nVui lòng cấu hình API Key trong tab Cài đặt.',
            [{ text: 'Cài đặt', onPress: () => navigation.navigate('Me') }, { text: 'Đóng', style: 'cancel' }]
          );
          return;
        }

        setLoadingText('Đang trích xuất & dịch thuật...');
        setLoading(true);
        try {
          const rawText = await GeminiService.ocrImage(scannedImages[0]);
          if (!rawText.trim()) {
            setLoading(false);
            Alert.alert('Thông báo', 'Không tìm thấy chữ trong ảnh để dịch.');
            return;
          }
          setTranslateOriginal(rawText);
          const translated = await TranslationService.translate(rawText);
          if (!isMounted.current) return;
          setLoading(false);
          setTranslateResult(translated);
          setTranslateModalVisible(true);
        } catch (err: any) {
          if (!isMounted.current) return;
          setLoading(false);
          Alert.alert('Lỗi dịch thuật', err.message || 'Không thể dịch nội dung.');
        }
      }
    } catch {
      setLoading(false);
      Alert.alert('Lỗi', 'Lỗi khởi chạy máy ảnh.');
    }
  };

  // 7. XUẤT OFFICE (Word & Excel)
  const handleFormatConvert = async (format: 'Word' | 'Excel') => {
    const apiKey = await GeminiService.getApiKey();
    if (!apiKey) {
      Alert.alert(
        '⚠️ Cần Gemini API Key',
        `Để trích xuất nội dung từ ảnh sang file ${format}, cần Gemini Vision OCR.\n\nVui lòng nhập API Key trong tab Cài đặt.`,
        [{ text: 'Cài đặt', onPress: () => navigation.navigate('Me') }, { text: 'Đóng', style: 'cancel' }]
      );
      return;
    }

    try {
      const scannedImages = await captureImageForProcessing();
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText(`AI đang đọc và tạo file ${format}...`);
        setLoading(true);
        try {
          const text = await GeminiService.ocrImage(scannedImages[0]);
          if (!text.trim()) {
            setLoading(false);
            Alert.alert('Thông báo', 'Không tìm thấy chữ trong ảnh để chuyển đổi.');
            return;
          }

          let finalUri = '';
          if (format === 'Word') {
            finalUri = await OfficeExportService.exportToWord(text);
          } else {
            finalUri = await OfficeExportService.exportToExcel(text);
          }

          if (!isMounted.current) return;
          setLoading(false);
          Alert.alert('✅ Thành công', `Đã tạo file ${format} thành công!`, [
            { text: 'Chia sẻ', onPress: () => Sharing.shareAsync(finalUri) },
            { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
            { text: 'Đóng', style: 'cancel' }
          ]);
        } catch (err: any) {
          if (!isMounted.current) return;
          setLoading(false);
          Alert.alert('Lỗi chuyển đổi', err.message || `Không thể tạo file ${format}.`);
        }
      }
    } catch {
      setLoading(false);
      Alert.alert('Lỗi', 'Không thể chụp ảnh.');
    }
  };

  // 8. GỘP PDF
  const handleOpenMergeDialog = async () => {
    await loadSavedPdfs();
    setMergeModalVisible(true);
  };

  const handleMergePdfs = async () => {
    if (!file1 || !file2) {
      Alert.alert('Lỗi', 'Vui lòng chọn đủ 2 file PDF để gộp!');
      return;
    }
    if (file1 === file2) {
      Alert.alert('Lỗi', 'Vui lòng chọn 2 file khác nhau!');
      return;
    }

    setMergeModalVisible(false);
    setLoadingText('Đang gộp PDF...');
    setLoading(true);
    try {
      const outName = mergedName.trim() || `Merged_${Date.now()}`;
      await PdfToolsService.mergePdfs([file1, file2], outName);
      setLoading(false);
      Alert.alert('✅ Thành công', 'Đã gộp 2 file PDF thành công!', [
        { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
        { text: 'OK', style: 'cancel' }
      ]);
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Lỗi', `Không thể gộp PDF: ${e.message || String(e)}`);
    }
  };

  // 9. NHẬP FILE VÀ ẢNH
  const handleImportImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      navigation.navigate('Scanner', { importImages: result.assets.map(a => a.uri) });
    }
  };

  const handleImportPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        navigation.navigate('Files');
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể nhập file PDF.');
    }
  };

  const toolsList = [
    { title: 'Quét Thường', icon: 'scan', color: theme.accent, desc: 'Chụp và chỉnh sửa trang văn bản chuẩn A4', action: handleSmartScan },
    { title: 'Thẻ ID 2 mặt', icon: 'card', color: theme.blue, desc: 'Ghép mặt trước và mặt sau trên cùng 1 trang', action: handleIdCardScan },
    { title: 'Quét Sách Đôi', icon: 'book', color: '#ff7043', desc: 'Chụp đôi và tự động tách thành 2 trang riêng', action: handleBookScan },
    { title: 'Nhận diện chữ OCR', icon: 'text', color: theme.green, desc: 'Trích xuất chữ viết bằng Google Gemini AI', action: handleExtractText },
    { title: 'Giải Toán AI', icon: 'calculator', color: '#ab47bc', desc: 'Giải bài tập qua hình ảnh bằng Gemini Vision', action: handleAiSolver },
    { title: 'Dịch thuật', icon: 'language', color: '#29b6f6', desc: 'Dịch trực tiếp văn bản từ hình ảnh tài liệu', action: handleTranslate },
    { title: 'Chuyển sang Word', icon: 'document-text', color: '#1e88e5', desc: 'Nhận dạng và tạo file văn bản Microsoft Word (.docx)', action: () => handleFormatConvert('Word') },
    { title: 'Chuyển sang Excel', icon: 'stats-chart', color: '#43a047', desc: 'Trích xuất bảng biểu sang Microsoft Excel (.xlsx)', action: () => handleFormatConvert('Excel') },
    { title: 'Gộp nhiều PDF', icon: 'copy', color: theme.danger, desc: 'Ghép 2 hoặc nhiều file PDF thành 1 tập tin duy nhất', action: handleOpenMergeDialog },
    { title: 'Quét mã QR', icon: 'qr-code', color: theme.warn, desc: 'Đọc thông tin QR code và Barcode bằng Camera', action: () => navigation.navigate('QRScanner') },
    { title: 'Tạo mã QR', icon: 'create', color: '#8e24aa', desc: 'Tạo mã QR từ văn bản, liên kết hoặc số điện thoại', action: () => navigation.navigate('QRGenerator') },
  ];

  return (
    <View style={[s.container, { backgroundColor: theme.bg }]}>
      <View style={[s.header, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <Text style={[s.headerTitle, { color: theme.text }]}>Hộp Công Cụ</Text>
        <Text style={[s.headerSub, { color: theme.textSub }]}>Các tiện ích xử lý tài liệu thông minh</Text>
      </View>

      <ScrollView contentContainerStyle={s.listContainer} showsVerticalScrollIndicator={false}>
        {toolsList.map((item, idx) => (
          <TouchableOpacity
            key={idx}
            style={[s.toolCard, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={item.action}
            activeOpacity={0.7}
          >
            <View style={[s.iconBox, { backgroundColor: item.color + '18' }]}>
              <Ionicons name={item.icon as any} size={28} color={item.color} />
            </View>
            <View style={s.toolInfo}>
              <Text style={[s.toolTitle, { color: theme.text }]}>{item.title}</Text>
              <Text style={[s.toolDesc, { color: theme.textSub }]}>{item.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Loading Modal */}
      <Modal visible={loading} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.loadingBox, { backgroundColor: theme.card }]}>
            <ActivityIndicator size="large" color={theme.accent} />
            <Text style={[s.loadingText, { color: theme.text }]}>{loadingText}</Text>
          </View>
        </View>
      </Modal>

      {/* Custom Name Dialog */}
      <Modal visible={nameDialogVisible} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.dialogBox, { backgroundColor: theme.card }]}>
            <Text style={[s.dialogTitle, { color: theme.text }]}>{nameDialogTitle}</Text>
            <TextInput
              style={[s.dialogInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              value={nameDialogValue}
              onChangeText={setNameDialogValue}
              autoFocus
              selectTextOnFocus
            />
            <View style={s.dialogActions}>
              <TouchableOpacity style={s.dialogBtn} onPress={() => setNameDialogVisible(false)}>
                <Text style={{ color: theme.textSub }}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.dialogBtn, { backgroundColor: theme.accent }]} onPress={handleNameDialogConfirm}>
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Xác nhận</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* OCR Result Modal */}
      <Modal visible={ocrModalVisible} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.resultBox, { backgroundColor: theme.card }]}>
            <View style={s.resultHeader}>
              <Text style={[s.resultTitle, { color: theme.text }]}>📝 Kết quả nhận dạng chữ</Text>
              <TouchableOpacity onPress={() => setOcrModalVisible(false)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={s.resultScroll}>
              <Text style={[s.resultContent, { color: theme.text }]} selectable>{ocrResultText}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: theme.accent }]}
              onPress={async () => {
                await Clipboard.setStringAsync(ocrResultText);
                Alert.alert('Đã sao chép', 'Đã copy toàn bộ nội dung vào bộ nhớ tạm.');
              }}
            >
              <Ionicons name="copy" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={s.actionBtnText}>Sao chép văn bản</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AI Solver Modal */}
      <Modal visible={solverModalVisible} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.resultBox, { backgroundColor: theme.card }]}>
            <View style={s.resultHeader}>
              <Text style={[s.resultTitle, { color: theme.text }]}>📐 Lời giải bài toán</Text>
              <TouchableOpacity onPress={() => setSolverModalVisible(false)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={s.resultScroll}>
              <Text style={[s.resultContent, { color: theme.text }]} selectable>{solverResult}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: theme.accent }]}
              onPress={async () => {
                await Clipboard.setStringAsync(solverResult);
                Alert.alert('Đã sao chép', 'Đã copy lời giải vào bộ nhớ tạm.');
              }}
            >
              <Ionicons name="copy" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={s.actionBtnText}>Sao chép lời giải</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Translate Modal */}
      <Modal visible={translateModalVisible} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.resultBox, { backgroundColor: theme.card }]}>
            <View style={s.resultHeader}>
              <Text style={[s.resultTitle, { color: theme.text }]}>🌐 Bản dịch tài liệu</Text>
              <TouchableOpacity onPress={() => setTranslateModalVisible(false)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={s.resultScroll}>
              <Text style={[s.sectionHeader, { color: theme.textSub }]}>Văn bản gốc:</Text>
              <Text style={[s.resultContent, { color: theme.textSub, marginBottom: 16 }]} selectable>{translateOriginal}</Text>
              <Text style={[s.sectionHeader, { color: theme.accent }]}>Kết quả dịch:</Text>
              <Text style={[s.resultContent, { color: theme.text }]} selectable>{translateResult}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: theme.accent }]}
              onPress={async () => {
                await Clipboard.setStringAsync(translateResult);
                Alert.alert('Đã sao chép', 'Đã copy bản dịch vào bộ nhớ tạm.');
              }}
            >
              <Ionicons name="copy" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={s.actionBtnText}>Sao chép bản dịch</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Merge PDF Modal */}
      <Modal visible={mergeModalVisible} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.dialogBox, { backgroundColor: theme.card }]}>
            <Text style={[s.dialogTitle, { color: theme.text }]}>Gộp 2 file PDF</Text>
            {pdfFiles.length < 2 ? (
              <Text style={{ color: theme.textSub, marginVertical: 16 }}>
                Cần có ít nhất 2 file PDF trong thư mục để gộp. Vui lòng quét hoặc nhập thêm file.
              </Text>
            ) : (
              <View style={{ marginVertical: 12, width: '100%' }}>
                <Text style={{ color: theme.textSub, marginBottom: 4 }}>File thứ 1:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  {pdfFiles.map(f => (
                    <TouchableOpacity
                      key={f}
                      onPress={() => setFile1(f)}
                      style={[s.chip, { backgroundColor: file1 === f ? theme.accent : theme.surface }]}
                    >
                      <Text style={{ color: file1 === f ? '#fff' : theme.text, fontSize: 12 }}>{f}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={{ color: theme.textSub, marginBottom: 4 }}>File thứ 2:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  {pdfFiles.map(f => (
                    <TouchableOpacity
                      key={f}
                      onPress={() => setFile2(f)}
                      style={[s.chip, { backgroundColor: file2 === f ? theme.accent : theme.surface }]}
                    >
                      <Text style={{ color: file2 === f ? '#fff' : theme.text, fontSize: 12 }}>{f}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <TextInput
                  style={[s.dialogInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                  placeholder="Tên file sau khi gộp"
                  placeholderTextColor={theme.textMuted}
                  value={mergedName}
                  onChangeText={setMergedName}
                />
              </View>
            )}
            <View style={s.dialogActions}>
              <TouchableOpacity style={s.dialogBtn} onPress={() => setMergeModalVisible(false)}>
                <Text style={{ color: theme.textSub }}>Hủy</Text>
              </TouchableOpacity>
              {pdfFiles.length >= 2 && (
                <TouchableOpacity style={[s.dialogBtn, { backgroundColor: theme.accent }]} onPress={handleMergePdfs}>
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>Bắt đầu gộp</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20, borderBottomWidth: 1 },
  headerTitle: { fontSize: 24, fontWeight: '900', letterSpacing: 0.3 },
  headerSub: { fontSize: 13, marginTop: 4 },
  listContainer: { padding: 16, paddingBottom: 40 },
  toolCard: {
    flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16,
    marginBottom: 12, borderWidth: 1, elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3,
  },
  iconBox: { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  toolInfo: { flex: 1 },
  toolTitle: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  toolDesc: { fontSize: 12.5, lineHeight: 17 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingBox: { padding: 28, borderRadius: 20, alignItems: 'center', elevation: 8 },
  loadingText: { marginTop: 16, fontSize: 15, fontWeight: '600' },
  dialogBox: { width: width * 0.88, borderRadius: 20, padding: 22, alignItems: 'center', elevation: 10 },
  dialogTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 14, textAlign: 'center' },
  dialogInput: { width: '100%', height: 46, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, fontSize: 15, marginBottom: 16 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', width: '100%', gap: 12 },
  dialogBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: 'transparent' },
  resultBox: { width: width * 0.92, maxHeight: '80%', borderRadius: 24, padding: 20, elevation: 12 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  resultTitle: { fontSize: 18, fontWeight: 'bold' },
  resultScroll: { maxHeight: 380, marginBottom: 16 },
  sectionHeader: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  resultContent: { fontSize: 15, lineHeight: 22 },
  actionBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', height: 48, borderRadius: 12 },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});
