import { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { TripPage } from './pages/TripPage/TripPage'
import { CabinsPage } from './pages/CabinsPage/CabinsPage'
import { OnboardingPage } from './pages/OnboardingPage/OnboardingPage'
import { TripsListPage } from './pages/TripsListPage/TripsListPage'
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
        }

        // Navigate to trip page
        navigate(`/${startParam}`, { replace: true })
      } catch (error) {
        console.error('Error handling start param:', error)
      }
    }

    handleStartParam()
  }, [startParam, isReady, getItem, setItem, navigate])

  // Setup BackButton
  useEffect(() => {
    if (!webApp || !isInTelegram) return

    const onBackClick = () => {
      if (location.pathname === '/kitesafari-web' || location.pathname === '/') {
        webApp.close()
      } else {
        navigate(-1)
      }
    }

    webApp.BackButton.onClick(onBackClick)

    // Show BackButton on non-root pages
    if (location.pathname !== '/kitesafari-web' && location.pathname !== '/') {
      webApp.BackButton.show()
    } else {
      webApp.BackButton.hide()
    }

    return () => {
      webApp.BackButton.offClick(onBackClick)
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
            // Admin sees all trips - we'll show a message for now
            <TripsListPage allowedTripCodes={[]} />
          ) : allowedTrips.length > 0 ? (
            <TripsListPage allowedTripCodes={allowedTrips} />
          ) : (
            <OnboardingPage />
          )
        }
      />
      <Route path="/:accessCode" element={<TripPage />} />
      <Route path="/:accessCode/cabins" element={<CabinsPage />} />
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
