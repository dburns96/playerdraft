import { Outlet, NavLink } from 'react-router-dom'

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? 'bg-orange-500 text-white'
            : 'text-slate-200 hover:bg-navy-600 hover:text-white'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-[#1e3a5f] text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold tracking-tight">🏀 HFF March Madness</h1>
            <p className="text-xs text-slate-300 mt-0.5">Player Draft League</p>
          </div>
          <nav className="flex gap-1 flex-wrap">
            <NavItem to="/">Standings</NavItem>
            <NavItem to="/scores">Player Scores</NavItem>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
