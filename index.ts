import { registerRootComponent } from 'expo';

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
