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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

import Storage from '../utils/storage';
import { STORAGE_KEYS } from '../constants/config';
import { listDocumentFiles, sanitizeFileName, saveDocumentOcrText, copyFileToDocuments } from '../utils/fileHelper';

import GeminiService, { VATInvoiceData, CitizenCardData, BusinessCardData } from '../services/ai/gemini.service';
import MathSolverService from '../services/ai/math.solver';
import TranslationService from '../services/translation/translation.service';
import OfficeExportService from '../services/office/officeExport.service';
import PdfToolsService from '../services/pdf/pdfTools.service';

const { width } = Dimensions.get('window');

export default function ToolsScreen({ route }: any) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    loadSavedPdfs();
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

  // Structured Extraction Modals state
  const [structuredModalVisible, setStructuredModalVisible] = useState<boolean>(false);
  const [structuredType, setStructuredType] = useState<'invoice' | 'citizenCard' | 'businessCard' | null>(null);
  const [invoiceResult, setInvoiceResult] = useState<VATInvoiceData | null>(null);
  const [citizenCardResult, setCitizenCardResult] = useState<CitizenCardData | null>(null);
  const [businessCardResult, setBusinessCardResult] = useState<BusinessCardData | null>(null);

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

  // Encrypt PDF data
  const [encryptModalVisible, setEncryptModalVisible] = useState<boolean>(false);
  const [encryptFileUri, setEncryptFileUri] = useState<string>('');
  const [encryptFileName, setEncryptFileName] = useState<string>('');
  const [encryptPassword, setEncryptPassword] = useState<string>('');

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
    let timerId: ReturnType<typeof setTimeout> | null = null;
    if (route.params?.triggerAction) {
      const action = route.params.triggerAction;
      navigation.setParams({ triggerAction: null });
      timerId = setTimeout(() => {
        if (!isMounted.current) return;
        if (action === 'idCard') handleIdCardScan();
        else if (action === 'invoice') handleExtractInvoice();
        else if (action === 'citizenCard') handleExtractCitizenCard();
        else if (action === 'businessCard') handleExtractBusinessCard();
        else if (action === 'book') handleBookScan();
        else if (action === 'ocr') handleExtractText();
        else if (action === 'importImages') handleImportImage();
        else if (action === 'importFiles') handleImportPdf();
        else if (action === 'pdfTools') handleOpenMergeDialog();
        else if (action === 'qrGen') navigation.navigate('QRGenerator');
      }, 300);
    }
    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [route.params?.triggerAction]);

  const showNameDialog = (title: string, defaultName: string, onConfirm: (name: string) => void) => {
    if (!isMounted.current) return;
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
              if (!isMounted.current) return;
              if (front.length === 0) return;
              Alert.alert('Mặt trước hoàn tất', 'Bây giờ hãy chụp tiếp MẶT SAU của thẻ.', [
                {
                  text: 'Chụp mặt sau',
                  onPress: async () => {
                    const back = await captureImageForProcessing();
                    if (!isMounted.current) return;
                    if (back.length === 0) return;

                    showNameDialog(
                      'Đặt tên tài liệu Thẻ ID',
                      `IDCard_${Math.floor(Date.now() / 1000)}`,
                      async (fileName) => {
                        if (!isMounted.current) return;
                        setLoadingText('Đang tạo PDF Thẻ ID...');
                        setLoading(true);
                        try {
                          const targetUri = await PdfToolsService.createIdCardPdf(
                            front[0],
                            back[0],
                            fileName
                          );
                          await loadSavedPdfs();
                          if (!isMounted.current) return;
                          setLoading(false);
                          Alert.alert('✅ Thành công', 'Đã lưu PDF Thẻ ID hoàn chỉnh!', [
                            { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
                            { text: 'OK', style: 'cancel' }
                          ]);
                        } catch {
                          if (!isMounted.current) return;
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
      if (!isMounted.current) return;
      Alert.alert('Lỗi', 'Không thể khởi chạy máy ảnh.');
    }
  };

  // 3. BOOK SCAN (Quét sách)
  const handleBookScan = async () => {
    Alert.alert(
      '📖 Quét Sách Chuyên Dụng',
      'Chọn phương thức quét sách bạn mong muốn:',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: '📖 Nắn gáy cong (Dewarp)',
          onPress: () => {
            navigation.navigate('Scanner', { bookMode: true });
          },
        },
        {
          text: '📑 Tách trang đôi (2 trong 1)',
          onPress: async () => {
            try {
              const scannedImages = await captureImageForProcessing();
              if (!isMounted.current) return;
              if (scannedImages && scannedImages.length > 0) {
                const bookUri = scannedImages[0];
                showNameDialog(
                  'Đặt tên file sách tách trang',
                  `Book_${Math.floor(Date.now() / 1000)}`,
                  async (fileName) => {
                    if (!isMounted.current) return;
                    setLoadingText('Đang tách trang sách thành PDF...');
                    setLoading(true);
                    try {
                      await PdfToolsService.createSplitBookPdf(bookUri, fileName);
                      await loadSavedPdfs();
                      if (!isMounted.current) return;
                      setLoading(false);
                      Alert.alert('✅ Thành công', 'Đã tách trang sách đôi thành 2 trang PDF riêng biệt!', [
                        { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
                        { text: 'OK', style: 'cancel' }
                      ]);
                    } catch {
                      if (!isMounted.current) return;
                      setLoading(false);
                      Alert.alert('Lỗi', 'Không thể tạo PDF tách trang sách.');
                    }
                  }
                );
              }
            } catch {
              if (!isMounted.current) return;
              Alert.alert('Lỗi', 'Không thể khởi chạy máy quét sách.');
            }
          },
        },
      ]
    );
  };

  // 4. OCR NHẬN DIỆN CHỮ
  const handleExtractText = async () => {
    const apiKey = await GeminiService.getApiKey();
    if (!isMounted.current) return;
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
      if (!isMounted.current) return;
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
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('Lỗi', 'Không thể mở máy ảnh.');
    }
  };

  // 5. AI SOLVER & CAS ALGEBRA
  const solveViaCamera = async () => {
    try {
      const scannedImages = await captureImageForProcessing();
      if (!isMounted.current) return;
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText('Đang phân tích bài toán...');
        setLoading(true);
        const imageUri = scannedImages[0];

        const apiKey = await GeminiService.getApiKey();
        if (!isMounted.current) return;
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

        if (!isMounted.current) return;
        // Nếu không có API Key, thông báo hướng dẫn rõ ràng
        setLoading(false);
        setSolverResult(
          '💡 Để giải bài toán qua hình ảnh (kèm sơ đồ hình học, phương trình), vui lòng nhập Gemini API Key trong tab Cài đặt.\n\nHoặc bạn có thể chọn "Nhập biểu thức" để giải phương trình/tính toán offline bằng bộ giải CAS trên thiết bị.'
        );
        setSolverModalVisible(true);
      }
    } catch {
      if (!isMounted.current) return;
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
              async (equation) => {
                if (!isMounted.current) return;
                if (!equation.trim()) return;
                const casRes = await MathSolverService.solveWithCas(equation.trim());
                if (!isMounted.current) return;
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
      if (!isMounted.current) return;
      if (scannedImages && scannedImages.length > 0) {
        const apiKey = await GeminiService.getApiKey();
        if (!isMounted.current) return;
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
          if (!isMounted.current) return;
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
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('Lỗi', 'Lỗi khởi chạy máy ảnh.');
    }
  };

  // 7. XUẤT OFFICE (Word & Excel)
  const handleFormatConvert = async (format: 'Word' | 'Excel') => {
    const apiKey = await GeminiService.getApiKey();
    if (!isMounted.current) return;
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
      if (!isMounted.current) return;
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText(`AI đang đọc và tạo file ${format}...`);
        setLoading(true);
        try {
          const text = await GeminiService.ocrImage(scannedImages[0]);
          if (!isMounted.current) return;
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
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('Lỗi', 'Không thể chụp ảnh.');
    }
  };

  // 8. GỘP PDF
  const handleOpenMergeDialog = async () => {
    await loadSavedPdfs();
    if (!isMounted.current) return;
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
      await loadSavedPdfs();
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('✅ Thành công', 'Đã gộp 2 file PDF thành công!', [
        { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
        { text: 'OK', style: 'cancel' }
      ]);
    } catch (e: any) {
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('Lỗi', `Không thể gộp PDF: ${e.message || String(e)}`);
    }
  };

  // 8B. KHÓA MẬT KHẨU PDF (ISO 32000-1)
  const handleOpenEncryptPdfDialog = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (!isMounted.current) return;
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const picked = result.assets[0];
        setEncryptFileUri(picked.uri);
        setEncryptFileName(picked.name || 'document.pdf');
        setEncryptPassword('');
        setEncryptModalVisible(true);
      }
    } catch {
      if (!isMounted.current) return;
      Alert.alert('Lỗi', 'Không thể chọn file PDF.');
    }
  };

  const handleConfirmEncryptPdf = async () => {
    if (!encryptPassword.trim()) {
      Alert.alert('Thông báo', 'Vui lòng nhập mật khẩu bảo vệ tài liệu.');
      return;
    }
    setEncryptModalVisible(false);
    setLoadingText('Đang mã hóa và khóa bảo vệ PDF...');
    setLoading(true);
    try {
      const outputUri = await PdfToolsService.encryptPdf(encryptFileUri, encryptPassword.trim());
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('✅ Khóa PDF thành công', 'File PDF đã được mã hóa bảo vệ bằng mật khẩu (chuẩn ISO 32000-1).', [
        { text: 'Chia sẻ', onPress: () => Sharing.shareAsync(outputUri) },
        { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
        { text: 'Đóng', style: 'cancel' },
      ]);
    } catch (e: any) {
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('Lỗi mã hóa PDF', e.message || 'Không thể đặt mật khẩu cho file PDF này.');
    }
  };

  // 9. NHẬP FILE VÀ ẢNH
  const handleImportImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (!isMounted.current) return;
    if (!result.canceled && result.assets && result.assets.length > 0) {
      navigation.navigate('Scanner', { importImages: result.assets.map(a => a.uri) });
    }
  };

  const handleImportPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
      if (!isMounted.current) return;
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const { uri: sourceUri, name: originalName } = result.assets[0];
        const safeName = sanitizeFileName((originalName || 'PDF_' + Date.now()).replace(/\.pdf$/i, ''), 'PDF');
        await copyFileToDocuments(sourceUri, `${safeName}.pdf`);
        await loadSavedPdfs();
        if (!isMounted.current) return;
        Alert.alert('✅ Thành công', `Đã nhập tài liệu: ${safeName}.pdf`, [
          { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
          { text: 'OK', style: 'cancel' }
        ]);
      }
    } catch {
      if (!isMounted.current) return;
      Alert.alert('Lỗi', 'Không thể nhập file PDF.');
    }
  };

  // 10. CHỌN NGUỒN ẢNH TÀI LIỆU
  const pickImageSource = async (title: string): Promise<string[]> => {
    return new Promise((resolve) => {
      Alert.alert(
        title,
        'Chọn phương thức nhập ảnh tài liệu:',
        [
          { text: 'Hủy', style: 'cancel', onPress: () => resolve([]) },
          {
            text: '🖼️ Chọn từ Thư viện',
            onPress: async () => {
              try {
                const lib = await ImagePicker.launchImageLibraryAsync({ quality: 1, allowsEditing: true });
                if (!lib.canceled && lib.assets && lib.assets.length > 0) {
                  resolve([lib.assets[0].uri]);
                } else {
                  resolve([]);
                }
              } catch {
                resolve([]);
              }
            },
          },
          {
            text: '📷 Chụp từ Máy ảnh',
            onPress: async () => {
              const res = await captureImageForProcessing();
              resolve(res);
            },
          },
        ]
      );
    });
  };

  // Format tiền tệ Việt Nam
  const formatCurrency = (val?: number) => {
    if (val === undefined || val === null || isNaN(val)) return '—';
    return val.toLocaleString('vi-VN') + ' đ';
  };

  // Sao chép từng trường
  const copyFieldValue = async (label: string, value: string | number | undefined) => {
    if (!value || value === '—') return;
    await Clipboard.setStringAsync(String(value));
    Alert.alert('Đã sao chép', `Đã copy ${label}: ${value}`);
  };

  // Tạo chuỗi text tổng hợp từ Hóa đơn
  const getInvoiceFullText = (inv: VATInvoiceData) => {
    const lines = [
      '=== THÔNG TIN HÓA ĐƠN VAT ===',
      `Số HĐ: ${inv.invoiceNumber || '—'}`,
      `Ngày lập: ${inv.invoiceDate || '—'}`,
      `Đơn vị bán: ${inv.sellerName || '—'}`,
      `Mã số thuế: ${inv.taxCode || '—'}`,
    ];
    if (inv.items && inv.items.length > 0) {
      lines.push('\n--- CHI TIẾT MẶT HÀNG ---');
      inv.items.forEach((it, idx) => {
        lines.push(
          `${idx + 1}. ${it.name} | SL: ${it.quantity ?? 1} ${it.unit || ''} | Đơn giá: ${it.unitPrice !== undefined ? formatCurrency(it.unitPrice) : '—'} | Thành tiền: ${it.total !== undefined ? formatCurrency(it.total) : '—'}`
        );
      });
    }
    if (inv.subTotal !== undefined && inv.subTotal > 0) lines.push(`\nTiền trước thuế: ${formatCurrency(inv.subTotal)}`);
    if (inv.vatRate) lines.push(`Thuế suất VAT: ${inv.vatRate}`);
    if (inv.vatAmount !== undefined) lines.push(`Tiền thuế VAT: ${formatCurrency(inv.vatAmount)}`);
    lines.push(`Tổng thanh toán: ${formatCurrency(inv.totalAmount)}`);
    return lines.join('\n');
  };

  // Tạo chuỗi text tổng hợp từ CCCD
  const getCitizenCardFullText = (card: CitizenCardData) => {
    return [
      '=== THÔNG TIN CCCD / CMND ===',
      `Số CCCD: ${card.idNumber || '—'}`,
      `Họ và tên: ${card.fullName || '—'}`,
      `Ngày sinh: ${card.dateOfBirth || '—'}`,
      `Giới tính: ${card.gender || '—'}`,
      `Quê quán: ${card.placeOfOrigin || '—'}`,
      `Nơi thường trú: ${card.placeOfResidence || '—'}`,
    ].join('\n');
  };

  // Tạo chuỗi text tổng hợp từ Danh thiếp
  const getBusinessCardFullText = (bc: BusinessCardData) => {
    return [
      '=== THÔNG TIN DANH THIẾP ===',
      `Họ và tên: ${bc.name || '—'}`,
      `Chức danh: ${bc.title || '—'}`,
      `Công ty: ${bc.company || '—'}`,
      `Số điện thoại: ${bc.phone || '—'}`,
      `Email: ${bc.email || '—'}`,
      `Website: ${bc.website || '—'}`,
      `Địa chỉ: ${bc.address || '—'}`,
    ].join('\n');
  };

  const copyAllStructuredData = async () => {
    let fullText = '';
    if (structuredType === 'invoice' && invoiceResult) {
      fullText = getInvoiceFullText(invoiceResult);
    } else if (structuredType === 'citizenCard' && citizenCardResult) {
      fullText = getCitizenCardFullText(citizenCardResult);
    } else if (structuredType === 'businessCard' && businessCardResult) {
      fullText = getBusinessCardFullText(businessCardResult);
    }
    if (fullText) {
      await Clipboard.setStringAsync(fullText);
      Alert.alert('Đã sao chép', 'Đã copy toàn bộ thông tin bóc tách vào bộ nhớ tạm.');
    }
  };

  const copyJsonStructuredData = async () => {
    let jsonStr = '';
    if (structuredType === 'invoice' && invoiceResult) {
      jsonStr = JSON.stringify(invoiceResult, null, 2);
    } else if (structuredType === 'citizenCard' && citizenCardResult) {
      jsonStr = JSON.stringify(citizenCardResult, null, 2);
    } else if (structuredType === 'businessCard' && businessCardResult) {
      jsonStr = JSON.stringify(businessCardResult, null, 2);
    }
    if (jsonStr) {
      await Clipboard.setStringAsync(jsonStr);
      Alert.alert('Đã sao chép JSON', 'Đã copy dữ liệu JSON vào bộ nhớ tạm.');
    }
  };

  // 11. BÓC TÁCH HÓA ĐƠN VAT (Structured JSON)
  const handleExtractInvoice = async () => {
    const apiKey = await GeminiService.getApiKey();
    if (!isMounted.current) return;
    if (!apiKey) {
      Alert.alert(
        '⚠️ Cần Gemini API Key',
        'Tính năng bóc tách Hóa đơn VAT sử dụng Google Gemini Multimodal Vision API.\n\nVui lòng vào tab "Cài đặt" để nhập API Key cá nhân của bạn.',
        [
          { text: 'Đến Cài đặt', onPress: () => navigation.navigate('Me') },
          { text: 'Để sau', style: 'cancel' }
        ]
      );
      return;
    }

    try {
      const scannedImages = await pickImageSource('🧾 Bóc tách Hóa đơn VAT');
      if (!isMounted.current) return;
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText('AI đang phân tích & bóc tách Hóa đơn VAT...');
        setLoading(true);
        try {
          const data = await GeminiService.extractVATInvoice(scannedImages[0]);
          if (!isMounted.current) return;
          setLoading(false);
          setInvoiceResult(data);
          setStructuredType('invoice');
          setStructuredModalVisible(true);
        } catch (e: any) {
          if (!isMounted.current) return;
          setLoading(false);
          Alert.alert('⚠️ Lỗi bóc tách hóa đơn', e.message || 'Không thể trích xuất thông tin hóa đơn.');
        }
      }
    } catch {
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('Lỗi', 'Không thể khởi chạy máy ảnh hoặc thư viện.');
    }
  };

  // 12. BÓC TÁCH CCCD / CMND (Structured JSON)
  const handleExtractCitizenCard = async () => {
    const apiKey = await GeminiService.getApiKey();
    if (!isMounted.current) return;
    if (!apiKey) {
      Alert.alert(
        '⚠️ Cần Gemini API Key',
        'Tính năng bóc tách CCCD/CMND sử dụng Google Gemini Multimodal Vision API.\n\nVui lòng vào tab "Cài đặt" để nhập API Key cá nhân của bạn.',
        [
          { text: 'Đến Cài đặt', onPress: () => navigation.navigate('Me') },
          { text: 'Để sau', style: 'cancel' }
        ]
      );
      return;
    }

    try {
      const scannedImages = await pickImageSource('🪪 Bóc tách CCCD / CMND');
      if (!isMounted.current) return;
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText('AI đang đọc thông tin thẻ CCCD/CMND...');
        setLoading(true);
        try {
          const data = await GeminiService.extractCitizenCard(scannedImages[0]);
          if (!isMounted.current) return;
          setLoading(false);
          setCitizenCardResult(data);
          setStructuredType('citizenCard');
          setStructuredModalVisible(true);
        } catch (e: any) {
          if (!isMounted.current) return;
          setLoading(false);
          Alert.alert('⚠️ Lỗi bóc tách CCCD', e.message || 'Không thể trích xuất thông tin căn cước công dân.');
        }
      }
    } catch {
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('Lỗi', 'Không thể khởi chạy máy ảnh hoặc thư viện.');
    }
  };

  // 13. BÓC TÁCH DANH THIẾP (Structured JSON)
  const handleExtractBusinessCard = async () => {
    const apiKey = await GeminiService.getApiKey();
    if (!isMounted.current) return;
    if (!apiKey) {
      Alert.alert(
        '⚠️ Cần Gemini API Key',
        'Tính năng bóc tách Danh thiếp sử dụng Google Gemini Multimodal Vision API.\n\nVui lòng vào tab "Cài đặt" để nhập API Key cá nhân của bạn.',
        [
          { text: 'Đến Cài đặt', onPress: () => navigation.navigate('Me') },
          { text: 'Để sau', style: 'cancel' }
        ]
      );
      return;
    }

    try {
      const scannedImages = await pickImageSource('💼 Bóc tách Danh thiếp');
      if (!isMounted.current) return;
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText('AI đang bóc tách thông tin liên hệ danh thiếp...');
        setLoading(true);
        try {
          const data = await GeminiService.extractBusinessCard(scannedImages[0]);
          if (!isMounted.current) return;
          setLoading(false);
          setBusinessCardResult(data);
          setStructuredType('businessCard');
          setStructuredModalVisible(true);
        } catch (e: any) {
          if (!isMounted.current) return;
          setLoading(false);
          Alert.alert('⚠️ Lỗi bóc tách danh thiếp', e.message || 'Không thể trích xuất thông tin danh thiếp.');
        }
      }
    } catch {
      if (!isMounted.current) return;
      setLoading(false);
      Alert.alert('Lỗi', 'Không thể khởi chạy máy ảnh hoặc thư viện.');
    }
  };

  const renderField = (
    label: string,
    value: string | number | undefined,
    iconName?: any,
    isHighlight?: boolean
  ) => {
    const displayVal = value !== undefined && value !== null && String(value).trim() !== '' ? String(value) : '—';
    const hasValue = displayVal !== '—';

    return (
      <View style={[s.fieldCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={s.fieldHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            {iconName && (
              <Ionicons
                name={iconName}
                size={16}
                color={isHighlight ? theme.accent : theme.textSub}
                style={{ marginRight: 6 }}
              />
            )}
            <Text style={[s.fieldLabel, { color: isHighlight ? theme.accent : theme.textSub }]}>
              {label}
            </Text>
          </View>
          {hasValue && (
            <TouchableOpacity
              onPress={() => copyFieldValue(label, displayVal)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="copy-outline" size={15} color={theme.textSub} />
            </TouchableOpacity>
          )}
        </View>
        <Text
          style={[
            s.fieldValue,
            {
              color: hasValue ? theme.text : theme.textMuted,
              fontWeight: isHighlight ? 'bold' : '600',
              fontSize: isHighlight ? 16 : 14.5,
            },
          ]}
          selectable
        >
          {displayVal}
        </Text>
      </View>
    );
  };

  const toolsList = [
    { title: 'Quét Thường', icon: 'scan', color: theme.accent, desc: 'Chụp và chỉnh sửa trang văn bản chuẩn A4', action: handleSmartScan },
    { title: 'Hóa đơn', icon: 'receipt', color: '#f57c00', desc: 'Bóc tách Số HĐ, Ngày lập, MST, Chi tiết & Tổng tiền', action: handleExtractInvoice },
    { title: 'CCCD/CMND', icon: 'card', color: '#00897b', desc: 'Bóc tách Số CCCD, Họ tên, Ngày sinh, Địa chỉ bằng AI', action: handleExtractCitizenCard },
    { title: 'Danh thiếp', icon: 'business', color: '#5c6bc0', desc: 'Bóc tách Họ tên, Chức vụ, Đơn vị, SĐT, Email liên hệ', action: handleExtractBusinessCard },
    { title: 'Thẻ ID 2 mặt', icon: 'card-outline', color: theme.blue, desc: 'Ghép mặt trước và mặt sau trên cùng 1 trang PDF', action: handleIdCardScan },
    { title: 'Quét Sách Đôi', icon: 'book', color: '#ff7043', desc: 'Chụp đôi và tự động tách thành 2 trang riêng', action: handleBookScan },
    { title: 'Nhận diện chữ OCR', icon: 'text', color: theme.green, desc: 'Trích xuất chữ viết bằng Google Gemini AI', action: handleExtractText },
    { title: 'Giải Toán AI', icon: 'calculator', color: '#ab47bc', desc: 'Giải bài tập qua hình ảnh bằng Gemini Vision', action: handleAiSolver },
    { title: 'Dịch thuật', icon: 'language', color: '#29b6f6', desc: 'Dịch trực tiếp văn bản từ hình ảnh tài liệu', action: handleTranslate },
    { title: 'Chuyển sang Word', icon: 'document-text', color: '#1e88e5', desc: 'Nhận dạng và tạo file văn bản Microsoft Word (.docx)', action: () => handleFormatConvert('Word') },
    { title: 'Chuyển sang Excel', icon: 'stats-chart', color: '#43a047', desc: 'Trích xuất bảng biểu sang Microsoft Excel (.xlsx)', action: () => handleFormatConvert('Excel') },
    { title: 'Gộp nhiều PDF', icon: 'copy', color: theme.danger, desc: 'Ghép 2 hoặc nhiều file PDF thành 1 tập tin duy nhất', action: handleOpenMergeDialog },
    { title: 'Khóa mật khẩu PDF', icon: 'lock-closed', color: '#e91e63', desc: 'Mã hóa ISO 32000-1 và đặt mật khẩu bảo vệ file PDF', action: handleOpenEncryptPdfDialog },
    { title: 'Quét mã QR', icon: 'qr-code', color: theme.warn, desc: 'Đọc thông tin QR code và Barcode bằng Camera', action: () => navigation.navigate('QRScanner') },
    { title: 'Tạo mã QR', icon: 'create', color: '#8e24aa', desc: 'Tạo mã QR từ văn bản, liên kết hoặc số điện thoại', action: () => navigation.navigate('QRGenerator') },
  ];

  return (
    <View style={[s.container, { backgroundColor: theme.bg }]}>
      <View
        style={[
          s.header,
          {
            backgroundColor: theme.card,
            borderBottomColor: theme.border,
            paddingTop: Math.max(insets.top, 16) + 12,
          },
        ]}
      >
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
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: theme.accent, flex: 1, marginTop: 0 }]}
                onPress={async () => {
                  await Clipboard.setStringAsync(ocrResultText);
                  Alert.alert('Đã sao chép', 'Đã copy toàn bộ nội dung vào bộ nhớ tạm.');
                }}
              >
                <Ionicons name="copy" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={s.actionBtnText}>Sao chép</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: theme.blue, flex: 1, marginTop: 0 }]}
                onPress={async () => {
                  const pdfs = await listDocumentFiles(['.pdf']);
                  if (!isMounted.current) return;
                  if (pdfs.length === 0) {
                    Alert.alert('Thông báo', 'Chưa có file PDF nào trong máy để gắn dữ liệu tìm kiếm OCR.');
                    return;
                  }
                  Alert.alert(
                    '🔍 Gắn vào tài liệu PDF',
                    'Chọn tài liệu bạn muốn gắn nội dung OCR này vào để tìm kiếm toàn văn:',
                    [
                      { text: 'Đóng', style: 'cancel' },
                      ...pdfs.slice(0, 4).map(pdfName => ({
                        text: pdfName.length > 22 ? pdfName.substring(0, 19) + '...' : pdfName,
                        onPress: async () => {
                          await saveDocumentOcrText(pdfName, ocrResultText);
                          if (!isMounted.current) return;
                          Alert.alert('✅ Thành công', `Đã gắn OCR vào "${pdfName}". Bạn có thể tìm thấy file này khi tìm kiếm từ khóa nội dung trong mục Tài liệu!`);
                        }
                      }))
                    ]
                  );
                }}
              >
                <Ionicons name="search" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={s.actionBtnText}>Gắn tìm kiếm</Text>
              </TouchableOpacity>
            </View>
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

      {/* Encrypt PDF Modal */}
      <Modal visible={encryptModalVisible} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.dialogBox, { backgroundColor: theme.card }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Ionicons name="lock-closed" size={24} color="#e91e63" style={{ marginRight: 8 }} />
              <Text style={[s.dialogTitle, { color: theme.text, marginBottom: 0 }]}>Khóa Mật Khẩu PDF</Text>
            </View>
            <Text style={{ color: theme.textSub, fontSize: 13, marginBottom: 12 }} numberOfLines={1}>
              File: <Text style={{ color: theme.text, fontWeight: '600' }}>{encryptFileName}</Text>
            </Text>
            <TextInput
              style={[s.dialogInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              placeholder="Nhập mật khẩu mở file PDF"
              placeholderTextColor={theme.textMuted}
              secureTextEntry
              value={encryptPassword}
              onChangeText={setEncryptPassword}
              autoFocus
            />
            <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 4, marginBottom: 12 }}>
              Chuẩn mã hóa ISO 32000-1 (RC4 128-bit). Người xem cần nhập mật khẩu này để mở file.
            </Text>
            <View style={s.dialogActions}>
              <TouchableOpacity style={s.dialogBtn} onPress={() => setEncryptModalVisible(false)}>
                <Text style={{ color: theme.textSub }}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.dialogBtn, { backgroundColor: '#e91e63' }]} onPress={handleConfirmEncryptPdf}>
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Khóa bảo vệ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Structured Extraction Result Modal */}
      <Modal visible={structuredModalVisible} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.resultBox, { backgroundColor: theme.card, maxHeight: '85%' }]}>
            {/* Header */}
            <View style={s.resultHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
                <Ionicons
                  name={
                    structuredType === 'invoice'
                      ? 'receipt'
                      : structuredType === 'citizenCard'
                      ? 'card'
                      : 'business'
                  }
                  size={22}
                  color={theme.accent}
                  style={{ marginRight: 8 }}
                />
                <Text style={[s.resultTitle, { color: theme.text }]} numberOfLines={1}>
                  {structuredType === 'invoice' && 'Chi tiết Hóa đơn VAT'}
                  {structuredType === 'citizenCard' && 'Thông tin CCCD / CMND'}
                  {structuredType === 'businessCard' && 'Thông tin Danh thiếp'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setStructuredModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            {/* Content ScrollView */}
            <ScrollView style={s.resultScroll} showsVerticalScrollIndicator={false}>
              {/* Render Hóa đơn */}
              {structuredType === 'invoice' && invoiceResult && (
                <View>
                  {renderField('Số HĐ', invoiceResult.invoiceNumber, 'receipt-outline')}
                  {renderField('Ngày lập', invoiceResult.invoiceDate, 'calendar-outline')}
                  {renderField('Đơn vị bán', invoiceResult.sellerName, 'business-outline')}
                  {renderField('Mã số thuế (MST)', invoiceResult.taxCode, 'barcode-outline')}

                  {invoiceResult.items && invoiceResult.items.length > 0 && (
                    <View style={[s.structuredGroup, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                      <Text style={[s.groupHeaderTitle, { color: theme.text }]}>
                        📦 Chi tiết mặt hàng ({invoiceResult.items.length})
                      </Text>
                      {invoiceResult.items.map((item, idx) => (
                        <View
                          key={idx}
                          style={[
                            s.itemRow,
                            {
                              borderBottomColor: theme.border,
                              borderBottomWidth: idx === invoiceResult.items.length - 1 ? 0 : 1,
                            },
                          ]}
                        >
                          <Text style={[s.itemName, { color: theme.text }]}>
                            {idx + 1}. {item.name}
                          </Text>
                          <View style={s.itemMetaRow}>
                            <Text style={[s.itemMeta, { color: theme.textSub }]}>
                              SL: {item.quantity ?? 1} {item.unit ? `(${item.unit})` : ''}
                            </Text>
                            {item.unitPrice !== undefined && (
                              <Text style={[s.itemMeta, { color: theme.textSub }]}>
                                ĐG: {formatCurrency(item.unitPrice)}
                              </Text>
                            )}
                            {item.total !== undefined && (
                              <Text style={[s.itemTotal, { color: theme.accent }]}>
                                TT: {formatCurrency(item.total)}
                              </Text>
                            )}
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={[s.paymentBox, { borderColor: theme.accent, backgroundColor: theme.surface }]}>
                    {invoiceResult.subTotal !== undefined && invoiceResult.subTotal > 0 && (
                      <View style={s.paymentRow}>
                        <Text style={[s.paymentLabel, { color: theme.textSub }]}>Tiền trước thuế:</Text>
                        <Text style={[s.paymentValue, { color: theme.text }]}>
                          {formatCurrency(invoiceResult.subTotal)}
                        </Text>
                      </View>
                    )}
                    {invoiceResult.vatRate ? (
                      <View style={s.paymentRow}>
                        <Text style={[s.paymentLabel, { color: theme.textSub }]}>Thuế suất VAT:</Text>
                        <Text style={[s.paymentValue, { color: theme.text }]}>{invoiceResult.vatRate}</Text>
                      </View>
                    ) : null}
                    {invoiceResult.vatAmount !== undefined && invoiceResult.vatAmount > 0 && (
                      <View style={s.paymentRow}>
                        <Text style={[s.paymentLabel, { color: theme.textSub }]}>Tiền thuế VAT:</Text>
                        <Text style={[s.paymentValue, { color: theme.text }]}>
                          {formatCurrency(invoiceResult.vatAmount)}
                        </Text>
                      </View>
                    )}
                    <View style={[s.paymentRow, { marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.border }]}>
                      <Text style={[s.totalLabel, { color: theme.text }]}>TỔNG THANH TOÁN:</Text>
                      <Text style={[s.totalValue, { color: theme.accent }]}>
                        {formatCurrency(invoiceResult.totalAmount)}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Render CCCD/CMND */}
              {structuredType === 'citizenCard' && citizenCardResult && (
                <View>
                  {renderField('Số CCCD / CMND', citizenCardResult.idNumber, 'finger-print-outline', true)}
                  {renderField('Họ và tên', citizenCardResult.fullName, 'person-outline', true)}
                  {renderField('Ngày sinh', citizenCardResult.dateOfBirth, 'calendar-outline')}
                  {renderField('Giới tính', citizenCardResult.gender, 'transgender-outline')}
                  {renderField('Quê quán', citizenCardResult.placeOfOrigin, 'home-outline')}
                  {renderField('Nơi thường trú', citizenCardResult.placeOfResidence, 'location-outline')}
                </View>
              )}

              {/* Render Danh thiếp */}
              {structuredType === 'businessCard' && businessCardResult && (
                <View>
                  {renderField('Họ và tên', businessCardResult.name, 'person-outline', true)}
                  {renderField('Chức danh', businessCardResult.title, 'ribbon-outline')}
                  {renderField('Công ty / Tổ chức', businessCardResult.company, 'business-outline')}
                  {renderField('Số điện thoại', businessCardResult.phone, 'call-outline')}
                  {renderField('Email', businessCardResult.email, 'mail-outline')}
                  {renderField('Website', businessCardResult.website, 'globe-outline')}
                  {renderField('Địa chỉ', businessCardResult.address, 'location-outline')}
                </View>
              )}
            </ScrollView>

            {/* Action Buttons */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: theme.accent, flex: 1, marginTop: 0 }]}
                onPress={copyAllStructuredData}
              >
                <Ionicons name="copy" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={s.actionBtnText}>Sao chép tất cả</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: theme.blue, flex: 1, marginTop: 0 }]}
                onPress={copyJsonStructuredData}
              >
                <Ionicons name="code-slash" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={s.actionBtnText}>Sao chép JSON</Text>
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
  header: { paddingBottom: 20, paddingHorizontal: 20, borderBottomWidth: 1 },
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
  fieldCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  fieldValue: {
    lineHeight: 20,
  },
  structuredGroup: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    marginTop: 4,
  },
  groupHeaderTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 8,
  },
  itemRow: {
    paddingVertical: 8,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  itemMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemMeta: {
    fontSize: 12.5,
  },
  itemTotal: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  paymentBox: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    marginTop: 4,
    marginBottom: 10,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  paymentLabel: {
    fontSize: 13.5,
  },
  paymentValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalLabel: {
    fontSize: 14.5,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 17,
    fontWeight: '900',
  },
});
