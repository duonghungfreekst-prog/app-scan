/**
 * navigation.ts — Type-safe routing và navigation parameters
 */

import { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Home: undefined;
  Files: undefined;
  Tools: { triggerAction?: string | null } | undefined;
  Me: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Scanner: { autoScan?: boolean; importImages?: string[] } | undefined;
  QRScanner: undefined;
  QRGenerator: undefined;
};
