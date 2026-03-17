import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { getTeamBranding, getLogoUrl } from '../lib/teamBranding.js'

const ROUNDS = ['Play-In', 'Round of 64', 'Round of 32', 'Sweet Sixteen', 'Elite Eight', 'Final Four', 'Championship']
const ROUND_SHORT = { 'Play-In': 'PI', 'Round of 64': 'R64', 'Round of 32': 'R32', 'Sweet Sixteen': 'S16', 'Elite Eight': 'E8', 'Final Four': 'F4', 'Championship': 'NAT' }

function TeamBadge({ team }) {
  const branding = getTeamBranding(team)
  const logoUrl = getLogoUrl(team)
  if (!branding) return <span className="text-slate-500 text-xs">{team}</span>

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: branding.primary, color: branding.secondary, border: `1px solid ${branding.secondary}22` }}
    >
      {logoUrl && (
        <img
          src={logoUrl}
          alt={team}
          className="w-3.5 h-3.5 object-contain"
          onError={e => { e.target.style.display = 'none' }}
        />
      )}
      {team}
    </span>
  )
}

function PlayerRow({ player, idx, isEliminated }) {
  const branding = getTeamBranding(player.team)
  const logoUrl = getLogoUrl(player.team)
  const borderColor = branding?.primary || '#e2e8f0'

  function getPoints(round) {
    const score = (player.player_scores || []).find(s => s.round_name === round)
    return score?.points ?? null
  }

  const total = (player.player_scores || []).reduce((sum, s) => sum + (s.points || 0), 0)
  const isAlt = idx % 2 !== 0

  return (
    <tr
      className={`border-t border-slate-100 transition-colors ${isAlt ? 'bg-slate-50/60' : 'bg-white'} ${isEliminated ? 'opacity-60' : ''}`}
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <td className="px-3 py-2 max-w-0">
        <div className="flex items-center gap-2 overflow-hidden">
          {logoUrl && (
            <img
              src={logoUrl}
              alt={player.team}
              className="w-6 h-6 object-contain shrink-0"
              onError={e => { e.target.style.display = 'none' }}
            />
          )}
          <span className={`truncate ${isEliminated ? 'line-through text-slate-400' : 'font-semibold text-slate-800'}`}>
            {player.name}
          </span>
          {isEliminated && (
            <span className="text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded font-semibold shrink-0">OUT</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 hidden sm:table-cell max-w-0">
        <div className="overflow-hidden">
          <TeamBadge team={player.team} />
        </div>
      </td>
      <td className="px-2 py-2 text-center text-slate-400 text-xs hidden md:table-cell">
        {player.season_ppg ?? '—'}
      </td>
      {ROUNDS.map(r => {
        const pts = getPoints(r)
        return (
          <td key={r} className="px-2 py-2 text-center">
            {pts === null
              ? <span className="text-slate-200">—</span>
              : <span className={`font-semibold ${pts > 0 ? 'text-slate-800' : 'text-slate-400'}`}>{pts}</span>
            }
          </td>
        )
      })}
      <td className="px-3 py-2 text-center">
        <span className="font-bold text-lg" style={{ color: branding?.primary || '#F97316' }}>{total}</span>
      </td>
    </tr>
  )
}

export default function PlayerScores() {
  const [drafters, setDrafters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedDrafter, setSelectedDrafter] = useState('all')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('drafters')
        .select(`
          id, name, draft_position,
          players (
            id, name, team, seed, season_ppg, is_eliminated,
            player_scores (round_name, points)
          )
        `)
        .order('draft_position')
      if (error) { setError(error.message); setLoading(false); return }
      setDrafters(data || [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="text-center py-16 text-slate-500">Loading scores...</div>
  if (error) return <div className="text-center py-16 text-red-500">Error: {error}</div>

  if (drafters.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">📊</div>
        <h2 className="text-xl font-semibold text-slate-600">No players drafted yet</h2>
      </div>
    )
  }

  const filtered = selectedDrafter === 'all' ? drafters : drafters.filter(d => d.id === selectedDrafter)

  function getDrafterTotal(drafter) {
    return (drafter.players || []).reduce((sum, p) =>
      sum + (p.player_scores || []).reduce((s2, sc) => s2 + (sc.points || 0), 0), 0)
  }

  function getRoundTotal(drafter, round) {
    return (drafter.players || []).reduce((sum, p) => {
      const sc = (p.player_scores || []).find(s => s.round_name === round)
      return sum + (sc?.points || 0)
    }, 0)
  }

  function hasAnyRoundScore(drafter, round) {
    return (drafter.players || []).some(p =>
      (p.player_scores || []).some(s => s.round_name === round)
    )
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#1e3a5f]">Player Scores</h2>
          <p className="text-sm text-slate-500">Points by round for all drafted players.</p>
        </div>
        <select
          value={selectedDrafter}
          onChange={e => setSelectedDrafter(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="all">All Teams</option>
          {drafters.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {filtered.map(drafter => {
        const total = getDrafterTotal(drafter)
        return (
          <div key={drafter.id} className="mb-10">
            {/* Drafter header */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-lg font-bold text-slate-700">{drafter.name}</h3>
                <span className="text-2xl font-black text-orange-500">{total} pts</span>
                {/* Mini logo strip */}
                <div className="flex items-center gap-1">
                  {(drafter.players || []).map(p => {
                    const logo = getLogoUrl(p.team)
                    return logo ? (
                      <img
                        key={p.id}
                        src={logo}
                        alt={p.team}
                        title={p.name}
                        className={`w-7 h-7 object-contain ${p.is_eliminated ? 'opacity-30 grayscale' : ''}`}
                        onError={e => { e.target.style.display = 'none' }}
                      />
                    ) : null
                  })}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl shadow-sm border border-slate-200">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-44" />
                  <col className="w-36 hidden sm:table-column" />
                  <col className="w-12 hidden md:table-column" />
                  {ROUNDS.map(r => <col key={r} className="w-10" />)}
                  <col className="w-14" />
                </colgroup>
                <thead>
                  <tr className="bg-[#1e3a5f] text-white">
                    <th className="text-left px-3 py-2.5 font-semibold">Player</th>
                    <th className="text-left px-3 py-2.5 font-semibold hidden sm:table-cell">Team</th>
                    <th className="text-center px-2 py-2.5 font-semibold text-slate-300 text-xs hidden md:table-cell">PPG</th>
                    {ROUNDS.map(r => (
                      <th key={r} className="text-center px-2 py-2.5 font-semibold text-xs" title={r}>
                        {ROUND_SHORT[r]}
                      </th>
                    ))}
                    <th className="text-center px-3 py-2.5 font-bold text-orange-300">TOT</th>
                  </tr>
                </thead>
                <tbody>
                  {(drafter.players || []).map((player, idx) => (
                    <PlayerRow key={player.id} player={player} idx={idx} isEliminated={player.is_eliminated} />
                  ))}
                  {/* Totals row */}
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-sm">
                    <td className="px-3 py-2 text-slate-600" colSpan={2}>Team Total</td>
                    <td className="hidden md:table-cell" />
                    {ROUNDS.map(r => (
                      <td key={r} className="px-2 py-2 text-center text-slate-600">
                        {hasAnyRoundScore(drafter, r)
                          ? getRoundTotal(drafter, r)
                          : <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center text-orange-500 text-lg">{total}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
