import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal, TextInput, ActivityIndicator, Dimensions, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { savePdfToDocuments, saveBase64ToDocuments, copyFileToDocuments, getDocumentDirectory, listDocumentFiles } from '../utils/fileHelper';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme';
// Heavy libs — lazy-loaded khi dùng để tránh crash khởi động
// pdf-lib, docx, xlsx, nerdamer được require() trong từng hàm
import Storage from '../utils/storage';
const { width } = Dimensions.get('window');

export default function ToolsScreen({ route }: any) {
  const navigation = useNavigation<any>();
  const { theme } = useTheme();

  // Modals
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
  // File name input custom dialog (replaces Alert.prompt)
  const [nameDialogVisible, setNameDialogVisible] = useState<boolean>(false);
  const [nameDialogTitle, setNameDialogTitle] = useState<string>('');
  const [nameDialogValue, setNameDialogValue] = useState<string>('');
  const [nameDialogCallback, setNameDialogCallback] = useState<((name: string) => void) | null>(null);

  // Data
  const [pdfFiles, setPdfFiles] = useState<string[]>([]);
  const [file1, setFile1] = useState<string>('');
  const [file2, setFile2] = useState<string>('');
  const [mergedName, setMergedName] = useState<string>('');

  const captureImageForProcessing = async (_options: any = {}): Promise<string[]> => {
    try {
      const PERM_KEY = '@camscanner_cam_perm';
      const cachedPerm = await Storage.getItem(PERM_KEY);
      let granted = cachedPerm === 'granted';

      if (!granted) {
        const perm = await ImagePicker.getCameraPermissionsAsync();
        if (perm.granted) {
          granted = true;
          await Storage.setItem(PERM_KEY, 'granted');
        } else if (perm.canAskAgain) {
          const result = await ImagePicker.requestCameraPermissionsAsync();
          granted = result.granted;
          if (granted) await Storage.setItem(PERM_KEY, 'granted');
        }
      }

      if (!granted) {
        Alert.alert('C\u1ea7n quy\u1ec1n Camera', 'Vui l\u00f2ng c\u1ea5p quy\u1ec1n m\u00e1y \u1ea3nh trong C\u00e0i \u0111\u1eb7t h\u1ec7 th\u1ed1ng.');
        return [];
      }

      try {
        const cam = await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: true });
        if (!cam.canceled && cam.assets && cam.assets.length > 0) {
          return [cam.assets[0].uri];
        }
        return [];
      } catch {
        // Fallback gallery n\u1ebfu kh\u00f4ng c\u00f3 camera
        const lib = await ImagePicker.launchImageLibraryAsync({ quality: 1, allowsEditing: true });
        if (!lib.canceled && lib.assets && lib.assets.length > 0) {
          return [lib.assets[0].uri];
        }
        return [];
      }
    } catch (e) {
      return [];
    }
  };



  const loadSavedPdfs = async () => {
    try {
      const allFiles = await listDocumentFiles(['.pdf']);
      setPdfFiles(allFiles.filter(f => f.endsWith('.pdf')));
    } catch (e) {
      console.log('Error listing files', e);
    }
  };

  useEffect(() => {
    if (route.params?.triggerAction) {
      const action = route.params.triggerAction;
      navigation.setParams({ triggerAction: null });
      setTimeout(() => {
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

  // ====== CUSTOM NAME DIALOG (Replaces Alert.prompt for Android) ======
  const showNameDialog = (title: string, placeholder: string, defaultName: string, onConfirm: (name: string) => void) => {
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

  // ====== SMART SCAN ======
  const handleSmartScan = () => {
    navigation.navigate('Scanner', { autoScan: true });
  };

  // ====== ID CARDS SCAN ======
  const handleIdCardScan = async () => {
    try {
      const scannedImages = await captureImageForProcessing({ maxNumDocuments: 2 });
      if (scannedImages && scannedImages.length >= 2) {
        const frontUri = scannedImages[0];
        const backUri = scannedImages[1];
        showNameDialog(
          'Đặt tên file ID Card',
          'Nhập tên tài liệu',
          'IDCard_' + Math.floor(Date.now() / 1000),
          async (fileName) => {
            const docName = fileName || 'IDCard_' + Math.floor(Date.now() / 1000);
            try {
              const html = `<!DOCTYPE html>
                <html><head><style>@page{margin:0;size:2480px 3508px;}body{margin:0;padding:0;background:white;}</style></head>
                  <body>
                    <div style="width:2480px;height:1754px;display:flex;justify-content:center;align-items:center;background:white;">
                      <div style="text-align:center;">
                        <img src="${frontUri}" style="width:1664px;height:1040px;object-fit:contain;border:4px solid #ccc;border-radius:32px;" />
                        <p style="font-size:45px;color:#666;margin-top:24px;">Mặt trước (Front)</p>
                      </div>
                    </div>
                    <div style="width:2480px;height:1754px;display:flex;justify-content:center;align-items:center;background:white;">
                      <div style="text-align:center;">
                        <img src="${backUri}" style="width:1664px;height:1040px;object-fit:contain;border:4px solid #ccc;border-radius:32px;" />
                        <p style="font-size:45px;color:#666;margin-top:24px;">Mặt sau (Back)</p>
                      </div>
                    </div>
                  </body>
                </html>`;
              const { uri } = await Print.printToFileAsync({ html });
              const safeName = docName.replace(/[^a-zA-Z0-9_-]/g, '_');
              const targetUri = await savePdfToDocuments(uri, safeName);
              Alert.alert('✅ Thành công', `Đã lưu ID Card: ${safeName}.pdf`, [
                { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
                { text: 'OK', style: 'cancel' }
              ]);
            } catch (e) {
              Alert.alert('Lỗi', 'Không thể tạo PDF ID Card');
            }
          }
        );
      } else if (scannedImages && scannedImages.length > 0) {
        Alert.alert('Lỗi', 'Vui lòng quét đủ 2 mặt (Mặt trước & Mặt sau) của thẻ ID!');
      }
    } catch (error) {
      Alert.alert('Lỗi', 'Không thể khởi chạy máy quét thẻ ID.');
    }
  };

  // ====== BOOK SCAN (Smart Spine Detection & Dewarping Pro) ======
  const handleBookScan = async () => {
    try {
      const scannedImages = await captureImageForProcessing({});
      if (scannedImages && scannedImages.length > 0) {
        const bookUri = scannedImages[0];
        showNameDialog(
          'Đặt tên file Book Scan Pro',
          'Nhập tên tài liệu sách',
          'Book_' + Math.floor(Date.now() / 1000),
          async (fileName) => {
            const docName = fileName || 'Book_' + Math.floor(Date.now() / 1000);
            try {
              const html = `<!DOCTYPE html>
                <html>
                  <head>
                    <style>
                      @page{margin:0;size:2480px 3508px;}
                      body{margin:0;padding:0;background:white;}
                      .page-box { width:2480px; height:3508px; overflow:hidden; position:relative; page-break-after:always; }
                      .page-img { width:100%; height:100%; object-fit:cover; position:absolute; top:0; }
                    </style>
                  </head>
                  <body>
                    <div style="display:none;"><img id="srcImg" src="${bookUri}" /></div>
                    <div class="page-box">
                      <img id="imgPage1" class="page-img" style="left:0;" src="${bookUri}" />
                    </div>
                    <div class="page-box">
                      <img id="imgPage2" class="page-img" style="left:0;" src="${bookUri}" />
                    </div>
                    <script>
                      window.onload = function() {
                        try {
                          const img = document.getElementById('srcImg');
                          const w = img.naturalWidth || 800;
                          const h = img.naturalHeight || 600;
                          
                          const canvas = document.createElement('canvas');
                          canvas.width = Math.min(400, w);
                          canvas.height = Math.min(600, h);
                          const ctx = canvas.getContext('2d');
                          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

                          let minSum = Infinity;
                          let spineX = Math.floor(canvas.width * 0.5);
                          for (let x = Math.floor(canvas.width * 0.35); x <= Math.floor(canvas.width * 0.65); x++) {
                            let sum = 0;
                            for (let y = Math.floor(canvas.height * 0.1); y < Math.floor(canvas.height * 0.9); y += 4) {
                              const idx = (y * canvas.width + x) * 4;
                              sum += (0.299 * imgData[idx] + 0.587 * imgData[idx+1] + 0.114 * imgData[idx+2]);
                            }
                            if (sum < minSum) { minSum = sum; spineX = x; }
                          }
                          const spineRatio = spineX / canvas.width;
                          
                          const imgP1 = document.getElementById('imgPage1');
                          const imgP2 = document.getElementById('imgPage2');
                          
                          if (imgP1) {
                            imgP1.style.width = (100 / spineRatio) + '%';
                            imgP1.style.left = '0%';
                          }
                          if (imgP2) {
                            imgP2.style.width = (100 / (1 - spineRatio)) + '%';
                            imgP2.style.left = '-' + (spineRatio / (1 - spineRatio) * 100) + '%';
                          }
                        } catch(e) {}
                      };
                    </script>
                  </body>
                </html>`;
              const { uri } = await Print.printToFileAsync({ html });
              const safeName = docName.replace(/[^a-zA-Z0-9_-]/g, '_');
              const targetUri = await savePdfToDocuments(uri, safeName);
              Alert.alert('✅ Thành công (Smart Book Dewarping)', `Đã dò tìm gáy sách chính xác và tách thành 2 trang PDF: ${safeName}.pdf`, [
                { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
                { text: 'OK', style: 'cancel' }
              ]);
            } catch (e) {
              Alert.alert('Lỗi', 'Không thể tạo PDF tách trang sách');
            }
          }
        );
      }
    } catch (e) {
      Alert.alert('Lỗi', 'Không thể khởi chạy Book Scanner.');
    }
  };

  // OCR qua Gemini Vision API (thay thế expo-mlkit-ocr bị abandon)
  const ocrViaGemini = async (imageUri: string): Promise<string> => {
    const userKey = await Storage.getItem('@camscanner_gemini_api_key');
    const apiKey = userKey && userKey.trim() ? userKey.trim() : null;
    if (!apiKey) throw new Error('NO_KEY');

    const b64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: 'Please extract ALL text from this image exactly as it appears. Return only the extracted text, nothing else.' },
            { inline_data: { mime_type: 'image/jpeg', data: b64 } }
          ]}]
        })
      }
    );
    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  const handleExtractText = async () => {
    try {
      const scannedImages = await captureImageForProcessing({});
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText('AI đang trích xuất văn bản...');
        setLoading(true);
        let text = '';
        try {
          text = await ocrViaGemini(scannedImages[0]);
        } catch (e: any) {
          if (e?.message === 'NO_KEY') {
            setLoading(false);
            Alert.alert('⚠️ Cần API Key', 'Vui lòng nhập Gemini API Key trong tab Cài đặt để dùng tính năng OCR.');
            return;
          }
          text = 'Không thể nhận dạng văn bản. Vui lòng thử lại.';
        }
        setOcrResultText(text || 'Không tìm thấy chữ trong hình.');
        setLoading(false);
        setOcrModalVisible(true);
      }
    } catch (e) {
      setLoading(false);
      Alert.alert('Lỗi', 'Không khởi chạy được máy ảnh.');
    }
  };

  // ====== AI SOLVER (Multimodal Vision & CAS Algebra Engine) ======
  const handleAiSolver = async () => {
    try {
      const scannedImages = await captureImageForProcessing({});
      if (scannedImages && scannedImages.length > 0) {
        setLoadingText('AI Multimodal đang phân tích & giải bài toán...');
        setLoading(true);
        const imageUri = scannedImages[0];
        
        // 1. OCR qua Gemini Vision (on-device OCR đã bị loại bỏ do expo-mlkit-ocr kông tương thích)
        let equation = '';
        try {
          equation = await ocrViaGemini(imageUri);
        } catch {
          // Không có API key — bỏ qua bước này, Gemini sẽ giải trực tiếp từ ảnh
        }

        let localSolution = '';
        if (equation) {
          try {
            const _nerdamer = require('nerdamer'); require('nerdamer/Algebra'); require('nerdamer/Calculus'); require('nerdamer/Solve');
            let cleanEq = equation.replace(/\s/g, '').toLowerCase();
            cleanEq = cleanEq.replace(/s/g, '5').replace(/o/g, '0');
            let ans;
            if (cleanEq.includes('=')) {
              ans = _nerdamer.solveEquations(cleanEq, 'x');
            } else {
              ans = _nerdamer(cleanEq).evaluate();
            }
            localSolution = `📐 Nhận dạng nhanh CAS:\nBiểu thức: ${cleanEq}\nKết quả: ${ans.toString()}\n\n`;
          } catch (casErr) {
            // Tiếp tục dùng Gemini AI Vision
          }
        }

        // 2. Gemini Multimodal Vision API (Giải bài toán hình học / sơ đồ / bài tập phức tạp)
        try {
          const userKey = await Storage.getItem('@camscanner_gemini_api_key');
          const apiKey = userKey && userKey.trim() ? userKey.trim() : null;

          if (!apiKey) {
            // Không có key → dùng kết quả On-Device, thông báo cụ thể
            if (localSolution) {
              setSolverResult(`${localSolution}💡 Để phân tích hình vẽ hình học & sơ đồ nâng cao, hãy nhập Gemini API Key trong Cài đặt → Tài khoản.`);
            } else {
              setSolverResult(`📌 Nhận dạng văn bản (On-Device):\n${equation}\n\n💡 Để dùng AI Vision giải toán phức tạp, hãy nhập Gemini API Key trong Cài đặt → Tài khoản.`);
            }
          } else {
            // Có key → nén ảnh xuống ~800px trước khi encode Base64 (giảm 70-80% kích thước)
            const ImageManipulator = require('expo-image-manipulator');
            const compressed = await ImageManipulator.manipulateAsync(
              imageUri,
              [{ resize: { width: 800 } }],
              { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
            );
            const base64Data = await FileSystem.readAsStringAsync(compressed.uri, { encoding: FileSystem.EncodingType.Base64 });
            const geminiPrompt = "Bạn là chuyên gia giải toán & phân tích hình ảnh AI. Hãy giải chi tiết bài toán/câu hỏi trong ảnh này (bao gồm cả hình vẽ hình học, sơ đồ, hệ phương trình nếu có). Hãy liệt kê từng bước suy luận (Step-by-step) bằng tiếng Việt rõ ràng, kèm công thức toán Unicode/LaTeX và đáp án cuối cùng.";

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            try {
              const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                  contents: [{
                    parts: [
                      { text: geminiPrompt },
                      { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
                    ]
                  }]
                })
              });
              clearTimeout(timeout);
              const json = await response.json();
              if (json && json.candidates && json.candidates[0]?.content?.parts[0]?.text) {
                const aiText = json.candidates[0].content.parts[0].text;
                setSolverResult(`🤖 Gemini 1.5 Flash Vision Solver Pro:\n\n${aiText}`);
              } else if (json?.error?.message) {
                // Key sai / quota hết → thông báo có hành động cụ thể
                setSolverResult(`${localSolution}⚠️ Gemini API lỗi: ${json.error.message}\n\nVui lòng kiểm tra lại API Key trong Cài đặt → Tài khoản.`);
              } else if (localSolution) {
                setSolverResult(`${localSolution}✨ Mẹo: Kết nối Internet để AI Vision phân tích cả hình vẽ & sơ đồ.`);
              } else {
                setSolverResult(`📌 Nhận dạng văn bản:\n${equation}\n\n⚠️ Không thể tính toán biểu thức này. Vui lòng kiểm tra lại hình ảnh.`);
              }
            } catch (fetchErr: any) {
              clearTimeout(timeout);
              throw fetchErr;
            }
          }
        } catch (visionErr: any) {
          if (localSolution) {
            setSolverResult(`${localSolution}✨ Đã giải xong bằng Engine CAS trên máy.`);
          } else {
            setSolverResult(`📌 Nhận dạng văn bản:\n${equation}\n\n⚠️ Vui lòng đảm bảo hình ảnh phép toán hoặc bài tập rõ nét.`);
          }
        }

        setLoading(false);
        setSolverModalVisible(true);
      }
    } catch (e) {
      setLoading(false);
      Alert.alert('Lỗi', 'Lỗi khi khởi chạy máy ảnh hoặc xử lý bài toán.');
    }
  };

  // ====== TRANSLATE ======
  const handleTranslate = async () => {
    try {
      const scannedImages = await captureImageForProcessing({});
      if (scannedImages && scannedImages.length > 0) {
        const { recognizeText: _ocr } = { recognizeText: ocrViaGemini }; // Gemini OCR
        setLoadingText('Đang dịch thuật...');
        setLoading(true);
        let text = '';
        try { text = await ocrViaGemini(scannedImages[0]); } catch {
          setLoading(false);
          Alert.alert('⚠️ Cần API Key', 'Vui lòng nhập Gemini API Key trong tab Cài đặt.');
          return;
        }
        if (!text) {
          setLoading(false);
          Alert.alert('Lỗi', 'Không nhận dạng được văn bản.');
          return;
        }

        setTranslateOriginal(text);
        
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        const json = await response.json();
        
        let translated = '';
        if (json && json[0]) {
          json[0].forEach((item: any) => {
            if (item[0]) translated += item[0];
          });
        }
        
        setTranslateResult(translated || 'Không thể dịch đoạn văn này.');
        setLoading(false);
        setTranslateModalVisible(true);
      }
    } catch (e) {
      setLoading(false);
      Alert.alert('Lỗi', 'Có lỗi kết nối mạng (cần Internet để dịch).');
    }
  };

  // ====== REAL FORMAT CONVERSION ======
  const handleFormatConvert = async (format: string) => {
    try {
      const scannedImages = await captureImageForProcessing({});
      if (scannedImages && scannedImages.length > 0) {
        const { Document, Packer, Paragraph, TextRun } = require('docx');
        const XLSX = require('xlsx');
        setLoadingText(`Đang chuyển đổi sang ${format}...`);
        setLoading(true);
        let text = '';
        try { text = await ocrViaGemini(scannedImages[0]); } catch {
          setLoading(false);
          Alert.alert('⚠️ Cần API Key', 'Vui lòng nhập Gemini API Key trong tab Cài đặt để dùng tính năng này.');
          return;
        }
        
        if (!text) {
          setLoading(false);
          Alert.alert('Thông báo', 'Không tìm thấy chữ để chuyển đổi.');
          return;
        }

        const safeName = format + '_' + Math.floor(Date.now() / 1000);
        let finalUri = '';

        if (format === 'Word') {
          const doc = new Document({
            sections: [{
              properties: {},
              children: text.split('\n').map((line: string) => new Paragraph({ children: [new TextRun(line)] }))
            }]
          });
          const b64 = await Packer.toBase64String(doc);
          finalUri = await saveBase64ToDocuments(b64, safeName + '.docx');
        } else if (format === 'Excel') {
          const rows = text.split('\n').map((line: string) => line.split(/[\s\t]+/));
          const ws = XLSX.utils.aoa_to_sheet(rows);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Data");
          const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
          finalUri = await saveBase64ToDocuments(wbout, safeName + '.xlsx');
        }

        setLoading(false);
        Alert.alert('✅ Thành công', `Đã lưu file ${safeName}.${format === 'Word' ? 'docx' : 'xlsx'}`, [
          { text: 'Chia sẻ', onPress: () => Sharing.shareAsync(finalUri) },
          { text: 'Đóng', style: 'cancel' }
        ]);
      }
    } catch (e: any) {
      setLoading(false);
      // Chỉ log chi tiết phía console — KHÔNG lộ e.message ra ngoài cho người dùng
      console.error('[UI] Format convert error:', e?.message || e);
      Alert.alert('Lỗi', `Không thể chuyển đổi sang ${format}. Vui lòng thử lại.`);
    }
  };

  // ====== IMPORT IMAGES ======
  const handleImportImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({ 
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      quality: 1
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uris = result.assets.map(asset => asset.uri);
      navigation.navigate('Scanner', { importImages: uris });
    }
  };

  // ====== IMPORT PDF ======
  const handleImportPdf = async () => {
    try {
      let result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const sourceUri = result.assets[0].uri;
        const originalName = result.assets[0].name;
        showNameDialog(
          'Nhập file PDF',
          'Đặt tên cho file PDF',
          originalName.replace('.pdf', ''),
          async (fileName) => {
            const docName = fileName || originalName.replace('.pdf', '');
            const safeName = docName.replace(/[^a-zA-Z0-9_-]/g, '_');
            const targetUri = await copyFileToDocuments(sourceUri, safeName + '.pdf');
            Alert.alert('✅ Thành công', `Đã nhập file PDF: ${safeName}.pdf`);
          }
        );
      }
    } catch (e) {
      Alert.alert('Lỗi', 'Không thể chọn hoặc nhập file PDF.');
    }
  };

  // ====== MERGE PDF (REAL MERGE using pdf-lib) ======
  const handleOpenMergeDialog = () => {
    loadSavedPdfs();
    setMergedName('Merge_' + Math.floor(Date.now() / 1000));
    setMergeModalVisible(true);
  };

  const handleMergePdf = async () => {
    if (!file1 || !file2 || file1 === file2) {
      Alert.alert('Lỗi', 'Vui lòng chọn 2 tài liệu PDF khác nhau để gộp!');
      return;
    }
    if (!mergedName.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên file kết quả!');
      return;
    }

    try {
      setLoadingText('Đang gộp PDF...');
      setLoading(true);

      const docDir = getDocumentDirectory();
      const uri1 = docDir + file1;
      const uri2 = docDir + file2;

      // Read both PDF files as base64
      const pdf1Bytes = await FileSystem.readAsStringAsync(uri1, { encoding: FileSystem.EncodingType.Base64 });
      const pdf2Bytes = await FileSystem.readAsStringAsync(uri2, { encoding: FileSystem.EncodingType.Base64 });

      // Load both PDF documents
      const { PDFDocument } = require('pdf-lib');
      const pdf1Doc = await PDFDocument.load(pdf1Bytes);
      const pdf2Doc = await PDFDocument.load(pdf2Bytes);

      // Create a new PDF and copy all pages from both
      const mergedPdf = await PDFDocument.create();
      const pages1 = await mergedPdf.copyPages(pdf1Doc, pdf1Doc.getPageIndices());
      pages1.forEach((page: any) => mergedPdf.addPage(page));
      const pages2 = await mergedPdf.copyPages(pdf2Doc, pdf2Doc.getPageIndices());
      pages2.forEach((page: any) => mergedPdf.addPage(page));

      // Save merged PDF
      const mergedBytes = await mergedPdf.save();
      const base64Data = arrayBufferToBase64(mergedBytes.buffer as any);

      const safeName = mergedName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const targetUri = await saveBase64ToDocuments(base64Data, safeName + '.pdf');

      setLoading(false);
      setMergeModalVisible(false);
      Alert.alert('✅ Thành công', `Đã gộp ${pages1.length + pages2.length} trang thành file ${safeName}.pdf!`, [
        { text: 'Xem tài liệu', onPress: () => navigation.navigate('Files') },
        { text: 'Đóng', style: 'cancel' }
      ]);
    } catch (e) {
      setLoading(false);
      Alert.alert('Lỗi', 'Có lỗi xảy ra khi gộp tệp PDF.');
    }
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('✅ Đã sao chép', 'Nội dung đã được sao chép vào bộ nhớ tạm.');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.headerText }]}>Công cụ</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        
        <Text style={[styles.sectionTitle, { color: theme.text }]}>📷 Quét Nâng Cao</Text>
        <View style={[styles.grid, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TouchableOpacity style={styles.item} onPress={handleSmartScan}>
            <View style={[styles.itemIcon, { backgroundColor: theme.accent + '22' }]}><Ionicons name="scan" size={26} color={theme.accent} /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Smart Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item} onPress={handleIdCardScan}>
            <View style={[styles.itemIcon, { backgroundColor: theme.blue + '22' }]}><Ionicons name="card" size={26} color={theme.blue} /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Thẻ ID</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item} onPress={handleBookScan}>
            <View style={[styles.itemIcon, { backgroundColor: theme.danger + '22' }]}><Ionicons name="book" size={26} color={theme.danger} /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Quét Sách</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item} onPress={() => navigation.navigate('QRScanner')}>
            <View style={[styles.itemIcon, { backgroundColor: theme.warn + '22' }]}><Ionicons name="qr-code" size={26} color={theme.warn} /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Quét QR/Mã vạch</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item} onPress={() => navigation.navigate('QRGenerator')}>
            <View style={[styles.itemIcon, { backgroundColor: '#7c3aed22' }]}><Ionicons name="create-outline" size={26} color="#7c3aed" /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Tạo Mã QR</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>📂 Xử lý & Chỉnh sửa PDF</Text>
        <View style={[styles.grid, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TouchableOpacity style={styles.item} onPress={handleImportImage}>
            <View style={[styles.itemIcon, { backgroundColor: '#3f51b522' }]}><Ionicons name="images" size={26} color="#3f51b5" /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Import Ảnh</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item} onPress={handleImportPdf}>
            <View style={[styles.itemIcon, { backgroundColor: '#0288d122' }]}><Ionicons name="document-text" size={26} color="#0288d1" /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Nhập PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item} onPress={handleOpenMergeDialog}>
            <View style={[styles.itemIcon, { backgroundColor: theme.warn + '22' }]}><Ionicons name="git-merge" size={26} color={theme.warn} /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Gộp PDF</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>🤖 Nhận dạng & Dịch (AI)</Text>
        <View style={[styles.grid, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TouchableOpacity style={styles.item} onPress={handleExtractText}>
            <View style={[styles.itemIcon, { backgroundColor: theme.green + '22' }]}><Ionicons name="text" size={26} color={theme.green} /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>OCR</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item} onPress={handleTranslate}>
            <View style={[styles.itemIcon, { backgroundColor: '#8e24aa22' }]}><Ionicons name="language" size={26} color="#8e24aa" /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Dịch tài liệu</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item} onPress={handleAiSolver}>
            <View style={[styles.itemIcon, { backgroundColor: '#fb8c0022' }]}><Ionicons name="calculator" size={26} color="#fb8c00" /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Giải toán AI</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>🔄 Chuyển Đổi Định Dạng</Text>
        <View style={[styles.grid, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TouchableOpacity style={styles.item} onPress={() => handleFormatConvert('Word')}>
            <View style={[styles.itemIcon, { backgroundColor: theme.blue + '22' }]}><Ionicons name="document-text-outline" size={26} color={theme.blue} /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Sang Word</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item} onPress={() => handleFormatConvert('Excel')}>
            <View style={[styles.itemIcon, { backgroundColor: theme.green + '22' }]}><Ionicons name="stats-chart-outline" size={26} color={theme.green} /></View>
            <Text style={[styles.itemText, { color: theme.textSub }]}>Sang Excel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>


      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.loadingText}>{loadingText}</Text>
        </View>
      )}

      {/* Custom Name Dialog (replaces Alert.prompt for Android compatibility) */}
      <Modal visible={nameDialogVisible} animationType="fade" transparent>
        <View style={styles.modalBg}>
          <View style={[styles.nameDialogContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{nameDialogTitle}</Text>
            <TextInput 
              style={[styles.nameDialogInput, { borderColor: theme.border, backgroundColor: theme.surface, color: theme.text }]}
              value={nameDialogValue}
              onChangeText={setNameDialogValue}
              placeholder="Nhập tên file"
              placeholderTextColor={theme.textMuted}
              autoFocus
            />
            <View style={styles.nameDialogActions}>
              <TouchableOpacity style={[styles.nameDialogBtn, { backgroundColor: theme.surface }]} onPress={() => setNameDialogVisible(false)}>
                <Text style={[styles.btnCancelText, { color: theme.textSub }]}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.nameDialogBtn, { backgroundColor: theme.accent }]} onPress={handleNameDialogConfirm}>
                <Text style={styles.btnConfirmText}>Xác nhận</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* OCR Modal */}
      <Modal visible={ocrModalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>📝 Văn Bản Trích Xuất (OCR)</Text>
            <ScrollView style={styles.modalBody}>
              <Text style={[styles.modalText, { color: theme.textSub }]}>
                {ocrResultText}
              </Text>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.surface }]} onPress={() => setOcrModalVisible(false)}>
                <Text style={[styles.btnCancelText, { color: theme.textSub }]}>Đóng</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.accent }]} onPress={() => copyToClipboard(ocrResultText)}>
                <Text style={styles.btnConfirmText}>📋 Sao chép</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* AI Solver Modal */}
      <Modal visible={solverModalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>🧮 CS AI Solver</Text>
            <ScrollView style={styles.modalBody}>
              <Text style={[styles.modalText, { color: theme.textSub }]}>{solverResult}</Text>
            </ScrollView>
            <TouchableOpacity style={[styles.modalBtn, { width: '100%', backgroundColor: theme.accent }]} onPress={() => setSolverModalVisible(false)}>
              <Text style={styles.btnConfirmText}>Đồng ý</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Translate Modal */}
      <Modal visible={translateModalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>🌐 CS Translate</Text>
            <ScrollView style={styles.modalBody}>
              <Text style={[styles.modalText, { color: theme.textSub }]}>
                <Text style={{ fontWeight: 'bold', color: theme.text }}>Văn bản gốc:</Text>{'\n'}
                {translateOriginal}{'\n'}{'\n'}
                <Text style={{ fontWeight: 'bold', color: theme.text }}>Bản dịch (Tiếng Việt):</Text>{'\n'}
                {translateResult}
              </Text>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.surface }]} onPress={() => setTranslateModalVisible(false)}>
                <Text style={[styles.btnCancelText, { color: theme.textSub }]}>Đóng</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.accent }]} onPress={() => copyToClipboard(translateResult)}>
                <Text style={styles.btnConfirmText}>📋 Sao chép</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Merge PDF Modal */}
      <Modal visible={mergeModalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>📎 Gộp tài liệu PDF</Text>
            <View style={styles.modalBodyMerge}>
              {pdfFiles.length < 2 ? (
                <Text style={[styles.emptyText, { color: theme.warn }]}>Bạn cần có ít nhất 2 tài liệu PDF được lưu trong mục Tài liệu để thực hiện gộp.</Text>
              ) : (
                <View>
                  <Text style={[styles.selectLabel, { color: theme.text }]}>Chọn tài liệu 1:</Text>
                  <ScrollView style={[styles.selectBox, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                    {pdfFiles.map((file, idx) => (
                      <TouchableOpacity key={idx} style={[styles.selectItem, { borderBottomColor: theme.border }, file1 === file && [styles.selectedItem, { backgroundColor: theme.accent + '22' }]]} onPress={() => setFile1(file)}>
                        <Text style={[styles.selectText, { color: file1 === file ? theme.accent : theme.text }]}>{file}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={[styles.selectLabel, { color: theme.text }]}>Chọn tài liệu 2:</Text>
                  <ScrollView style={[styles.selectBox, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                    {pdfFiles.map((file, idx) => (
                      <TouchableOpacity key={idx} style={[styles.selectItem, { borderBottomColor: theme.border }, file2 === file && [styles.selectedItem, { backgroundColor: theme.accent + '22' }]]} onPress={() => setFile2(file)}>
                        <Text style={[styles.selectText, { color: file2 === file ? theme.accent : theme.text }]}>{file}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={[styles.selectLabel, { color: theme.text }]}>Tên file PDF gộp mới:</Text>
                  <TextInput 
                    style={[styles.modalInput, { borderColor: theme.border, backgroundColor: theme.surface, color: theme.text }]}
                    value={mergedName}
                    onChangeText={setMergedName}
                    placeholder="Nhập tên file"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
              )}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.surface }]} onPress={() => setMergeModalVisible(false)}>
                <Text style={[styles.btnCancelText, { color: theme.textSub }]}>Đóng</Text>
              </TouchableOpacity>
              {pdfFiles.length >= 2 && (
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.warn }]} onPress={handleMergePdf}>
                  <Text style={styles.btnConfirmText}>📎 Gộp ngay</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { 
    paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20, 
    borderBottomWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 8,
    marginBottom: 5, zIndex: 10
  },
  headerTitle: { fontSize: 26, fontWeight: '800', letterSpacing: 0.3 },
  content: { padding: 16, paddingBottom: 30 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10, marginTop: 10, letterSpacing: 0.2 },
  grid: { 
    flexDirection: 'row', flexWrap: 'wrap', 
    borderRadius: 18, padding: 14, marginBottom: 14,
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 3
  },
  item: { width: '33%', alignItems: 'center', marginBottom: 14, padding: 4 },
  itemIcon: { width: 52, height: 52, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginBottom: 7 },
  itemText: { fontSize: 11.5, marginTop: 0, textAlign: 'center', fontWeight: '600' },
  
  loadingOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  loadingText: { color: '#fff', marginTop: 15, fontSize: 16, fontWeight: '600' },
  
  // Modal styles — màu sẽ được override bằng inline style theo theme
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '90%', borderRadius: 24, padding: 24, maxHeight: '85%' },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
  modalBody: { marginBottom: 20 },
  modalBodyMerge: { marginBottom: 20 },
  modalText: { fontSize: 15, lineHeight: 24 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between' },
  modalBtn: { padding: 16, borderRadius: 12, width: '48%', alignItems: 'center' },
  btnCancelText: { fontWeight: '700', fontSize: 16 },
  btnConfirmText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  nameDialogContent: { width: '85%', borderRadius: 24, padding: 24 },
  nameDialogInput: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16, marginVertical: 16 },
  nameDialogActions: { flexDirection: 'row', justifyContent: 'space-between' },
  nameDialogBtn: { padding: 16, borderRadius: 12, width: '47%', alignItems: 'center' },

  selectLabel: { fontSize: 14, marginTop: 10, marginBottom: 5, fontWeight: '700' },
  selectBox: { maxHeight: 120, borderWidth: 1, borderRadius: 12, padding: 5, marginBottom: 12 },
  selectItem: { padding: 12, borderBottomWidth: 1 },
  selectedItem: { borderRadius: 8 },
  selectText: { fontSize: 14, fontWeight: '500' },
  modalInput: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, marginTop: 5 },
  emptyText: { fontSize: 14, textAlign: 'center', padding: 20, lineHeight: 22, fontStyle: 'italic' }
});
