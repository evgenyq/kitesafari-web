import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { TripPage } from './pages/TripPage/TripPage'

function App() {
  return (
    <Router basename="/kitesafari-web">
      <Routes>
        <Route path="/:accessCode" element={<TripPage />} />
        <Route path="/:accessCode/cabins" element={<div>Cabins Page - Coming soon!</div>} />
        <Route path="*" element={<div>404 - Trip not found</div>} />
      </Routes>
    </Router>
  )
}

export default App
