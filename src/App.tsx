import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { TripPage } from './pages/TripPage/TripPage'
import { CabinsPage } from './pages/CabinsPage/CabinsPage'

function App() {
  return (
    <Router basename="/kitesafari-web">
      <Routes>
        <Route path="/:accessCode" element={<TripPage />} />
        <Route path="/:accessCode/cabins" element={<CabinsPage />} />
        <Route path="*" element={<div>404 - Trip not found</div>} />
      </Routes>
    </Router>
  )
}

export default App
