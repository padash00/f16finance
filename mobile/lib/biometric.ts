import * as LocalAuthentication from 'expo-local-authentication'
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'orda_biometric_enabled'

/** Есть ли железо и настроен ли отпечаток/лицо на устройстве. */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const has = await LocalAuthentication.hasHardwareAsync()
    const enrolled = await LocalAuthentication.isEnrolledAsync()
    return has && enrolled
  } catch {
    return false
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1'
  } catch {
    return false
  }
}

export async function setBiometricEnabled(v: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** Тип биометрии для подписи кнопки (Face ID / отпечаток). */
export async function biometricLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID'
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'отпечатку'
    return 'биометрии'
  } catch {
    return 'биометрии'
  }
}

export async function authenticate(): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Вход в Orda',
      cancelLabel: 'Отмена',
      disableDeviceFallback: false,
    })
    return r.success
  } catch {
    return false
  }
}
