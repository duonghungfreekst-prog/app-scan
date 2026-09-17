import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
    // Tạo error ID ngắn để user có thể báo cáo — KHÔNG lộ chi tiết kỹ thuật
    return {
      hasError: true,
      errorId: 'ERR_' + Date.now().toString(36).toUpperCase().slice(-6),
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Chỉ log phía server/console — KHÔNG bao giờ hiển thị ra UI
    console.error('[UI] App crash:', error.message);
    console.error('[UI] Component stack:', errorInfo.componentStack);
  }

  private handleRestart = () => {
    this.setState({ hasError: false, errorId: '' });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.iconWrap}>
            <Ionicons name="warning-outline" size={64} color="#ef6c00" />
          </View>
          <Text style={styles.title}>Ứng dụng gặp sự cố</Text>
          <Text style={styles.subtitle}>
            Đã xảy ra lỗi không mong muốn. Vui lòng thử lại hoặc khởi động lại ứng dụng.
          </Text>
          <Text style={styles.errorCode}>Mã lỗi: {this.state.errorId}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={this.handleRestart}>
            <Ionicons name="refresh" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.retryText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  iconWrap: {
    backgroundColor: '#ef6c0015',
    borderRadius: 64,
    padding: 20,
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2c3e50',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#7f8c8d',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  errorCode: {
    fontSize: 12,
    color: '#b2bec3',
    fontFamily: 'monospace',
    marginBottom: 32,
    backgroundColor: '#e8e8e8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00bfa5',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#00bfa5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  retryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

