/**
 * navigation.ts — Type-safe routing và navigation parameters
 */

import type { NavigatorScreenParams, CompositeScreenProps, RouteProp } from '@react-navigation/native';
import type { NativeStackScreenProps, NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabScreenProps, BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

export type ToolsActionType =
  | 'idCard'
  | 'book'
  | 'ocr'
  | 'importImages'
  | 'importFiles'
  | 'pdfTools'
  | 'qrGen';

export type ToolsScreenParams = {
  triggerAction?: ToolsActionType | null;
};

export type ScannerScreenParams = {
  autoScan?: boolean;
  importImages?: string[];
  bookMode?: boolean;
};

export type MainTabParamList = {
  Home: undefined;
  Files: undefined;
  Tools: ToolsScreenParams | undefined;
  Me: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Scanner: ScannerScreenParams | undefined;
  QRScanner: undefined;
  QRGenerator: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

// Generic screen props
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type MainTabScreenProps<T extends keyof MainTabParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, T>,
    NativeStackScreenProps<RootStackParamList>
  >;

// Screen Props định nghĩa chặt chẽ cho 7 màn hình
export type HomeScreenProps = MainTabScreenProps<'Home'>;
export type FilesScreenProps = MainTabScreenProps<'Files'>;
export type ToolsScreenProps = MainTabScreenProps<'Tools'>;
export type MeScreenProps = MainTabScreenProps<'Me'>;

export type ScannerScreenProps = RootStackScreenProps<'Scanner'>;
export type QRScannerScreenProps = RootStackScreenProps<'QRScanner'>;
export type QRGeneratorScreenProps = RootStackScreenProps<'QRGenerator'>;

// Navigation Props và Route Props chuyên biệt cho từng màn hình
export type HomeScreenNavigationProp = HomeScreenProps['navigation'];
export type HomeScreenRouteProp = HomeScreenProps['route'];

export type FilesScreenNavigationProp = FilesScreenProps['navigation'];
export type FilesScreenRouteProp = FilesScreenProps['route'];

export type ToolsScreenNavigationProp = ToolsScreenProps['navigation'];
export type ToolsScreenRouteProp = ToolsScreenProps['route'];

export type MeScreenNavigationProp = MeScreenProps['navigation'];
export type MeScreenRouteProp = MeScreenProps['route'];

export type ScannerScreenNavigationProp = ScannerScreenProps['navigation'];
export type ScannerScreenRouteProp = ScannerScreenProps['route'];

export type QRScannerScreenNavigationProp = QRScannerScreenProps['navigation'];
export type QRScannerScreenRouteProp = QRScannerScreenProps['route'];

export type QRGeneratorScreenNavigationProp = QRGeneratorScreenProps['navigation'];
export type QRGeneratorScreenRouteProp = QRGeneratorScreenProps['route'];
