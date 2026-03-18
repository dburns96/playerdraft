import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { simulationData } from '../lib/simulationData.js'
import { getLogoUrl } from '../lib/teamBranding.js'

const { standings: simStandings, top_scorers, championship_favorites, final_four_favorites, best_undrafted, n_sims } = simulationData

// Fuzzy match sim member name to drafter name
function matchMemberToDrafter(memberName, drafters) {
  const ml = memberName.toLowerCase()
  // Try last name match first (sim uses "Last First" or "First Last")
  for (const d of drafters) {
    const dl = d.name.toLowerCase()
    const memberParts = ml.split(' ')
    const drafterParts = dl.split(' ')
    // Any word overlap
    if (memberParts.some(p => p.length > 2 && drafterParts.includes(p))) return d
  }
  return null
}

function WinProbBar({ pct, color = '#f97316' }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${Math.min(pct * 100, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-sm font-bold w-12 text-right" style={{ color }}>
        {(pct * 100).toFixed(1)}%
      </span>
    </div>
  )
}

function RangeBar({ p10, p25, median, p75, p90, max }) {
  const pct = v => `${Math.min((v / max) * 100, 100)}%`
  return (
    <div className="relative h-5 flex items-center">
      {/* p10-p90 outer range */}
      <div
        className="absolute h-1.5 bg-blue-100 rounded"
        style={{ left: pct(p10), width: `calc(${pct(p90)} - ${pct(p10)})` }}
      />
      {/* p25-p75 inner range */}
      <div
        className="absolute h-3 bg-blue-300 rounded"
        style={{ left: pct(p25), width: `calc(${pct(p75)} - ${pct(p25)})` }}
      />
      {/* median tick */}
      <div
        className="absolute w-0.5 h-4 bg-blue-600 rounded"
        style={{ left: pct(median) }}
      />
    </div>
  )
}

function DrafterCard({ sim, drafter, currentPts, isExpanded, onToggle }) {
  const winColor = sim.win_pct > 0.2 ? '#16a34a' : sim.win_pct > 0.1 ? '#f97316' : '#94a3b8'
  const maxPlayerPts = Math.max(...sim.players.map(p => p.expected_pts), 1)

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${isExpanded ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'}`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full text-left p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      >
        <div className="flex items-center gap-3 flex-1">
          <span className="text-2xl font-black text-slate-300 w-8">#{sim.rank}</span>
          <div>
            <div className="font-bold text-lg text-slate-800">{drafter?.name || sim.member}</div>
            <div className="text-xs text-slate-400">{n_sims.toLocaleString()} simulations</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Current pts */}
          <div className="text-center w-20 shrink-0">
            <div className="text-2xl font-black text-orange-500">{currentPts}</div>
            <div className="text-xs text-slate-400">current pts</div>
          </div>
          {/* Projected total */}
          <div className="text-center w-20 shrink-0">
            <div className="text-2xl font-black text-blue-600">{sim.expected_total_pts}</div>
            <div className="text-xs text-slate-400">proj total</div>
          </div>
          {/* Range */}
          <div className="text-center w-24 shrink-0 hidden md:block">
            <div className="text-sm font-semibold text-slate-600">{sim.p10}–{sim.p90}</div>
            <div className="text-xs text-slate-400">p10–p90 range</div>
          </div>
          {/* Win % */}
          <div className="w-36 shrink-0">
            <div className="text-xs text-slate-400 mb-1">win probability</div>
            <WinProbBar pct={sim.win_pct} color={winColor} />
          </div>
          <span className="text-slate-300 text-lg w-4 shrink-0">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded player breakdown */}
      {isExpanded && (
        <div className="border-t border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Player Projections</h4>
            <span className="text-xs text-slate-400">— bar shows p25/p75 range, tick = median</span>
          </div>
          <div className="space-y-3">
            {sim.players.map(p => {
              const playerSim = top_scorers.find(s => s.player === p.player)
              const logo = getLogoUrl(p.team)
              return (
                <div key={p.player} className="flex items-center gap-3">
                  {logo && <img src={logo} alt={p.team} className="w-6 h-6 object-contain shrink-0" onError={e => { e.target.style.display = 'none' }} />}
                  <div className="w-36 shrink-0">
                    <div className="text-sm font-medium text-slate-700 truncate">{p.player}</div>
                    <div className="text-xs text-slate-400">{p.team}</div>
                  </div>
                  <div className="flex-1">
                    {playerSim ? (
                      <RangeBar
                        p10={playerSim.p10}
                        p25={playerSim.p25}
                        median={playerSim.median_pts}
                        p75={playerSim.p75}
                        p90={playerSim.p90}
                        max={150}
                      />
                    ) : (
                      <div className="h-3 bg-slate-100 rounded" />
                    )}
                  </div>
                  <div className="w-20 text-right shrink-0">
                    <span className="font-bold text-blue-600">{p.expected_pts}</span>
                    {playerSim && (
                      <span className="text-xs text-slate-400 ml-1">exp</span>
                    )}
                  </div>
                  {playerSim && (
                    <div className="w-24 text-right text-xs text-slate-400 shrink-0 hidden sm:block">
                      {playerSim.p10}–{playerSim.p90}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Totals */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center">
            <div className="text-sm text-slate-500">
              Projected range: <span className="font-semibold text-slate-700">{sim.p10} – {sim.p90} pts</span>
            </div>
            <div className="text-sm text-slate-500">
              Std dev: <span className="font-semibold text-slate-700">±{sim.std_pts} pts</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Projections() {
  const [drafters, setDrafters] = useState([])
  const [playerScores, setPlayerScores] = useState({}) // drafter_id -> total pts
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [activeTab, setActiveTab] = useState('standings')

  useEffect(() => {
    async function load() {
      const { data: draftersData } = await supabase
        .from('drafters')
        .select('id, name, draft_position, players(id, player_scores(points))')

      if (draftersData) {
        setDrafters(draftersData)
        const totals = {}
        for (const d of draftersData) {
          totals[d.id] = (d.players || []).reduce((sum, p) =>
            sum + (p.player_scores || []).reduce((s2, s) => s2 + (s.points || 0), 0), 0)
        }
        setPlayerScores(totals)
      }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="text-center py-16 text-slate-500">Loading projections...</div>

  // Match sim standings to drafters
  const enrichedStandings = simStandings.map(sim => ({
    sim,
    drafter: matchMemberToDrafter(sim.member, drafters),
  }))

  const getDrafterCurrentPts = (sim) => {
    const drafter = matchMemberToDrafter(sim.member, drafters)
    return drafter ? (playerScores[drafter.id] || 0) : 0
  }

  const TABS = ['standings', 'teams', 'top players']

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#1e3a5f]">Projections</h2>
          <p className="text-sm text-slate-500">
            Based on {n_sims.toLocaleString()} Monte Carlo simulations by your league's data scientist.
          </p>
        </div>
        <div className="flex gap-1 border border-slate-200 rounded-lg p-1 bg-white">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${
                activeTab === t ? 'bg-[#1e3a5f] text-white' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ── STANDINGS TAB ─────────────────────────────────────────── */}
      {activeTab === 'standings' && (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 mb-4">
            <strong>How to read this:</strong> "Current pts" is your live score from actual games played.
            "Proj total" is the simulation's expected final score based on remaining tournament games.
            The win probability is how often each drafter won across all {n_sims.toLocaleString()} simulations.
            Click any row to see player-level projections.
          </div>
          {enrichedStandings.map(({ sim, drafter }) => (
            <DrafterCard
              key={sim.member}
              sim={sim}
              drafter={drafter}
              currentPts={getDrafterCurrentPts(sim)}
              isExpanded={expanded === sim.member}
              onToggle={() => setExpanded(expanded === sim.member ? null : sim.member)}
            />
          ))}
        </div>
      )}

      {/* ── TEAMS TAB ─────────────────────────────────────────────── */}
      {activeTab === 'teams' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-700 mb-3">Championship Probabilities</h3>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Team</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Win %</th>
                    <th className="px-4 py-2.5 w-48"></th>
                  </tr>
                </thead>
                <tbody>
                  {championship_favorites.map((t, i) => {
                    const logo = getLogoUrl(t.team)
                    return (
                      <tr key={t.team} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="px-4 py-2 flex items-center gap-2">
                          {logo && <img src={logo} alt={t.team} className="w-5 h-5 object-contain" onError={e => { e.target.style.display = 'none' }} />}
                          <span className="font-medium">{t.team}</span>
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-[#1e3a5f]">
                          {(t.probability * 100).toFixed(1)}%
                        </td>
                        <td className="px-4 py-2">
                          <div className="bg-slate-200 rounded-full h-2 overflow-hidden">
                            <div
                              className="h-2 rounded-full bg-[#1e3a5f]"
                              style={{ width: `${(t.probability / championship_favorites[0].probability) * 100}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-bold text-slate-700 mb-3">Final Four Probabilities</h3>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Team</th>
                    <th className="text-center px-2 py-2.5 font-semibold">Seed</th>
                    <th className="text-center px-2 py-2.5 font-semibold">Region</th>
                    <th className="text-center px-3 py-2.5 font-semibold">F4 %</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Champ %</th>
                    <th className="text-center px-3 py-2.5 font-semibold hidden sm:table-cell">Exp Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {final_four_favorites.map((t, i) => {
                    const logo = getLogoUrl(t.team)
                    return (
                      <tr key={t.team} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="px-4 py-2 flex items-center gap-2">
                          {logo && <img src={logo} alt={t.team} className="w-5 h-5 object-contain" onError={e => { e.target.style.display = 'none' }} />}
                          <span className="font-medium">{t.team}</span>
                        </td>
                        <td className="px-2 py-2 text-center text-slate-500">{t.seed}</td>
                        <td className="px-2 py-2 text-center text-slate-500 text-xs">{t.region}</td>
                        <td className="px-3 py-2 text-center font-semibold text-orange-500">{(t.final_four_pct * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2 text-center font-bold text-[#1e3a5f]">{(t.champion_pct * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2 text-center text-slate-500 hidden sm:table-cell">{t.expected_wins.toFixed(1)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TOP PLAYERS TAB ───────────────────────────────────────── */}
      {activeTab === 'top players' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-700 mb-1">Top 25 Players by Expected Points</h3>
            <p className="text-sm text-slate-500 mb-3">Bar shows p25–p75 interquartile range. Tick = median.</p>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-semibold w-6">#</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Player</th>
                    <th className="text-left px-3 py-2.5 font-semibold hidden sm:table-cell">Team</th>
                    <th className="text-center px-2 py-2.5 font-semibold">Exp Pts</th>
                    <th className="text-center px-2 py-2.5 font-semibold hidden md:table-cell">Median</th>
                    <th className="px-3 py-2.5 font-semibold hidden lg:table-cell">Range (p10–p90)</th>
                  </tr>
                </thead>
                <tbody>
                  {top_scorers.map((p, i) => {
                    const logo = getLogoUrl(p.team)
                    return (
                      <tr key={p.player} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="px-3 py-2 text-slate-400 font-semibold">{p.rank}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {logo && <img src={logo} alt={p.team} className="w-5 h-5 object-contain shrink-0" onError={e => { e.target.style.display = 'none' }} />}
                            <span className="font-medium">{p.player}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-500 hidden sm:table-cell">{p.team}</td>
                        <td className="px-2 py-2 text-center font-bold text-blue-600">{p.expected_total_pts}</td>
                        <td className="px-2 py-2 text-center text-slate-500 hidden md:table-cell">{p.median_pts}</td>
                        <td className="px-3 py-2 hidden lg:table-cell">
                          <div className="flex items-center gap-2">
                            <RangeBar p10={p.p10} p25={p.p25} median={p.median_pts} p75={p.p75} p90={p.p90} max={160} />
                            <span className="text-xs text-slate-400 whitespace-nowrap">{p.p10}–{p.p90}</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {best_undrafted?.length > 0 && (
            <div>
              <h3 className="text-lg font-bold text-slate-700 mb-1">Best Undrafted Players</h3>
              <p className="text-sm text-slate-500 mb-3">Players not on any roster with the highest projected points.</p>
              <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-amber-500 text-white">
                    <tr>
                      <th className="text-left px-3 py-2.5 font-semibold">#</th>
                      <th className="text-left px-3 py-2.5 font-semibold">Player</th>
                      <th className="text-left px-3 py-2.5 font-semibold hidden sm:table-cell">Team</th>
                      <th className="text-center px-2 py-2.5 font-semibold">Exp Pts</th>
                      <th className="px-3 py-2.5 font-semibold hidden lg:table-cell">Range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {best_undrafted.map((p, i) => {
                      const logo = getLogoUrl(p.team)
                      return (
                        <tr key={p.player} className={i % 2 === 0 ? 'bg-white' : 'bg-amber-50/40'}>
                          <td className="px-3 py-2 text-slate-400 font-semibold">{p.rank}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {logo && <img src={logo} alt={p.team} className="w-5 h-5 object-contain shrink-0" onError={e => { e.target.style.display = 'none' }} />}
                              <span className="font-medium">{p.player}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-500 hidden sm:table-cell">{p.team}</td>
                          <td className="px-2 py-2 text-center font-bold text-amber-600">{p.expected_total_pts}</td>
                          <td className="px-3 py-2 hidden lg:table-cell">
                            <div className="flex items-center gap-2">
                              <RangeBar p10={p.p10} p25={p.p25} median={p.median_pts} p75={p.p75} p90={p.p90} max={160} />
                              <span className="text-xs text-slate-400 whitespace-nowrap">{p.p10}–{p.p90}</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
