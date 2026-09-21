import React, { Component, ErrorInfo, ReactNode, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  useColorScheme,
  Appearance,
  DevSettings,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { LightTheme, DarkTheme } from '../theme';
import Storage from '../utils/storage';
import { STORAGE_KEYS } from '../constants/config';

interface ErrorFallbackProps {
  errorId: string;
  onRestart: () => void;
}

const ErrorFallbackView: React.FC<ErrorFallbackProps> = ({ errorId, onRestart }) => {
  const systemScheme = useColorScheme();
  const [isDark, setIsDark] = useState<boolean>(() => {
    return (Appearance.getColorScheme?.() ?? systemScheme) === 'dark';
  });
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const checkThemePreference = async () => {
      try {
        const storedTheme = await Storage.getItem(STORAGE_KEYS.THEME_MODE);
        if (!isMounted) return;
        if (storedTheme !== null) {
          setIsDark(storedTheme === 'true' || storedTheme === 'dark');
          return;
        }
        const legacyTheme = await Storage.getItem('@camscanner_dark_mode');
        if (!isMounted) return;
        if (legacyTheme !== null) {
          setIsDark(legacyTheme === 'true' || legacyTheme === 'dark');
          return;
        }
        setIsDark(systemScheme === 'dark');
      } catch {
        if (isMounted) {
          setIsDark(systemScheme === 'dark');
        }
      }
    };
    checkThemePreference();
    return () => {
      isMounted = false;
    };
  }, [systemScheme]);

  const theme = isDark ? DarkTheme : LightTheme;

  const handleCopyErrorCode = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(errorId);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch (e) {
      console.error('[ErrorBoundary] Failed to copy error code:', e);
    }
  }, [errorId]);

  const handleRestartApp = useCallback(() => {
    onRestart();
    try {
      if (typeof __DEV__ !== 'undefined' && __DEV__ && DevSettings?.reload) {
        DevSettings.reload();
      }
    } catch {
      // Bỏ qua lỗi DevSettings nếu không khả dụng trong môi trường thực thi
    }
  }, [onRestart]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentWrap}>
          {/* Icon cảnh báo */}
          <View style={[styles.iconWrap, { backgroundColor: isDark ? 'rgba(239, 108, 0, 0.2)' : '#ef6c0015' }]}>
            <Ionicons name="warning-outline" size={56} color={theme.warn} />
          </View>

          {/* Tiêu đề & mô tả chung */}
          <Text style={[styles.title, { color: theme.text }]}>Ứng dụng gặp sự cố</Text>
          <Text style={[styles.subtitle, { color: theme.textSub }]}>
            Đã xảy ra sự cố không mong muốn trong quá trình vận hành. Bạn vui lòng thử lại hoặc khởi động lại ứng dụng.
          </Text>

          {/* Khối hiển thị mã lỗi chung (không lộ stack trace) */}
          <View style={[styles.errorCodeCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="shield-checkmark-outline" size={16} color={theme.accent} style={{ marginRight: 6 }} />
            <Text style={[styles.errorCodeLabel, { color: theme.textSub }]}>Mã sự cố:</Text>
            <Text style={[styles.errorCodeValue, { color: theme.accent }]}>{errorId}</Text>
          </View>

          {/* Khối gợi ý khắc phục */}
          <View style={[styles.tipCard, { backgroundColor: isDark ? theme.surface : '#ffffff', borderColor: theme.border }]}>
            <View style={styles.tipHeader}>
              <Ionicons name="bulb-outline" size={18} color={theme.accent} style={{ marginRight: 6 }} />
              <Text style={[styles.tipTitle, { color: theme.text }]}>Gợi ý khắc phục:</Text>
            </View>
            <Text style={[styles.tipItem, { color: theme.textSub }]}>
              • Nhấn &quot;Khởi động lại ứng dụng&quot; để đưa hệ thống về trạng thái ổn định.
            </Text>
            <Text style={[styles.tipItem, { color: theme.textSub }]}>
              • Sao chép mã lỗi và gửi cho bộ phận hỗ trợ kỹ thuật nếu sự cố lặp lại.
            </Text>
            <Text style={[styles.tipItem, { color: theme.textSub }]}>
              • Kiểm tra kết nối mạng hoặc thử lại thao tác trước đó.
            </Text>
          </View>

          {/* Nút thao tác thân thiện với người dùng */}
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
              onPress={handleRestartApp}
              activeOpacity={0.8}
            >
              <Ionicons name="refresh-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.primaryBtnText}>Khởi động lại ứng dụng</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.secondaryBtn,
                {
                  backgroundColor: isDark ? theme.card : '#ffffff',
                  borderColor: copied ? theme.green : theme.border,
                },
              ]}
              onPress={handleCopyErrorCode}
              activeOpacity={0.8}
            >
              <Ionicons
                name={copied ? 'checkmark-circle-outline' : 'copy-outline'}
                size={18}
                color={copied ? theme.green : theme.text}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.secondaryBtnText, { color: copied ? theme.green : theme.text }]}>
                {copied ? 'Đã sao chép mã lỗi' : 'Sao chép mã lỗi'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorId: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorId: '',
  };

  public static getDerivedStateFromError(_error: Error): State {
    // Tạo error ID ngắn để user có thể báo cáo — KHÔNG lộ chi tiết kỹ thuật (tuân thủ Phần 3.5)
    return {
      hasError: true,
      errorId: 'ERR_' + Date.now().toString(36).toUpperCase().slice(-6),
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Chỉ log phía server/console — KHÔNG bao giờ hiển thị ra UI
    console.error('[UI] App crash:', error?.message);
    console.error('[UI] Component stack:', errorInfo?.componentStack);
  }

  private handleRestart = () => {
    this.setState({ hasError: false, errorId: '' });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <ErrorFallbackView
          errorId={this.state.errorId}
          onRestart={this.handleRestart}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  contentWrap: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  iconWrap: {
    borderRadius: 48,
    padding: 18,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  errorCodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 18,
  },
  errorCodeLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginRight: 6,
  },
  errorCodeValue: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  tipCard: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  tipItem: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 6,
  },
  actionsContainer: {
    width: '100%',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
