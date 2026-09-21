import 'react-native-gesture-handler';
import * as WebBrowser from 'expo-web-browser';
import { registerRootComponent } from 'expo';

// Deep link OAuth completion
WebBrowser.maybeCompleteAuthSession();

// Unhandled promise rejection listener để tránh đơ app trên Hermes
(globalThis as any).onunhandledrejection = (event: any) => {
  console.warn('[UNHANDLED PROMISE REJECTION]', event?.reason ?? event);
  if (typeof event?.preventDefault === 'function') {
    event.preventDefault();
  }
};

const defaultHandler = (globalThis as any).ErrorUtils?.getGlobalHandler?.();
(globalThis as any).ErrorUtils?.setGlobalHandler?.((error: any, isFatal: boolean) => {
  console.error('[FATAL JS ERROR]', error?.name, error?.message, error?.stack);
  if (defaultHandler) {
    defaultHandler(error, isFatal);
  }
});

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
