import { useEffect, useState, useCallback } from 'react'
import type { TelegramWebApp } from '../types/telegram'

// Check if a feature is supported based on version
function isVersionAtLeast(version: string, minVersion: string): boolean {
  const parseVersion = (v: string) => {
    const parts = v.split('.').map(Number)
    return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0)
  }
  return parseVersion(version) >= parseVersion(minVersion)
}

export function useTelegramWebApp() {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const tg = window.Telegram?.WebApp

    if (tg) {
      tg.ready()
      tg.expand()
      setWebApp(tg)
      setIsReady(true)

      // Apply Telegram theme as CSS variables
      const root = document.documentElement
      const isDark = tg.colorScheme === 'dark'

      // Set theme colors with smart fallbacks for dark mode
      root.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || (isDark ? '#212121' : '#ffffff'))
      root.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || (isDark ? '#ffffff' : '#000000'))
      root.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color || (isDark ? '#aaaaaa' : '#999999'))
      root.style.setProperty('--tg-theme-link-color', tg.themeParams.link_color || '#3b82f6')
      root.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color || (isDark ? '#8774e1' : '#3b82f6'))
      root.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color || '#ffffff')

      // secondary_bg_color is critical for cards - ensure it exists
      root.style.setProperty(
        '--tg-theme-secondary-bg-color',
        tg.themeParams.secondary_bg_color || (isDark ? '#181818' : '#f4f4f5')
      )

      // Apply background color to body
      document.body.style.backgroundColor = tg.themeParams.bg_color || (isDark ? '#212121' : '#ffffff')
    } else {
      // Not in Telegram - web version with default colors
      setIsReady(true)
      const root = document.documentElement
      root.style.setProperty('--tg-theme-bg-color', '#ffffff')
      root.style.setProperty('--tg-theme-text-color', '#000000')
      root.style.setProperty('--tg-theme-hint-color', '#999999')
      root.style.setProperty('--tg-theme-link-color', '#3b82f6')
    }
  }, [])

  return {
    webApp,
    isReady,
    user: webApp?.initDataUnsafe.user,
    startParam: webApp?.initDataUnsafe.start_param,
    isInTelegram: !!webApp,
  }
}

// Helper hook for CloudStorage
export function useCloudStorage() {
  const { webApp, isInTelegram } = useTelegramWebApp()

  // CloudStorage is available from version 6.9+
  const hasCloudStorage = webApp && isVersionAtLeast(webApp.version, '6.9')

  const setItem = useCallback((key: string, value: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Use localStorage if not in Telegram or CloudStorage not supported
      if (!isInTelegram || !hasCloudStorage) {
        try {
          localStorage.setItem(key, value)
          resolve()
        } catch (e) {
          reject(e)
        }
        return
      }

      try {
        webApp!.CloudStorage.setItem(key, value, (error) => {
          if (error) reject(new Error(error))
          else resolve()
        })
      } catch (e) {
        // CloudStorage call failed, fallback to localStorage
        localStorage.setItem(key, value)
        resolve()
      }
    })
  }, [isInTelegram, webApp, hasCloudStorage])

  const getItem = useCallback((key: string): Promise<string | null> => {
    return new Promise((resolve, reject) => {
      // Use localStorage if not in Telegram or CloudStorage not supported
      if (!isInTelegram || !hasCloudStorage) {
        try {
          resolve(localStorage.getItem(key))
        } catch (e) {
          reject(e)
        }
        return
      }

      try {
        webApp!.CloudStorage.getItem(key, (error, value) => {
          if (error) reject(new Error(error))
          else resolve(value)
        })
      } catch (e) {
        // CloudStorage call failed, fallback to localStorage
        resolve(localStorage.getItem(key))
      }
    })
  }, [isInTelegram, webApp, hasCloudStorage])

  const getItems = useCallback((keys: string[]): Promise<Record<string, string>> => {
    return new Promise((resolve, reject) => {
      // Use localStorage if not in Telegram or CloudStorage not supported
      if (!isInTelegram || !hasCloudStorage) {
        try {
          const result: Record<string, string> = {}
          keys.forEach(key => {
            const value = localStorage.getItem(key)
            if (value !== null) result[key] = value
          })
          resolve(result)
        } catch (e) {
          reject(e)
        }
        return
      }

      try {
        webApp!.CloudStorage.getItems(keys, (error, values) => {
          if (error) reject(new Error(error))
          else resolve(values || {})
        })
      } catch (e) {
        // CloudStorage call failed, fallback to localStorage
        const result: Record<string, string> = {}
        keys.forEach(key => {
          const value = localStorage.getItem(key)
          if (value !== null) result[key] = value
        })
        resolve(result)
      }
    })
  }, [isInTelegram, webApp, hasCloudStorage])

  const removeItem = useCallback((key: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Use localStorage if not in Telegram or CloudStorage not supported
      if (!isInTelegram || !hasCloudStorage) {
        try {
          localStorage.removeItem(key)
          resolve()
        } catch (e) {
          reject(e)
        }
        return
      }

      try {
        webApp!.CloudStorage.removeItem(key, (error) => {
          if (error) reject(new Error(error))
          else resolve()
        })
      } catch (e) {
        // CloudStorage call failed, fallback to localStorage
        localStorage.removeItem(key)
        resolve()
      }
    })
  }, [isInTelegram, webApp, hasCloudStorage])

  return {
    setItem,
    getItem,
    getItems,
    removeItem,
  }
}
