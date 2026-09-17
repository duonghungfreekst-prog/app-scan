import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import FilesScreen from './src/screens/FilesScreen';
import ToolsScreen from './src/screens/ToolsScreen';
import MeScreen from './src/screens/MeScreen';
import ScannerScreen from './src/screens/ScannerScreen';
import QRScannerScreen from './src/screens/QRScannerScreen';
import QRGeneratorScreen from './src/screens/QRGeneratorScreen';
import { ThemeProvider, useTheme } from './src/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabNavigator() {
  const { theme } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName = 'home';
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Files') iconName = focused ? 'folder' : 'folder-outline';
          else if (route.name === 'Tools') iconName = focused ? 'construct' : 'construct-outline';
          else if (route.name === 'Me') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName as any} size={size} color={color} />;
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.border,
          borderTopWidth: 1,
          elevation: 8,
          shadowColor: theme.shadow,
          shadowOpacity: theme.dark ? 0.5 : 0.1,
          height: 62,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Trang chủ' }} />
      <Tab.Screen name="Files" component={FilesScreen} options={{ tabBarLabel: 'Tài liệu' }} />
      <Tab.Screen name="Tools" component={ToolsScreen} options={{ tabBarLabel: 'Công cụ' }} />
      <Tab.Screen name="Me" component={MeScreen} options={{ tabBarLabel: 'Cài đặt' }} />
    </Tab.Navigator>
  );
}

const linking = {
  prefixes: ['camscanner://', 'camscannerexpo://'],
  config: {
    screens: {
      MainTabs: '',
      Scanner: 'scanner',
      QRScanner: 'qrscanner',
      QRGenerator: 'qrgenerator',
    },
  },
};

import UpdateChecker from './src/components/UpdateChecker';

function AppInner() {
  const { theme } = useTheme();
  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <NavigationContainer linking={linking}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs" component={TabNavigator} />
          <Stack.Screen name="Scanner" component={ScannerScreen} />
          <Stack.Screen name="QRScanner" component={QRScannerScreen} />
          <Stack.Screen name="QRGenerator" component={QRGeneratorScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <UpdateChecker />
    </>
  );
}

import { ErrorBoundary } from './src/components/ErrorBoundary';

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <AppInner />
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
