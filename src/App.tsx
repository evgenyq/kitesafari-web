import { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { TripPage } from './pages/TripPage/TripPage'
import { CabinsPage } from './pages/CabinsPage/CabinsPage'
import { OnboardingPage } from './pages/OnboardingPage/OnboardingPage'
import { TripsListPage } from './pages/TripsListPage/TripsListPage'
import { AdminPage } from './pages/AdminPage/AdminPage'
import { useTelegramWebApp, useCloudStorage } from './hooks/useTelegramWebApp'

const ADMIN_USERNAMES = ['evgenyq']
const STORAGE_KEY = 'allowed_trips'

function AppContent() {
  const { webApp, user, startParam, isReady, isInTelegram } = useTelegramWebApp()
  const { getItem, setItem } = useCloudStorage()
  const navigate = useNavigate()
  const location = useLocation()

  const [allowedTrips, setAllowedTrips] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  // Check if user is admin
  useEffect(() => {
    if (user?.username && ADMIN_USERNAMES.includes(user.username.toLowerCase())) {
      setIsAdmin(true)
    }
  }, [user])

  // Load allowed trips from CloudStorage
  useEffect(() => {
    async function loadAllowedTrips() {
      if (!isReady) return

      try {
        const stored = await getItem(STORAGE_KEY)
        const trips = stored ? JSON.parse(stored) : []
        setAllowedTrips(trips)
      } catch (error) {
        console.error('Error loading trips:', error)
        setAllowedTrips([])
      } finally {
        setIsLoading(false)
      }
    }

    loadAllowedTrips()
  }, [isReady, getItem])

  // Handle start_param (invite link)
  useEffect(() => {
    async function handleStartParam() {
      if (!startParam || !isReady) return

      try {
        // Add trip to allowed list
        const stored = await getItem(STORAGE_KEY)
        const trips = stored ? JSON.parse(stored) : []

        if (!trips.includes(startParam)) {
          const updatedTrips = [...trips, startParam]
          await setItem(STORAGE_KEY, JSON.stringify(updatedTrips))
          setAllowedTrips(updatedTrips)
        } else {
          // Already have access, just update state
          setAllowedTrips(trips)
        }

        // Navigate to trip page (keep history for navigation)
        if (location.pathname === '/' || location.pathname === '/kitesafari-web') {
          navigate(`/${startParam}`)
        }
      } catch (error) {
        console.error('Error handling start param:', error)
      }
    }

    handleStartParam()
  }, [startParam, isReady, getItem, setItem, navigate, location.pathname])

  // Setup BackButton
  useEffect(() => {
    if (!webApp || !isInTelegram) return

    // BackButton is available from version 6.1+
    const version = webApp.version
    const hasBackButton = version && parseFloat(version) >= 6.1

    if (!hasBackButton) return

    const onBackClick = () => {
      if (location.pathname === '/kitesafari-web' || location.pathname === '/') {
        webApp.close()
      } else {
        navigate(-1)
      }
    }

    try {
      webApp.BackButton.onClick(onBackClick)

      // Show BackButton on non-root pages
      if (location.pathname !== '/kitesafari-web' && location.pathname !== '/') {
        webApp.BackButton.show()
      } else {
        webApp.BackButton.hide()
      }
    } catch (e) {
      // BackButton call failed, ignore
    }

    return () => {
      try {
        webApp.BackButton?.offClick(onBackClick)
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }, [webApp, isInTelegram, location.pathname, navigate])

  if (isLoading) {
    return <div style={{ padding: '24px', textAlign: 'center' }}>Загрузка...</div>
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          isAdmin ? (
            <TripsListPage allowedTripCodes={[]} isAdmin={true} />
          ) : allowedTrips.length > 0 ? (
            <TripsListPage allowedTripCodes={allowedTrips} />
          ) : (
            <OnboardingPage />
          )
        }
      />
      <Route path="/:accessCode" element={<TripPage />} />
      <Route path="/:accessCode/cabins" element={<CabinsPage />} />
      <Route path="/:accessCode/admin" element={<AdminPage />} />
    </Routes>
  )
}

function App() {
  return (
    <Router basename="/kitesafari-web">
      <AppContent />
    </Router>
  )
}

export default App
