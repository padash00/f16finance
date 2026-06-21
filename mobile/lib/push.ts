import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'

import { apiFetch } from './api'

// Показывать уведомления, когда приложение открыто.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

/**
 * Запрашивает разрешение, получает Expo push-токен и регистрирует его на сервере.
 * Best-effort: молча выходит, если нет железа / разрешения / projectId (Expo Go без EAS).
 */
export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return

    const current = await Notifications.getPermissionsAsync()
    let status = current.status
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status
    }
    if (status !== 'granted') return

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Orda',
        importance: Notifications.AndroidImportance.DEFAULT,
      })
    }

    const projectId =
      (Constants?.expoConfig as any)?.extra?.eas?.projectId ?? (Constants as any)?.easConfig?.projectId
    if (!projectId) return // в Expo Go без EAS токен не получить — будет после dev/EAS-сборки

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId })
    const token = tokenResp?.data
    if (!token) return

    await apiFetch('/api/mobile/register-push', {
      method: 'POST',
      body: JSON.stringify({ token, platform: Platform.OS }),
    })
  } catch {
    /* best-effort */
  }
}
