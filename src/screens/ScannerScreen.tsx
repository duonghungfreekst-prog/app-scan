import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, TextInput,
  ScrollView, Alert, KeyboardAvoidingView, Platform, Dimensions, ActivityIndicator,
  FlatList, Modal, BackHandler
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
import { savePdfToDocuments, getDocumentDirectory, cleanupTempCache, compressImageToTargetSize } from '../utils/fileHelper';
import Storage from '../utils/storage';
import { STORAGE_KEYS, IMAGE_PROCESSING_CONFIG } from '../constants/config';
import CropView, { Point } from '../components/CropView';

export type AspectRatioMode = 'a4' | 'id_card' | 'free';

const { width, height } = Dimensions.get('window');

// Hàm kiểm tra an toàn: Chỉ thao tác với file tạm trong thư mục cache của app
export const isTempCacheUri = (uri: string): boolean => {
  if (!uri || typeof uri !== 'string' || !uri.startsWith('file://')) return false;
  const cacheDir = FileSystem.cacheDirectory;
  return Boolean(cacheDir && uri.startsWith(cacheDir));
};

// Dọn dẹp danh sách file ảnh tạm an toàn để chống rò rỉ dung lượng bộ nhớ
export const cleanupTempImages = async (uris: string[]): Promise<void> => {
  if (!uris || !Array.isArray(uris)) return;
  for (const uri of uris) {
    try {
      if (isTempCacheUri(uri)) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    } catch (err) {
      console.warn('[Scanner] Failed to clean up temp image:', uri, err);
    }
  }
};

// Xóa sạch draft session ở cả key mới và key kế thừa
export const removeDraftSession = async (): Promise<void> => {
  try {
    await Promise.all([
      Storage.removeItem(STORAGE_KEYS.DRAFT_SCAN_SESSION),
      Storage.removeItem('DRAFT_SCAN_SESSION'),
    ]);
  } catch (e) {
    console.warn('[Scanner] Failed to remove draft session:', e);
  }
};

