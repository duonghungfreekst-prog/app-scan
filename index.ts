import { registerRootComponent } from 'expo';
import { Alert } from 'react-native';

const defaultHandler = (globalThis as any).ErrorUtils?.getGlobalHandler?.();
(globalThis as any).ErrorUtils?.setGlobalHandler?.((error: any, isFatal: boolean) => {
  console.error('[FATAL JS ERROR]', error?.name, error?.message, error?.stack);
  const errCode = 'ERR_' + Date.now().toString(36).toUpperCase().slice(-6);
  if (__DEV__) {
    Alert.alert('Fatal JS Error (Dev)', `${error?.name}: ${error?.message}\n${error?.stack}`);
  } else {
    Alert.alert('Sự cố ứng dụng', `Đã xảy ra lỗi không mong muốn (Mã lỗi: ${errCode}). Vui lòng khởi động lại ứng dụng.`);
  }
  if (defaultHandler) {
    defaultHandler(error, isFatal);
  }
});

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
