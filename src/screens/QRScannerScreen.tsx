import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, Linking } from 'react-native';
import { CameraView, useCameraPermissions, Camera } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';

export default function QRScannerScreen({ navigation }: any) {
  const { theme } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [result, setResult] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  if (!permission) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.text }}>Đang kiểm tra quyền camera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.bg }]}>
        <Text style={{ textAlign: 'center', color: theme.text, marginBottom: 16 }}>
          Chúng tôi cần quyền truy cập camera để quét mã QR và Barcode
        </Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: theme.accent }]} onPress={requestPermission}>
          <Text style={styles.btnText}>Cấp quyền</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => navigation.goBack()}>
          <Text style={{ color: theme.textSub }}>Quay lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleBarCodeScanned = ({ type, data }: { type: string, data: string }) => {
    setScanned(true);
    setResult(data);
    setModalVisible(true);
  };

  const handlePickImage = async () => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (!pickerResult.canceled && pickerResult.assets && pickerResult.assets.length > 0) {
        const imageUri = pickerResult.assets[0].uri;
        
        // Dùng Camera.scanFromURLAsync để lấy dữ liệu QR từ ảnh
        const scannedResults = await Camera.scanFromURLAsync(imageUri, ['qr', 'ean13', 'ean8', 'pdf417', 'aztec', 'datamatrix', 'code39', 'code93', 'code128', 'upc_a', 'upc_e']);
        
        if (scannedResults && scannedResults.length > 0) {
          setScanned(true);
          setResult(scannedResults[0].data);
          setModalVisible(true);
        } else {
          Alert.alert('Không tìm thấy', 'Không tìm thấy mã QR hoặc Barcode nào trong ảnh này.');
        }
      }
    } catch (error) {
      console.log('Lỗi khi quét ảnh:', error);
      Alert.alert('Lỗi', 'Không thể phân tích ảnh này.');
    }
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(result);
    Alert.alert('✅ Thành công', 'Đã sao chép nội dung vào khay nhớ tạm.');
    setModalVisible(false);
    // Cho phép quét lại sau 1 khoảng trễ ngắn
    setTimeout(() => setScanned(false), 500);
  };

  const handleOpenLink = async () => {
    try {
      // Kiểm tra scheme an toàn trước khi mở
      if (!isSafeUrl(result)) {
        Alert.alert('Bị chặn', 'Liên kết này chứa scheme không an toàn và đã bị chặn.');
        return;
      }
      // Cảnh báo người dùng trước khi mở URL bên ngoài
      Alert.alert(
        '⚠️ Mở đường dẫn bên ngoài?',
        `Bạn sắp mở:\n${result.length > 80 ? result.slice(0, 80) + '...' : result}\n\nHãy chắc chắn đây là trang web tin cậy.`,
        [
          { text: 'Hủy', style: 'cancel' },
          {
            text: 'Mở', style: 'default',
            onPress: async () => {
              try {
                const canOpen = await Linking.canOpenURL(result);
                if (canOpen) {
                  await Linking.openURL(result);
                } else {
                  Alert.alert('Lỗi', 'Không thể mở liên kết này.');
                }
              } catch {
                Alert.alert('Lỗi', 'Đường dẫn không hợp lệ.');
              }
            }
          }
        ]
      );
    } catch {
      Alert.alert('Lỗi', 'Đường dẫn không hợp lệ.');
    }
  };

  const handleScanAgain = () => {
    setModalVisible(false);
    setScanned(false);
  };

  // Danh sách scheme nguy hiểm bị chặn tuyệt đối
  const BLOCKED_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file://', 'about:'];

  const isSafeUrl = (str: string): boolean => {
    const lower = str.toLowerCase().trim();
    // Chặn mọi scheme nguy hiểm
    if (BLOCKED_SCHEMES.some(s => lower.startsWith(s))) return false;
    // Chỉ cho phép http và https
    return lower.startsWith('http://') || lower.startsWith('https://');
  };

  const isUrl = (str: string) => isSafeUrl(str);

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'ean8', 'pdf417', 'aztec', 'datamatrix', 'code39', 'code93', 'code128', 'upc_a', 'upc_e'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      >
        <View style={styles.overlay}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerText}>Quét mã QR / Barcode</Text>
            <TouchableOpacity onPress={handlePickImage} style={styles.backBtn}>
              <Ionicons name="image-outline" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.scanArea}>
            <View style={styles.scanFrame} />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Hướng camera vào mã để quét tự động</Text>
            <TouchableOpacity
              style={styles.genQrBtn}
              onPress={() => navigation.navigate('QRGenerator')}
            >
              <Ionicons name="create-outline" size={18} color="#fff" />
              <Text style={styles.genQrBtnText}> Tạo mã QR từ văn bản</Text>
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>

      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>📌 Kết quả quét</Text>
            
            <View style={[styles.resultBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.resultText, { color: theme.text }]} selectable>{result}</Text>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.accent }]} onPress={handleCopy}>
                <Ionicons name="copy-outline" size={20} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.btnText}>Sao chép</Text>
              </TouchableOpacity>
              
              {isUrl(result) && (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.blue, marginLeft: 10 }]} onPress={handleOpenLink}>
                  <Ionicons name="globe-outline" size={20} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.btnText}>Mở Link</Text>
                </TouchableOpacity>
              )}
            </View>
            
            <TouchableOpacity style={{ marginTop: 20 }} onPress={handleScanAgain}>
              <Text style={{ color: theme.textSub, textAlign: 'center', fontSize: 16 }}>Quét tiếp</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  camera: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  btn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'space-between'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  backBtn: { padding: 4 },
  headerText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  scanArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#00bfa5',
    backgroundColor: 'transparent',
    borderRadius: 16
  },
  footer: {
    paddingBottom: 40,
    alignItems: 'center'
  },
  footerText: { color: '#fff', fontSize: 14, opacity: 0.8 },
  genQrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 12,
  },
  genQrBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', borderRadius: 20, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' },
  resultBox: { padding: 16, borderWidth: 1, borderRadius: 12, marginBottom: 20, minHeight: 80, justifyContent: 'center' },
  resultText: { fontSize: 16 },
  actionRow: { flexDirection: 'row', justifyContent: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, flex: 1, justifyContent: 'center' }
});
