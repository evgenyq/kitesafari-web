import { useEffect, useState } from 'react'
import type { TelegramWebApp } from '../types/telegram'

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
      if (tg.themeParams.bg_color) {
        root.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color)
      }
      if (tg.themeParams.text_color) {
        root.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color)
      }
      if (tg.themeParams.hint_color) {
        root.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color)
      }
      if (tg.themeParams.link_color) {
        root.style.setProperty('--tg-theme-link-color', tg.themeParams.link_color)
      }
      if (tg.themeParams.button_color) {
        root.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color)
      }
      if (tg.themeParams.button_text_color) {
        root.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color)
      }
      if (tg.themeParams.secondary_bg_color) {
        root.style.setProperty('--tg-theme-secondary-bg-color', tg.themeParams.secondary_bg_color)
      }

      // Apply background color to body
      document.body.style.backgroundColor = tg.themeParams.bg_color || '#ffffff'
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

  const setItem = (key: string, value: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isInTelegram || !webApp) {
        // Fallback to localStorage
        try {
          localStorage.setItem(key, value)
          resolve()
        } catch (e) {
          reject(e)
        }
        return
      }

      webApp.CloudStorage.setItem(key, value, (error) => {
        if (error) reject(new Error(error))
        else resolve()
      })
    })
  }

  const getItem = (key: string): Promise<string | null> => {
    return new Promise((resolve, reject) => {
      if (!isInTelegram || !webApp) {
        // Fallback to localStorage
        try {
          resolve(localStorage.getItem(key))
        } catch (e) {
          reject(e)
        }
        return
      }

      webApp.CloudStorage.getItem(key, (error, value) => {
        if (error) reject(new Error(error))
        else resolve(value)
      })
    })
  }

  const getItems = (keys: string[]): Promise<Record<string, string>> => {
    return new Promise((resolve, reject) => {
      if (!isInTelegram || !webApp) {
        // Fallback to localStorage
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

      webApp.CloudStorage.getItems(keys, (error, values) => {
        if (error) reject(new Error(error))
        else resolve(values || {})
      })
    })
  }

  const removeItem = (key: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isInTelegram || !webApp) {
        try {
          localStorage.removeItem(key)
          resolve()
        } catch (e) {
          reject(e)
        }
        return
      }

      webApp.CloudStorage.removeItem(key, (error) => {
        if (error) reject(new Error(error))
        else resolve()
      })
    })
  }

  return {
    setItem,
    getItem,
    getItems,
    removeItem,
  }
}