export default function ScannerScreen({ route, navigation }: any) {
  const [images, setImages] = useState<string[]>([]);
  const genDefaultFileName = () => {
    return `SCAN_${Date.now()}`;
  };

  const hasSavedRef = React.useRef(false);

  // Điều hướng an toàn chống kẹt màn hình đen
  const safeGoBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('MainTabs');
    }
  };

  const [aspectRatioMode, setAspectRatioMode] = useState<AspectRatioMode>('a4');
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStatusText, setExportStatusText] = useState<string>('');

  const [filterMode, setFilterMode] = useState<FilterMode>('magic');
  const [scanQuality, setScanQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [saveOriginal, setSaveOriginal] = useState(true);
  const [trimMargin, setTrimMargin] = useState(true); // Default to true to remove excess borders
  const [bookMode, setBookMode] = useState<boolean>(Boolean(route.params?.bookMode));
  const [watermark, setWatermark] = useState<string>('');
  const [watermarkModalVisible, setWatermarkModalVisible] = useState<boolean>(false);
  const [customWatermarkInput, setCustomWatermarkInput] = useState<string>('');
  const [fileName, setFileName] = useState(genDefaultFileName());
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);

  // TÍNH NĂNG MỚI: Xoay trang ảo (90/180/270), đóng dấu ngày giờ/số trang góc PDF,
  // và nén theo dung lượng mục tiêu (targetSizeKB: 200/500/1000KB)
  const [rotations, setRotations] = useState<{ [index: number]: number }>({});
  const [addWatermark, setAddWatermark] = useState<boolean>(false);
  const [targetSizeMode, setTargetSizeMode] = useState<boolean>(false);
  const [targetSizeKB, setTargetSizeKB] = useState<number>(500);

  // Đồng bộ tham số bookMode từ route.params
  useEffect(() => {
    if (typeof route.params?.bookMode === 'boolean') {
      setBookMode(route.params.bookMode);
    }
  }, [route.params?.bookMode]);

  // Cảnh báo xác nhận khi vuốt back hoặc điều hướng thoát màn hình mà đang có ảnh quét chưa lưu
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (images.length === 0 || hasSavedRef.current) {
        return;
      }

      e.preventDefault();

      Alert.alert(
        'Thoát phiên quét?',
        'Bạn có hình ảnh quét chưa lưu. Bạn có chắc muốn thoát mà không lưu?',
        [
          { text: 'Ở lại', style: 'cancel', onPress: () => {} },
          {
            text: 'Thoát',
            style: 'destructive',
            onPress: async () => {
              hasSavedRef.current = true;
              // Dọn dẹp sạch sẽ ảnh tạm và draft session khi người dùng chủ động hủy phiên quét
              await cleanupTempImages(images);
              await removeDraftSession();
              navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });

    return () => {
      unsubscribe();
    };
  }, [navigation, images]);

  // Crop State
  const [isCropping, setIsCropping] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [customCorners, setCustomCorners] = useState<{ [index: number]: Point[] }>({});
  const [sessionChecked, setSessionChecked] = useState(false);

  // Xử lý nút Back vật lý trên Android và dọn dẹp sạch sẽ khi component unmount
  useEffect(() => {
    const onBackPress = () => {
      if (isCropping) {
        setIsCropping(false);
        return true;
      }
      if (watermarkModalVisible) {
        setWatermarkModalVisible(false);
        return true;
      }
      if (images.length > 0 && !hasSavedRef.current) {
        safeGoBack();
        return true;
      }
      return false;
    };

    const backSubscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => {
      backSubscription.remove();
    };
  }, [isCropping, watermarkModalVisible, images.length]);

  // Tự động lưu draft session mỗi khi images/settings thay đổi (có debounce để tránh nghẽn I/O và rò rỉ bộ nhớ)
  useEffect(() => {
    if (!sessionChecked || hasSavedRef.current) return;

    const timer = setTimeout(async () => {
      if (hasSavedRef.current) return;
      try {
        if (images.length > 0) {
          await Storage.setItem(
            STORAGE_KEYS.DRAFT_SCAN_SESSION,
            JSON.stringify({
              images,
              fileName,
              filterMode,
              bookMode,
              aspectRatioMode,
              customCorners,
              timestamp: Date.now(),
            })
          );
        } else {
          await removeDraftSession();
        }
      } catch (e) {
        console.warn('[Scanner] Failed to save draft session:', e);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
    };
  }, [images, fileName, filterMode, bookMode, aspectRatioMode, customCorners, sessionChecked]);

  useEffect(() => {
    let isMounted = true;
    // Tải cấu hình từ Cài đặt
    const initSettings = async () => {
      try {
        const q = await Storage.getItem(STORAGE_KEYS.SCAN_QUALITY);
        const c = await Storage.getItem(STORAGE_KEYS.COLOR_MODE);
        const s = await Storage.getItem(STORAGE_KEYS.SAVE_ORIGINAL);
        if (!isMounted) return;
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
    return () => {
      isMounted = false;
    };
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
        if (images.length === 0) safeGoBack();
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: scanQuality === 'high' ? 1 : scanQuality === 'medium' ? 0.85 : 0.7,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImages(prev => [...prev, result.assets[0].uri]);
      } else if (images.length === 0) {
        safeGoBack();
      }
    } catch (err) {
      console.warn('[Scanner] Camera fallback error:', err);
      if (images.length === 0) safeGoBack();
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
            { text: 'Hủy', style: 'cancel', onPress: () => { if (images.length === 0) safeGoBack(); } },
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
        safeGoBack();
      }
    } catch (e: any) {
      console.error('[Scanner] DocumentScanner error:', e);
      Alert.alert(
        'Lỗi máy quét',
        'Không thể khởi động máy quét tự động. Bạn có muốn dùng máy ảnh thông thường?',
        [
          { text: 'Hủy', style: 'cancel', onPress: () => { if (images.length === 0) safeGoBack(); } },
          { text: 'Chụp camera', onPress: takePhotoFallback },
          { text: 'Chọn ảnh', onPress: pickImage },
        ]
      );
    }
  };

  useEffect(() => {
    let isMounted = true;

    // 1. Nếu có ảnh truyền sang từ route.params (ví dụ từ FilesScreen hoặc ToolsScreen)
    if (route.params?.importImages && Array.isArray(route.params.importImages) && route.params.importImages.length > 0) {
      setImages(route.params.importImages);
      setSessionChecked(true);
      return () => {
        isMounted = false;
      };
    }

    // 2. Kiểm tra draft session trước khi bắt đầu quét mới
    const checkDraftAndInit = async () => {
      try {
        const rawDraft =
          (await Storage.getItem(STORAGE_KEYS.DRAFT_SCAN_SESSION)) ||
          (await Storage.getItem('DRAFT_SCAN_SESSION'));

        if (rawDraft) {
          const draft = JSON.parse(rawDraft);
          const isRecent = Date.now() - (draft.timestamp || 0) < 24 * 60 * 60 * 1000;

          if (isRecent && Array.isArray(draft.images) && draft.images.length > 0) {
            // Xác thực xem các file ảnh trong draft có thực sự tồn tại trên đĩa hay không
            const validImages: string[] = [];
            for (const uri of draft.images) {
              if (typeof uri !== 'string') continue;
              if (uri.startsWith('file://')) {
                try {
                  const info = await FileSystem.getInfoAsync(uri);
                  if (info.exists) {
                    validImages.push(uri);
                  }
                } catch {
                  // Bỏ qua file không truy cập được
                }
              } else {
                validImages.push(uri);
              }
            }

            // Nếu không còn file nào khả dụng (bị OS dọn cache), dọn dẹp draft hỏng ngay lập tức
            if (validImages.length === 0) {
              await removeDraftSession();
              if (isMounted) {
                setSessionChecked(true);
                startScan();
              }
              return;
            }

            if (!isMounted) return;

            Alert.alert(
              '📄 Khôi phục phiên quét',
              `Tìm thấy phiên quét dở dang gồm ${validImages.length} trang chưa lưu. Bạn có muốn tiếp tục không?`,
              [
                {
                  text: 'Bỏ qua',
                  style: 'destructive',
                  onPress: async () => {
                    // Xóa triệt để các file ảnh tạm của draft cũ để không làm rò rỉ dung lượng
                    await cleanupTempImages(draft.images);
                    await removeDraftSession();
                    if (isMounted) {
                      setSessionChecked(true);
                      startScan();
                    }
                  },
                },
                {
                  text: 'Khôi phục',
                  onPress: () => {
                    if (!isMounted) return;
                    setImages(validImages);
                    if (draft.fileName) setFileName(draft.fileName);
                    if (draft.filterMode) setFilterMode(draft.filterMode);
                    if (draft.aspectRatioMode) setAspectRatioMode(draft.aspectRatioMode);
                    if (draft.customCorners) setCustomCorners(draft.customCorners);
                    if (typeof draft.bookMode === 'boolean' && route.params?.bookMode === undefined) {
                      setBookMode(draft.bookMode);
                    }
                    setSessionChecked(true);
                  },
                },
              ]
            );
            return;
          } else {
            // Draft đã hết hạn (> 24h) hoặc rỗng: dọn dẹp sạch cả file tạm và storage
            if (Array.isArray(draft.images)) {
              await cleanupTempImages(draft.images);
            }
            await removeDraftSession();
          }
        }
      } catch (e) {
        console.warn('[Scanner] Error checking draft:', e);
      }
      if (isMounted) {
        setSessionChecked(true);
        startScan();
      }
    };

    checkDraftAndInit();

    return () => {
      isMounted = false;
    };
  }, [route.params?.importImages]);

  const handleDeleteImage = async (index: number) => {
    const targetUri = images[index];
    const remaining = images.filter((_, i) => i !== index);
    setImages(remaining);

    // Giải phóng ngay file tạm của ảnh bị xóa khỏi cache
    if (targetUri && isTempCacheUri(targetUri)) {
      FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(err =>
        console.warn('[Scanner] Error deleting removed image file:', err)
      );
    }

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

    setRotations(prev => {
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
      hasSavedRef.current = true;
      await removeDraftSession();
      safeGoBack();
    }
  };

  // TÍNH NĂNG MỚI: Xoay trang ảo 90 độ mỗi lần bấm. Góc xoay được lưu trong state
  // và áp dụng thật khi xuất PDF (createPdf), giúp giao diện phản hồi tức thì
  // mà không phải chờ I/O đĩa ghi file ảnh nhiều lần.
  const handleRotateImage = (index: number) => {
    setRotations(prev => ({ ...prev, [index]: ((prev[index] || 0) + 90) % 360 }));
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

    setRotations(prev => {
      const next = { ...prev };
      const rCurrent = next[index];
      const rTarget = next[targetIdx];
      if (rCurrent !== undefined) next[targetIdx] = rCurrent; else delete next[targetIdx];
      if (rTarget !== undefined) next[index] = rTarget; else delete next[index];
      return next;
    });
  };

  const createPdf = async (onProgress?: (percent: number, statusText: string) => void) => {
    onProgress?.(5, 'Đang chuẩn bị trang quét...');
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

    // Xác định kích thước trang PDF theo tỷ lệ khung hình đã chọn
    const isIdCard = aspectRatioMode === 'id_card';
    const pageWidth = isIdCard ? '1712px' : '2480px';
    const pageHeight = isIdCard ? '1080px' : '3508px';
    const printWidth = isIdCard ? 242.65 : 595.28;
    const printHeight = isIdCard ? 153.01 : 841.89;

    // Xử lý nén ảnh theo batch nhỏ và dùng trực tiếp file URI (không nhồi Base64 vào JS RAM)
    const imgTagsArray: string[] = [];
    const generatedTempUris: string[] = [];
    const BATCH_SIZE = 2;
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);
      const processedBatch = await Promise.all(
        batch.map(async (imgUri, batchIdx) => {
          const actualIndex = i + batchIdx;
          let fileUri = imgUri;
          if (!imgUri.startsWith('data:')) {
            try {
              // TÍNH NĂNG MỚI: áp dụng góc xoay thật (rotations) trước khi resize
              const rotateDeg = rotations[actualIndex] || 0;
              let rotatedUri = imgUri;
              if (rotateDeg !== 0) {
                const rotResult = await ImageManipulator.manipulateAsync(
                  imgUri,
                  [{ rotate: rotateDeg }],
                  { compress: 1, format: ImageManipulator.SaveFormat.JPEG, base64: false }
                );
                rotatedUri = rotResult.uri;
                generatedTempUris.push(rotResult.uri);
              }

              if (targetSizeMode) {
                fileUri = await compressImageToTargetSize(rotatedUri, targetSizeKB, targetWidth);
                if (fileUri !== rotatedUri && fileUri !== imgUri) {
                  generatedTempUris.push(fileUri);
                }
              } else {
                const manipResult = await ImageManipulator.manipulateAsync(
                  rotatedUri,
                  [{ resize: { width: targetWidth } }],
                  { compress: targetCompress, format: ImageManipulator.SaveFormat.JPEG, base64: false }
                );
                fileUri = manipResult.uri;
                generatedTempUris.push(manipResult.uri);
              }
            } catch (e) {
              console.warn('[Scanner] Image process error:', e);
              fileUri = imgUri;
            }
          }
          const watermarkHtml = addWatermark
            ? `<div class="wm">${new Date().toLocaleString('vi-VN')} · Trang ${actualIndex + 1}/${images.length}</div>`
            : '';
          return `<div class="page">
            <img id="scanImg_${actualIndex}" src="${fileUri}" style="${filterMode !== 'magic' ? `filter: ${cssFilter};` : ''}" crossorigin="anonymous" />
            ${watermark ? `<div class="watermark">${watermark}</div>` : ''}
            ${watermarkHtml}
          </div>`;
        })
      );
      imgTagsArray.push(...processedBatch);

      const processedCount = Math.min(i + BATCH_SIZE, images.length);
      const percent = Math.round(5 + (processedCount / images.length) * 75);
      onProgress?.(percent, `Đang xử lý trang ${processedCount}/${images.length} (${percent}%)...`);
    }
    const imgTags = imgTagsArray.join('');

    onProgress?.(85, 'Đang kết xuất tệp PDF (85%)...');

    const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            @page { size: ${pageWidth} ${pageHeight}; margin: 0; }
            html, body { width: 100%; background: white; }
            .page {
              width: ${pageWidth};
              height: ${pageHeight};
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
              font-size: ${isIdCard ? '45px' : '85px'};
              font-family: Arial, Helvetica, sans-serif;
              color: rgba(220, 53, 69, 0.28);
              font-weight: 900;
              text-align: center;
              pointer-events: none;
              text-transform: uppercase;
              letter-spacing: ${isIdCard ? '6px' : '12px'};
              z-index: 99;
            }
            .wm {
              position: absolute;
              right: 40px;
              bottom: 30px;
              font-family: sans-serif;
              font-size: 26px;
              color: rgba(0,0,0,0.55);
              background: rgba(255,255,255,0.75);
              padding: 8px 18px;
              border-radius: 6px;
              z-index: 5;
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
      width: printWidth,
      height: printHeight, 
      base64: false
    });

    // Dọn dẹp ngay các file ảnh resize tạm sinh ra cho HTML Print để giải phóng dung lượng bộ nhớ
    if (generatedTempUris.length > 0) {
      for (const tempUri of generatedTempUris) {
        FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
      }
    }

    onProgress?.(100, 'Hoàn tất tạo tệp PDF! (100%)');
    return uri;
  };

  const handleSave = async () => {
    if (!fileName.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên file!');
      return;
    }
    if (images.length === 0) return;
    
    setSaving(true);
    setExportProgress(0);
    setExportStatusText('Bắt đầu xử lý...');
    try {
      const uri = await createPdf((percent, statusText) => {
        setExportProgress(percent);
        setExportStatusText(statusText);
      });
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
              // Xóa file cache tạm sau khi đã sao chép sang Documents
              if (isTempCacheUri(src)) {
                await FileSystem.deleteAsync(src, { idempotent: true }).catch(() => {});
              }
            }
          }
        } catch (imgErr) {
          console.warn('[Scanner] Could not copy original images:', imgErr);
        }
      } else {
        // Dọn dẹp an toàn: chỉ xóa các file ảnh tạm do app sinh ra trong cacheDirectory
        await cleanupTempImages(images);
      }

      // Dọn sạch toàn bộ ảnh tạm do ImageManipulator tạo ra sau khi xuất PDF thành công
      try {
        await cleanupTempCache();
      } catch (cacheErr) {
        console.warn('[Scanner] cleanupTempCache error:', cacheErr);
      }

      // Xóa draft session sau khi lưu thành công
      await removeDraftSession();

      hasSavedRef.current = true;
      Alert.alert('Thành công', 'Đã lưu PDF vào thư mục Tài liệu!');
      safeGoBack();
    } catch (error: any) {
      console.error(error);
      Alert.alert('Lỗi', `Không thể lưu PDF: ${error.message || String(error)}`);
    } finally {
      setSaving(false);
      setExportProgress(0);
      setExportStatusText('');
    }
  };

  const handleShare = async () => {
    if (images.length === 0) return;
    setSharing(true);
    setExportProgress(0);
    setExportStatusText('Bắt đầu xử lý...');
    let tempPdfUri: string | null = null;
    try {
      tempPdfUri = await createPdf((percent, statusText) => {
        setExportProgress(percent);
        setExportStatusText(statusText);
      });
      await Sharing.shareAsync(tempPdfUri, { UTI: '.pdf', mimeType: 'application/pdf', dialogTitle: 'Chia sẻ tài liệu' });

      // Dọn sạch toàn bộ ảnh tạm do ImageManipulator tạo ra sau khi xuất PDF thành công
      try {
        await cleanupTempCache();
      } catch (cacheErr) {
        console.warn('[Scanner] cleanupTempCache error:', cacheErr);
      }
    } catch (error: any) {
      console.error(error);
      Alert.alert('Lỗi', `Không thể chia sẻ PDF: ${error.message || String(error)}`);
    } finally {
      if (tempPdfUri && isTempCacheUri(tempPdfUri)) {
        FileSystem.deleteAsync(tempPdfUri, { idempotent: true }).catch(() => {});
      }
      setSharing(false);
      setExportProgress(0);
      setExportStatusText('');
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

  const getCardAspectStyle = () => {
    if (aspectRatioMode === 'a4') {
      return { aspectRatio: 1 / 1.414, height: undefined };
    }
    if (aspectRatioMode === 'id_card') {
      return { aspectRatio: 85.6 / 54, height: undefined };
    }
    return { aspectRatio: undefined, height: '82%' as const };
  };

  // Preview Mode
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={safeGoBack}>
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
              <View style={[styles.imageCardWrapper, getCardAspectStyle()]}>
                <Image
                  source={{ uri: item }}
                  style={[styles.previewImage, { transform: [{ rotate: `${rotations[index] || 0}deg` }] }]}
                  resizeMode="contain"
                />

                {/* Page Number Badge */}
                <View style={styles.pageBadge}>
                  <Text style={styles.pageBadgeText}>{index + 1}/{images.length}</Text>
                </View>

                {/* Status Badges */}
                <View style={styles.badgeContainer}>
                  {/* Aspect Ratio Badge */}
                  <View style={[styles.magicBadge, { backgroundColor: '#1976d2' }]}>
                    <Ionicons
                      name={aspectRatioMode === 'a4' ? 'document-text-outline' : aspectRatioMode === 'id_card' ? 'card-outline' : 'expand-outline'}
                      size={12}
                      color="#fff"
                    />
                    <Text style={styles.magicBadgeText}>
                      {aspectRatioMode === 'a4' ? 'Khổ A4' : aspectRatioMode === 'id_card' ? 'Thẻ ID' : 'Tự do'}
                    </Text>
                  </View>
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

      {/* Aspect Ratio Selector Row */}
      <View style={styles.aspectRatioRow}>
        <View style={styles.aspectRatioTitleBox}>
          <Ionicons name="crop" size={15} color="#00bfa5" />
          <Text style={styles.aspectRatioTitle}>Khung hình:</Text>
        </View>
        <View style={styles.aspectRatioButtons}>
          <TouchableOpacity
            style={[styles.aspectRatioBtn, aspectRatioMode === 'a4' && styles.aspectRatioBtnActive]}
            onPress={() => setAspectRatioMode('a4')}
          >
            <Ionicons
              name="document-text-outline"
              size={14}
              color={aspectRatioMode === 'a4' ? '#fff' : '#aaa'}
            />
            <Text style={[styles.aspectRatioBtnText, aspectRatioMode === 'a4' && styles.aspectRatioBtnTextActive]}>
              A4
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.aspectRatioBtn, aspectRatioMode === 'id_card' && styles.aspectRatioBtnActive]}
            onPress={() => setAspectRatioMode('id_card')}
          >
            <Ionicons
              name="card-outline"
              size={14}
              color={aspectRatioMode === 'id_card' ? '#fff' : '#aaa'}
            />
            <Text style={[styles.aspectRatioBtnText, aspectRatioMode === 'id_card' && styles.aspectRatioBtnTextActive]}>
              Thẻ ID
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.aspectRatioBtn, aspectRatioMode === 'free' && styles.aspectRatioBtnActive]}
            onPress={() => setAspectRatioMode('free')}
          >
            <Ionicons
              name="expand-outline"
              size={14}
              color={aspectRatioMode === 'free' ? '#fff' : '#aaa'}
            />
            <Text style={[styles.aspectRatioBtnText, aspectRatioMode === 'free' && styles.aspectRatioBtnTextActive]}>
              Tự do
            </Text>
          </TouchableOpacity>
        </View>
      </View>

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

      {/* TÍNH NĂNG MỚI: Đóng dấu ngày giờ + số trang lên PDF xuất ra */}
      <TouchableOpacity
        style={styles.watermarkRow}
        onPress={() => setAddWatermark(v => !v)}
        activeOpacity={0.7}
      >
        <Ionicons name={addWatermark ? 'checkbox' : 'square-outline'} size={18} color={addWatermark ? '#00bfa5' : '#888'} />
        <Text style={styles.watermarkRowText}>Đóng dấu ngày giờ &amp; số trang lên PDF</Text>
      </TouchableOpacity>

      {/* TÍNH NĂNG MỚI: Nén theo dung lượng mục tiêu — tiện khi gửi email/Zalo có giới hạn */}
      <TouchableOpacity
        style={styles.watermarkRow}
        onPress={() => setTargetSizeMode(v => !v)}
        activeOpacity={0.7}
      >
        <Ionicons name={targetSizeMode ? 'checkbox' : 'square-outline'} size={18} color={targetSizeMode ? '#00bfa5' : '#888'} />
        <Text style={styles.watermarkRowText}>Nén mỗi trang xuống ~{targetSizeKB}KB (cho gửi email/Zalo)</Text>
      </TouchableOpacity>
      {targetSizeMode && (
        <View style={styles.targetSizeRow}>
          {[200, 500, 1000].map(kb => (
            <TouchableOpacity
              key={kb}
              style={[styles.targetSizeBtn, targetSizeKB === kb && styles.targetSizeBtnActive]}
              onPress={() => setTargetSizeKB(kb)}
            >
              <Text style={[styles.targetSizeBtnText, targetSizeKB === kb && styles.targetSizeBtnTextActive]}>{kb}KB</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

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

      {/* Export Progress Modal */}
      <Modal visible={saving || sharing} transparent animationType="fade">
        <View style={styles.progressModalBg}>
          <View style={styles.progressDialog}>
            <View style={styles.progressIconBox}>
              <Ionicons name="document-text" size={36} color="#00bfa5" />
            </View>
            <Text style={styles.progressTitle}>
              {saving ? 'Đang xuất tệp PDF...' : 'Đang chuẩn bị chia sẻ PDF...'}
            </Text>
            <Text style={styles.progressPercentText}>{exportProgress}%</Text>
            
            {/* Progress Bar Track & Fill */}
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.max(0, Math.min(100, exportProgress))}%` }]} />
            </View>

            <Text style={styles.progressStatusText} numberOfLines={2}>
              {exportStatusText || 'Đang xử lý tài liệu...'}
            </Text>
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
  },

  // Aspect Ratio Selector Styles
  aspectRatioRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#161616',
    borderBottomWidth: 1, borderBottomColor: '#252525'
  },
  aspectRatioTitleBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aspectRatioTitle: { color: '#bbb', fontSize: 13, fontWeight: '600' },
  aspectRatioButtons: { flexDirection: 'row', gap: 8 },
  aspectRatioBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14,
    backgroundColor: '#252525', borderWidth: 1, borderColor: '#333'
  },
  aspectRatioBtnActive: { backgroundColor: '#00bfa5', borderColor: '#00bfa5' },
  aspectRatioBtnText: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  aspectRatioBtnTextActive: { color: '#fff', fontWeight: 'bold' },

  // Progress Bar Modal Styles
  progressModalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', alignItems: 'center', padding: 24
  },
  progressDialog: {
    width: '100%', maxWidth: 340, backgroundColor: '#1e1e1e',
    borderRadius: 16, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: '#333'
  },
  progressIconBox: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(0, 191, 165, 0.15)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12
  },
  progressTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 6, textAlign: 'center' },
  progressPercentText: { color: '#00bfa5', fontSize: 28, fontWeight: 'bold', marginBottom: 12 },
  progressBarTrack: {
    width: '100%', height: 8, backgroundColor: '#333',
    borderRadius: 4, overflow: 'hidden', marginBottom: 12
  },
  progressBarFill: { height: '100%', backgroundColor: '#00bfa5', borderRadius: 4 },
  progressStatusText: { color: '#aaa', fontSize: 13, textAlign: 'center', lineHeight: 18 },

  watermarkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1a1a1a', paddingVertical: 10, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a'
  },
  watermarkRowText: { color: '#ccc', fontSize: 13 },
  targetSizeRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#1a1a1a', borderBottomWidth: 1, borderBottomColor: '#2a2a2a'
  },
  targetSizeBtn: {
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 14,
    backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#333'
  },
  targetSizeBtnActive: { backgroundColor: '#00bfa5', borderColor: '#00bfa5' },
  targetSizeBtnText: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  targetSizeBtnTextActive: { color: '#fff', fontWeight: 'bold' }
});
