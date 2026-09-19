import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, TextInput,
  ScrollView, Alert, KeyboardAvoidingView, Platform, Dimensions, ActivityIndicator,
  FlatList, Modal
} from 'react-native';

import * as Print from 'expo-print';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';

// Safe Dynamic Loader for DocumentScanner to prevent fatal startup crash
let cachedDocumentScanner: any = null;
let scannerChecked = false;

function getDocumentScanner(): any {
  if (scannerChecked) return cachedDocumentScanner;
  try {
    const mod = require('react-native-document-scanner-plugin');
    cachedDocumentScanner = mod.default || mod;
  } catch (err) {
    console.warn('[Scanner] Native DocumentScanner plugin is not available:', err);
    cachedDocumentScanner = null;
  }
  scannerChecked = true;
  return cachedDocumentScanner;
}

import { FilterMode, getCanvasProcessingScript, getCssFilterForMode } from '../utils/imageProcessor';
import { savePdfToDocuments, getDocumentDirectory } from '../utils/fileHelper';
import Storage from '../utils/storage';
import { STORAGE_KEYS, IMAGE_PROCESSING_CONFIG } from '../constants/config';
import CropView, { Point } from '../components/CropView';

const { width, height } = Dimensions.get('window');

export default function ScannerScreen({ route, navigation }: any) {
  const [images, setImages] = useState<string[]>([]);
  const genDefaultFileName = () => {
    return `SCAN_${Date.now()}`;
  };

  const [filterMode, setFilterMode] = useState<FilterMode>('magic');
  const [scanQuality, setScanQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [saveOriginal, setSaveOriginal] = useState(true);
  const [trimMargin, setTrimMargin] = useState(true); // Default to true to remove excess borders
  const [bookMode, setBookMode] = useState<boolean>(route.params?.bookMode || false);
  const [watermark, setWatermark] = useState<string>('');
  const [watermarkModalVisible, setWatermarkModalVisible] = useState<boolean>(false);
  const [customWatermarkInput, setCustomWatermarkInput] = useState<string>('');
  const [fileName, setFileName] = useState(genDefaultFileName());
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Crop State
  const [isCropping, setIsCropping] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [customCorners, setCustomCorners] = useState<{ [index: number]: Point[] }>({});
  const [sessionChecked, setSessionChecked] = useState(false);

  const DRAFT_SCAN_SESSION_KEY = 'DRAFT_SCAN_SESSION';

  // Tự động lưu draft session mỗi khi images thay đổi
  useEffect(() => {
    if (!sessionChecked) return;
    const saveDraft = async () => {
      try {
        if (images.length > 0) {
          await Storage.setItem(
            DRAFT_SCAN_SESSION_KEY,
            JSON.stringify({
              images,
              fileName,
              filterMode,
              bookMode,
              timestamp: Date.now(),
            })
          );
        } else {
          await Storage.removeItem(DRAFT_SCAN_SESSION_KEY);
        }
      } catch (e) {
        console.warn('[Scanner] Failed to save draft session:', e);
      }
    };
    saveDraft();
  }, [images, fileName, filterMode, bookMode, sessionChecked]);

  useEffect(() => {
    // Tải cấu hình từ Cài đặt
    const initSettings = async () => {
      try {
        const q = await Storage.getItem(STORAGE_KEYS.SCAN_QUALITY);
        const c = await Storage.getItem(STORAGE_KEYS.COLOR_MODE);
        const s = await Storage.getItem(STORAGE_KEYS.SAVE_ORIGINAL);
        if (q === 'high' || q === 'medium' || q === 'low') setScanQuality(q);
        if (c === 'grayscale') setFilterMode('grayscale');
        else if (c === 'bw') setFilterMode('bw');
        else if (c === 'color') setFilterMode('magic');
        if (s !== null) setSaveOriginal(s === 'true');
      } catch (e) {
        console.warn('[Scanner] Failed to read user settings:', e);
      }
    };
    initSettings();
  }, []);

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 1,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uris = result.assets.map(a => a.uri);
        setImages(prev => [...prev, ...uris]);
      }
    } catch (err) {
      console.warn('[Scanner] Pick image error:', err);
    }
  };

  const takePhotoFallback = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Quyền truy cập Camera', 'Ứng dụng cần quyền sử dụng máy ảnh để chụp tài liệu.');
        if (images.length === 0) navigation.goBack();
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: scanQuality === 'high' ? 1 : scanQuality === 'medium' ? 0.85 : 0.7,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImages(prev => [...prev, result.assets[0].uri]);
      } else if (images.length === 0) {
        navigation.goBack();
      }
    } catch (err) {
      console.warn('[Scanner] Camera fallback error:', err);
      if (images.length === 0) navigation.goBack();
    }
  };

  const startScan = async () => {
    try {
      const scanner = getDocumentScanner();
      if (!scanner || typeof scanner.scanDocument !== 'function') {
        Alert.alert(
          'Máy quét tài liệu',
          'Trình quét phần cứng (Google ML Kit) chưa sẵn sàng hoặc không hỗ trợ trên thiết bị này. Bạn có muốn chụp ảnh bằng camera hoặc chọn ảnh từ thư viện?',
          [
            { text: 'Hủy', style: 'cancel', onPress: () => { if (images.length === 0) navigation.goBack(); } },
            { text: 'Chụp ảnh', onPress: takePhotoFallback },
            { text: 'Chọn ảnh', onPress: pickImage },
          ]
        );
        return;
      }

      const { scannedImages, status } = await scanner.scanDocument({
        maxNumDocuments: 20,
      });

      if (status === 'success' && scannedImages && scannedImages.length > 0) {
        setImages(prev => [...prev, ...scannedImages]);
      } else if (images.length === 0) {
        navigation.goBack();
      }
    } catch (e: any) {
      console.error('[Scanner] DocumentScanner error:', e);
      Alert.alert(
        'Lỗi máy quét',
        'Không thể khởi động máy quét tự động. Bạn có muốn dùng máy ảnh thông thường?',
        [
          { text: 'Hủy', style: 'cancel', onPress: () => { if (images.length === 0) navigation.goBack(); } },
          { text: 'Chụp camera', onPress: takePhotoFallback },
          { text: 'Chọn ảnh', onPress: pickImage },
        ]
      );
    }
  };

  useEffect(() => {
    // 1. Nếu có ảnh truyền sang từ route.params (ví dụ từ FilesScreen hoặc ToolsScreen)
    if (route.params?.importImages && Array.isArray(route.params.importImages) && route.params.importImages.length > 0) {
      setImages(route.params.importImages);
      setSessionChecked(true);
      return;
    }

    // 2. Kiểm tra draft session trước khi bắt đầu quét mới
    const checkDraftAndInit = async () => {
      try {
        const rawDraft = await Storage.getItem(DRAFT_SCAN_SESSION_KEY);
        if (rawDraft) {
          const draft = JSON.parse(rawDraft);
          const isRecent = Date.now() - (draft.timestamp || 0) < 24 * 60 * 60 * 1000;
          if (isRecent && Array.isArray(draft.images) && draft.images.length > 0) {
            Alert.alert(
              '📄 Khôi phục phiên quét',
              `Tìm thấy phiên quét dở dang gồm ${draft.images.length} trang chưa lưu. Bạn có muốn tiếp tục không?`,
              [
                {
                  text: 'Bỏ qua',
                  style: 'destructive',
                  onPress: async () => {
                    await Storage.removeItem(DRAFT_SCAN_SESSION_KEY);
                    setSessionChecked(true);
                    startScan();
                  },
                },
                {
                  text: 'Khôi phục',
                  onPress: () => {
                    setImages(draft.images);
                    if (draft.fileName) setFileName(draft.fileName);
                    if (draft.filterMode) setFilterMode(draft.filterMode);
                    if (typeof draft.bookMode === 'boolean') setBookMode(draft.bookMode);
                    setSessionChecked(true);
                  },
                },
              ]
            );
            return;
          } else {
            await Storage.removeItem(DRAFT_SCAN_SESSION_KEY);
          }
        }
      } catch (e) {
        console.warn('[Scanner] Error checking draft:', e);
      }
      setSessionChecked(true);
      startScan();
    };

    checkDraftAndInit();
  }, [route.params?.importImages]);


  const handleDeleteImage = async (index: number) => {
    const remaining = images.filter((_, i) => i !== index);
    setImages(remaining);
    setCustomCorners(prev => {
      const next = { ...prev };
      delete next[index];
      const remapped: any = {};
      Object.keys(next).forEach(k => {
        const kNum = parseInt(k);
        if (kNum > index) {
          remapped[kNum - 1] = next[kNum];
        } else {
          remapped[kNum] = next[kNum];
        }
      });
      return remapped;
    });
    if (remaining.length === 0) {
      await Storage.removeItem(DRAFT_SCAN_SESSION_KEY);
      navigation.goBack();
    }
  };

  const handleRotateImage = async (index: number) => {
    try {
      const targetUri = images[index];
      const manipResult = await ImageManipulator.manipulateAsync(
        targetUri,
        [{ rotate: 90 }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
      const updated = [...images];
      updated[index] = manipResult.uri;
      setImages(updated);

      if (customCorners[index]) {
        setCustomCorners(prev => {
          const next = { ...prev };
          next[index] = next[index].map(pt => ({
            x: Math.max(0, Math.min(1, 1 - pt.y)),
            y: Math.max(0, Math.min(1, pt.x)),
          }));
          return next;
        });
      }
    } catch (err) {
      console.warn('[Scanner] Rotate image error:', err);
      Alert.alert('Lỗi', 'Không thể xoay ảnh này.');
    }
  };

  const handleMoveImage = (index: number, direction: 'left' | 'right') => {
    const targetIdx = direction === 'left' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= images.length) return;

    const newImages = [...images];
    const temp = newImages[index];
    newImages[index] = newImages[targetIdx];
    newImages[targetIdx] = temp;
    setImages(newImages);

    setCustomCorners(prev => {
      const next = { ...prev };
      const cCurrent = next[index];
      const cTarget = next[targetIdx];
      if (cCurrent) next[targetIdx] = cCurrent; else delete next[targetIdx];
      if (cTarget) next[index] = cTarget; else delete next[index];
      return next;
    });
  };

  const createPdf = async () => {
    const trimPercent = trimMargin
      ? IMAGE_PROCESSING_CONFIG.EDGE_CLEANUP_TRIM_PERCENT
      : IMAGE_PROCESSING_CONFIG.DEFAULT_TRIM_MARGIN_PERCENT;
    const canvasScript = getCanvasProcessingScript();
    const cssFilter = getCssFilterForMode(filterMode);

    // Chọn tham số nén và độ tương phản theo scanQuality đã cấu hình tập trung
    let targetWidth: number = IMAGE_PROCESSING_CONFIG.QUALITY.medium.width;
    let targetCompress: number = IMAGE_PROCESSING_CONFIG.QUALITY.medium.compress;
    let scanContrast: number = IMAGE_PROCESSING_CONFIG.DEFAULT_CONTRAST;

    if (scanQuality === 'high') {
      targetWidth = IMAGE_PROCESSING_CONFIG.QUALITY.high.width;
      targetCompress = IMAGE_PROCESSING_CONFIG.QUALITY.high.compress;
      scanContrast = 1.55;
    } else if (scanQuality === 'low') {
      targetWidth = IMAGE_PROCESSING_CONFIG.QUALITY.low.width;
      targetCompress = IMAGE_PROCESSING_CONFIG.QUALITY.low.compress;
      scanContrast = 1.35;
    }

    // Xử lý nén ảnh theo batch nhỏ và dùng trực tiếp file URI (không nhồi Base64 vào JS RAM)
    const imgTagsArray: string[] = [];
    const BATCH_SIZE = 2;
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);
      const processedBatch = await Promise.all(
        batch.map(async (imgUri, batchIdx) => {
          const actualIndex = i + batchIdx;
          let fileUri = imgUri;
          if (!imgUri.startsWith('data:')) {
            try {
              const manipResult = await ImageManipulator.manipulateAsync(
                imgUri,
                [{ resize: { width: targetWidth } }],
                { compress: targetCompress, format: ImageManipulator.SaveFormat.JPEG, base64: false }
              );
              fileUri = manipResult.uri;
            } catch (e) {
              console.warn('[Scanner] Image process error:', e);
              fileUri = imgUri;
            }
          }
          return `<div class="page">
            <img id="scanImg_${actualIndex}" src="${fileUri}" style="${filterMode !== 'magic' ? `filter: ${cssFilter};` : ''}" crossorigin="anonymous" />
            ${watermark ? `<div class="watermark">${watermark}</div>` : ''}
          </div>`;
        })
      );
      imgTagsArray.push(...processedBatch);
    }
    const imgTags = imgTagsArray.join('');

    const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            @page { size: 2480px 3508px; margin: 0; }
            html, body { width: 100%; background: white; }
            .page {
              width: 2480px;
              height: 3508px;
              display: flex;
              justify-content: center;
              align-items: center;
              page-break-after: always;
              overflow: hidden;
              background: white;
              position: relative;
            }
            .page img, .page canvas {
              width: 100%;
              height: 100%;
              object-fit: contain;
              display: block;
            }
            .watermark {
              position: absolute;
              top: 45%;
              left: 5%;
              width: 90%;
              transform: rotate(-30deg);
              font-size: 85px;
              font-family: Arial, Helvetica, sans-serif;
              color: rgba(220, 53, 69, 0.28);
              font-weight: 900;
              text-align: center;
              pointer-events: none;
              text-transform: uppercase;
              letter-spacing: 12px;
              z-index: 99;
            }
          </style>
        </head>
        <body>
          ${imgTags}
          <script>
            ${canvasScript}
            window.onload = function() {
              const total = ${images.length};
              const filter = "${filterMode}";
              const trimP = ${trimPercent};
              const customMap = ${JSON.stringify(customCorners)};
              for (let i = 0; i < total; i++) {
                const img = document.getElementById('scanImg_' + i);
                if (img) {
                  try {
                    const opts = {
                      trimMarginPercent: trimP,
                      contrast: ${scanContrast},
                      enablePerspectiveWarp: true,
                      bookMode: ${bookMode} // Chế độ quét sách: nắn thẳng gáy sách cong nếu bật
                    };
                    if (customMap[i]) {
                      opts.customCornersRatio = customMap[i];
                    }
                    const newSrc = processImageCanvas(img, filter, opts);
                    img.src = newSrc;
                  } catch (e) {
                    console.log('Canvas process error:', e);
                  }
                }
              }
            };
          </script>
        </body>
      </html>
    `;

    const { uri } = await Print.printToFileAsync({
      html,
      width: 595.28,
      height: 841.89, 
      base64: false
    });
    return uri;
  };

  const handleSave = async () => {
    if (!fileName.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên file!');
      return;
    }
    if (images.length === 0) return;
    
    setSaving(true);
    try {
      const uri = await createPdf();
      await savePdfToDocuments(uri, fileName);

      // Xử lý setting 'Giữ ảnh gốc' (saveOriginal)
      if (saveOriginal) {
        try {
          const docRoot = getDocumentDirectory();
          const imgFolder = `${docRoot}${fileName}_images/`;
          const folderInfo = await FileSystem.getInfoAsync(imgFolder);
          if (!folderInfo.exists) {
            await FileSystem.makeDirectoryAsync(imgFolder, { intermediates: true });
          }
          for (let i = 0; i < images.length; i++) {
            const src = images[i];
            const dest = `${imgFolder}trang_${i + 1}.jpg`;
            if (src.startsWith('file://')) {
              await FileSystem.copyAsync({ from: src, to: dest });
            }
          }
        } catch (imgErr) {
          console.warn('[Scanner] Could not copy original images:', imgErr);
        }
      } else {
        // Dọn dẹp an toàn: chỉ xóa các file ảnh tạm do app sinh ra trong cacheDirectory,
        // tuyệt đối không xóa nhầm ảnh gốc được chọn từ thư viện thiết bị
        for (const imgUri of images) {
          try {
            if (imgUri.startsWith('file://')) {
              const isAppCache = FileSystem.cacheDirectory && imgUri.startsWith(FileSystem.cacheDirectory);
              if (isAppCache) {
                await FileSystem.deleteAsync(imgUri, { idempotent: true });
              }
            }
          } catch (delErr) {
            console.warn('[Scanner] Could not clean up temp image:', delErr);
          }
        }
      }

      // Xóa draft session sau khi lưu thành công
      await Storage.removeItem(DRAFT_SCAN_SESSION_KEY);

      Alert.alert('Thành công', 'Đã lưu PDF vào thư mục Tài liệu!');
      navigation.goBack();
    } catch (error: any) {
      console.error(error);
      Alert.alert('Lỗi', `Không thể lưu PDF: ${error.message || String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async () => {
    if (images.length === 0) return;
    setSharing(true);
    try {
      const uri = await createPdf();
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf', dialogTitle: 'Chia sẻ tài liệu' });
    } catch (error: any) {
      console.error(error);
      Alert.alert('Lỗi', `Không thể chia sẻ PDF: ${error.message || String(error)}`);
    } finally {
      setSharing(false);
    }
  };

  if (images.length === 0) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#00bfa5" />
        <Text style={{ color: '#fff', marginTop: 16 }}>Đang khởi động máy quét...</Text>
      </View>
    );
  }

  // Preview Mode
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerText}>Chỉnh sửa ({images.length})</Text>
        <TouchableOpacity style={{ padding: 4 }} onPress={startScan}>
          <Ionicons name="add-circle" size={28} color="#00bfa5" />
        </TouchableOpacity>
      </View>

      <View style={styles.previewContainer}>
        <FlatList 
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => i.toString()}
          renderItem={({ item, index }) => (
            <View style={styles.slide}>
              <View style={styles.imageCardWrapper}>
                <Image source={{ uri: item }} style={styles.previewImage} resizeMode="contain" />

                {/* Page Number Badge */}
                <View style={styles.pageBadge}>
                  <Text style={styles.pageBadgeText}>{index + 1}/{images.length}</Text>
                </View>

                {/* Status Badges */}
                <View style={styles.badgeContainer}>
                  {filterMode === 'magic' && (
                    <View style={styles.magicBadge}>
                      <Ionicons name="sparkles" size={12} color="#fff" />
                      <Text style={styles.magicBadgeText}>Thuật toán Magic</Text>
                    </View>
                  )}
                  {customCorners[index] && (
                    <View style={[styles.magicBadge, { backgroundColor: 'rgba(255,152,0,0.9)' }]}>
                      <Ionicons name="scan-outline" size={12} color="#fff" />
                      <Text style={styles.magicBadgeText}>Đã căn lề</Text>
                    </View>
                  )}
                  {bookMode && (
                    <View style={[styles.magicBadge, { backgroundColor: '#e65100' }]}>
                      <Ionicons name="book-outline" size={12} color="#fff" />
                      <Text style={styles.magicBadgeText}>Nắn gáy sách</Text>
                    </View>
                  )}
                </View>
                
                {/* Reorder Buttons (Bottom Left) */}
                <View style={styles.reorderBar}>
                  <TouchableOpacity
                    style={[styles.smallCardBtn, index === 0 && styles.disabledBtn]}
                    onPress={() => handleMoveImage(index, 'left')}
                    disabled={index === 0}
                  >
                    <Ionicons name="chevron-back" size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallCardBtn, index === images.length - 1 && styles.disabledBtn]}
                    onPress={() => handleMoveImage(index, 'right')}
                    disabled={index === images.length - 1}
                  >
                    <Ionicons name="chevron-forward" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>

                {/* Action Buttons (Bottom Right): Rotate, Crop, Delete */}
                <View style={styles.actionsBar}>
                  <TouchableOpacity style={styles.smallCardBtn} onPress={() => handleRotateImage(index)}>
                    <Ionicons name="refresh" size={18} color="#fff" />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.smallCardBtn} onPress={() => { setActiveIndex(index); setIsCropping(true); }}>
                    <Ionicons name="crop" size={18} color="#fff" />
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.smallCardBtn, { backgroundColor: 'rgba(220,53,69,0.85)' }]} onPress={() => handleDeleteImage(index)}>
                    <Ionicons name="trash" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        />
      </View>

      {isCropping && (
        <CropView 
          imageUri={images[activeIndex]}
          onCancel={() => setIsCropping(false)}
          onCropSave={(corners, displaySize) => {
            const ratios = corners.map(c => ({
              x: c.x / displaySize.w,
              y: c.y / displaySize.h
            }));
            setCustomCorners(prev => ({ ...prev, [activeIndex]: ratios }));
            setIsCropping(false);
          }}
        />
      )}

      <View style={styles.colorModeRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeScroll}>
          <TouchableOpacity
            style={[styles.modeBtn, bookMode && styles.bookModeActiveBtn]}
            onPress={() => setBookMode(!bookMode)}
          >
            <Text style={[styles.modeBtnText, bookMode && styles.bookModeActiveText]}>
              📖 Quét Sách {bookMode ? '(Bật)' : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, watermark.length > 0 && { backgroundColor: '#e91e63', borderColor: '#e91e63' }]}
            onPress={() => {
              setCustomWatermarkInput(watermark);
              setWatermarkModalVisible(true);
            }}
          >
            <Text style={[styles.modeBtnText, watermark.length > 0 && { color: '#fff', fontWeight: 'bold' }]}>
              🔖 {watermark ? `Dấu: ${watermark}` : 'Đóng dấu'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeBtn, filterMode === 'magic' && styles.modeBtnActive]} onPress={() => setFilterMode('magic')}>
            <Text style={[styles.modeBtnText, filterMode === 'magic' && styles.modeBtnTextActive]}>✨ Giấy Thật</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeBtn, filterMode === 'original' && styles.modeBtnActive]} onPress={() => setFilterMode('original')}>
            <Text style={[styles.modeBtnText, filterMode === 'original' && styles.modeBtnTextActive]}>📷 Bản Gốc</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeBtn, filterMode === 'bw' && styles.modeBtnActive]} onPress={() => setFilterMode('bw')}>
            <Text style={[styles.modeBtnText, filterMode === 'bw' && styles.modeBtnTextActive]}>📄 Trắng Đen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeBtn, filterMode === 'grayscale' && styles.modeBtnActive]} onPress={() => setFilterMode('grayscale')}>
            <Text style={[styles.modeBtnText, filterMode === 'grayscale' && styles.modeBtnTextActive]}>🔘 Xám</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Watermark Dialog */}
      <Modal visible={watermarkModalVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.watermarkDialog}>
            <View style={styles.watermarkHeader}>
              <Text style={styles.watermarkTitle}>🔖 Đóng dấu bản quyền PDF</Text>
              <TouchableOpacity onPress={() => setWatermarkModalVisible(false)}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.watermarkDesc}>
              Chọn mẫu dấu bản quyền hoặc nhập chữ tùy chọn in chìm chéo lên các trang tài liệu:
            </Text>

            <View style={styles.watermarkPresets}>
              {[
                { label: 'BẢN SAO', val: 'BẢN SAO' },
                { label: 'TÀI LIỆU MẬT', val: 'TÀI LIỆU MẬT' },
                { label: 'XÁC THỰC CCCD', val: 'CHỈ DÙNG XÁC THỰC' },
                { label: 'DOCSCAN PRO', val: 'DOCSCAN PRO' },
              ].map(preset => (
                <TouchableOpacity
                  key={preset.val}
                  style={[
                    styles.watermarkPresetBtn,
                    watermark === preset.val && styles.watermarkPresetActive,
                  ]}
                  onPress={() => {
                    setWatermark(preset.val);
                    setCustomWatermarkInput(preset.val);
                  }}
                >
                  <Text
                    style={[
                      styles.watermarkPresetText,
                      watermark === preset.val && { color: '#fff', fontWeight: 'bold' },
                    ]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.watermarkInput}
              value={customWatermarkInput}
              onChangeText={setCustomWatermarkInput}
              placeholder="Hoặc nhập chữ đóng dấu tùy ý..."
              placeholderTextColor="#777"
            />

            <View style={styles.watermarkActions}>
              {watermark.length > 0 && (
                <TouchableOpacity
                  style={[styles.watermarkBtn, { backgroundColor: '#333', marginRight: 10 }]}
                  onPress={() => {
                    setWatermark('');
                    setCustomWatermarkInput('');
                    setWatermarkModalVisible(false);
                  }}
                >
                  <Text style={{ color: '#ff5252', fontWeight: 'bold' }}>Tắt dấu</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.watermarkBtn, { backgroundColor: '#00bfa5', flex: 1 }]}
                onPress={() => {
                  setWatermark(customWatermarkInput.trim());
                  setWatermarkModalVisible(false);
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Áp dụng</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.footer}>
        <View style={styles.fileNameContainer}>
          <Ionicons name="document-text" size={20} color="#666" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.fileNameInput}
            value={fileName}
            onChangeText={setFileName}
            placeholder="Tên file PDF"
            placeholderTextColor="#666"
          />
        </View>
        <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#4a90e2', marginRight: 8 }, sharing && { opacity: 0.55 }]} onPress={handleShare} disabled={sharing || saving}>
          {sharing ? <ActivityIndicator color="#fff" /> : (
            <Ionicons name="share-social" size={20} color="#fff" />
          )}
        </TouchableOpacity>

        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.55 }]} onPress={handleSave} disabled={saving || sharing}>
          {saving ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="save" size={20} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.saveBtnText}>Lưu PDF</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    paddingTop: 44, paddingBottom: 14, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#111',
    borderBottomWidth: 1, borderBottomColor: '#222'
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerText: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center', marginRight: 16 },
  
  previewContainer: { flex: 1, backgroundColor: '#0d0d0d' },
  slide: { width, height: '100%', justifyContent: 'center', alignItems: 'center', paddingVertical: 10 },
  imageCardWrapper: {
    width: '90%', 
    aspectRatio: 1 / 1.414, // Tỷ lệ chuẩn giấy A4
    backgroundColor: '#fff',
    borderRadius: 4, 
    overflow: 'hidden', 
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  previewImage: { width: '100%', height: '100%' },
  pageBadge: {
    position: 'absolute', top: 12, left: 12,
    backgroundColor: 'rgba(0,0,0,0.65)', paddingVertical: 4, paddingHorizontal: 8,
    borderRadius: 12, zIndex: 10
  },
  pageBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  badgeContainer: {
    position: 'absolute', top: 12, right: 12,
    alignItems: 'flex-end', gap: 6, zIndex: 10
  },
  magicBadge: {
    backgroundColor: 'rgba(0, 191, 165, 0.9)', paddingVertical: 4, paddingHorizontal: 8,
    borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 4
  },
  magicBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  reorderBar: {
    position: 'absolute', bottom: 12, left: 12,
    flexDirection: 'row', gap: 8, zIndex: 10
  },
  actionsBar: {
    position: 'absolute', bottom: 12, right: 12,
    flexDirection: 'row', gap: 8, zIndex: 10
  },
  smallCardBtn: {
    backgroundColor: 'rgba(0,0,0,0.65)', width: 38, height: 38,
    borderRadius: 19, justifyContent: 'center', alignItems: 'center'
  },
  disabledBtn: { opacity: 0.3 },
  bookModeActiveBtn: { backgroundColor: '#ff9800', borderColor: '#ff9800' },
  bookModeActiveText: { color: '#fff', fontWeight: 'bold' },

  colorModeRow: {
    paddingVertical: 12, backgroundColor: '#1a1a1a',
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a'
  },
  modeScroll: { paddingHorizontal: 12, gap: 10 },
  modeBtn: {
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20,
    backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#333'
  },
  modeBtnActive: { backgroundColor: '#00bfa5', borderColor: '#00bfa5' },
  modeBtnText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: '#fff', fontWeight: 'bold' },

  footer: {
    backgroundColor: '#111', padding: 16, paddingBottom: Platform.OS === 'ios' ? 30 : 16,
    flexDirection: 'row', alignItems: 'center', gap: 12
  },
  fileNameContainer: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#222', borderRadius: 8, paddingHorizontal: 12, height: 44
  },
  fileNameInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 8 },
  saveBtn: {
    backgroundColor: '#00bfa5', flexDirection: 'row', alignItems: 'center',
    height: 44, paddingHorizontal: 16, borderRadius: 8
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  modalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center', alignItems: 'center', padding: 20
  },
  watermarkDialog: {
    width: '94%', backgroundColor: '#1e1e1e', borderRadius: 16,
    padding: 20, borderWidth: 1, borderColor: '#333'
  },
  watermarkHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12
  },
  watermarkTitle: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  watermarkDesc: { color: '#aaa', fontSize: 13, marginBottom: 16, lineHeight: 18 },
  watermarkPresets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  watermarkPresetBtn: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12,
    backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#3a3a3a'
  },
  watermarkPresetActive: { backgroundColor: '#e91e63', borderColor: '#e91e63' },
  watermarkPresetText: { color: '#bbb', fontSize: 12 },
  watermarkInput: {
    height: 44, backgroundColor: '#2a2a2a', borderRadius: 10,
    borderWidth: 1, borderColor: '#3a3a3a', paddingHorizontal: 14,
    color: '#fff', fontSize: 14, marginBottom: 18
  },
  watermarkActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  watermarkBtn: {
    height: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 18
  }
});
