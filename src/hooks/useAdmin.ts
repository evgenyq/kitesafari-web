import { useState, useEffect } from 'react'

/**
 * Hook to check if current user is an admin
 * Used for UI purposes only - actual security is on backend
 */
export function useAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const webApp = window.Telegram?.WebApp
        if (!webApp || !webApp.initData) {
          setError('Not running in Telegram')
          setLoading(false)
          return
        }

        // Call create-booking with a test request to check auth
        // Backend will validate initData and return admin status
        // For now, we'll use a simple check - backend validates on every request anyway

        // TODO: Can create a dedicated /check-admin endpoint if needed
        // For MVP, just check if initData exists (backend does real check)

        const initData = webApp.initData
        if (!initData) {
          setIsAdmin(false)
          setLoading(false)
          return
        }

        // Try to parse user from initData (client-side hint only!)
        const params = new URLSearchParams(initData)
        const userParam = params.get('user')
        if (userParam) {
          // This is NOT secure - just a UI hint
          // Real check happens on backend
          // For MVP, assume non-admins just won't see the admin button
          setIsAdmin(true) // Optimistic - backend will reject if not admin
        }

        setLoading(false)
      } catch (err) {
        console.error('Error checking admin status:', err)
        setError('Failed to check admin status')
        setIsAdmin(false)
        setLoading(false)
      }
    }

    checkAdminStatus()
  }, [])

  return { isAdmin, loading, error }
}
