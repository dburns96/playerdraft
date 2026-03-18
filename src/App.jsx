import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Standings from './pages/Standings.jsx'
import PlayerScores from './pages/PlayerScores.jsx'
import AdminPanel from './pages/AdminPanel.jsx'
import DraftMode from './pages/DraftMode.jsx'
import NotFound from './pages/NotFound.jsx'
import Projections from './pages/Projections.jsx'

const ADMIN_SLUG = import.meta.env.VITE_ADMIN_SLUG

function AdminRoute({ element }) {
  if (!ADMIN_SLUG) return <div className="p-8 text-red-600">VITE_ADMIN_SLUG not set in .env</div>
  return element
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Standings />} />
        <Route path="scores" element={<PlayerScores />} />
        <Route path="projections" element={<Projections />} />
        <Route path={`admin/${ADMIN_SLUG}`} element={<AdminRoute element={<AdminPanel />} />} />
        <Route path={`draft/${ADMIN_SLUG}`} element={<AdminRoute element={<DraftMode />} />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
