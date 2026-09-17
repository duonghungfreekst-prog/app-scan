import { registerRootComponent } from 'expo';
import { Alert } from 'react-native';

const defaultHandler = (global as any).ErrorUtils?.getGlobalHandler?.();
(global as any).ErrorUtils?.setGlobalHandler?.((error: any, isFatal: boolean) => {
  Alert.alert('Fatal JS Error', `${error.name}: ${error.message}\n${error.stack}`);
  if (defaultHandler) {
    defaultHandler(error, isFatal);
  }
});

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
