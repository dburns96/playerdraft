import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const ROUNDS = ['Play-In', 'Round of 64', 'Round of 32', 'Sweet Sixteen', 'Elite Eight', 'Final Four', 'Championship']
const ROUND_SHORT = { 'Play-In': 'PI', 'Round of 64': 'R64', 'Round of 32': 'R32', 'Sweet Sixteen': 'S16', 'Elite Eight': 'E8', 'Final Four': 'F4', 'Championship': 'NAT' }

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

  const filtered = selectedDrafter === 'all' ? drafters : drafters.filter(d => d.id === selectedDrafter)
  const allDraftedPlayers = filtered.flatMap(d => (d.players || []).map(p => ({ ...p, drafterName: d.name })))

  if (allDraftedPlayers.length === 0 && drafters.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">📊</div>
        <h2 className="text-xl font-semibold text-slate-600">No players drafted yet</h2>
        <p className="text-slate-400 mt-2">Player scores will appear here once the draft is complete.</p>
      </div>
    )
  }

  function getPoints(player, round) {
    const score = (player.player_scores || []).find(s => s.round_name === round)
    return score?.points ?? null
  }

  function getTotal(player) {
    return (player.player_scores || []).reduce((sum, s) => sum + (s.points || 0), 0)
  }

  function getDrafterTotal(drafter) {
    return (drafter.players || []).reduce((sum, p) => sum + getTotal(p), 0)
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

      {/* Per-drafter tables */}
      {filtered.map(drafter => (
        <div key={drafter.id} className="mb-8">
          <div className="flex items-baseline gap-3 mb-2">
            <h3 className="text-lg font-bold text-slate-700">{drafter.name}</h3>
            <span className="text-orange-500 font-bold">{getDrafterTotal(drafter)} pts</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white shadow-sm rounded-xl overflow-hidden border border-slate-200">
              <thead className="bg-[#1e3a5f] text-white">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Player</th>
                  <th className="text-left px-3 py-2 font-semibold hidden sm:table-cell">Team</th>
                  <th className="text-center px-2 py-2 font-semibold text-slate-300 text-xs hidden md:table-cell">Reg PPG</th>
                  {ROUNDS.map(r => (
                    <th key={r} className="text-center px-2 py-2 font-semibold text-xs" title={r}>
                      {ROUND_SHORT[r]}
                    </th>
                  ))}
                  <th className="text-center px-3 py-2 font-bold text-orange-300">TOT</th>
                </tr>
              </thead>
              <tbody>
                {(drafter.players || []).map((player, idx) => {
                  const total = getTotal(player)
                  return (
                    <tr
                      key={player.id}
                      className={`border-t border-slate-100 ${
                        player.is_eliminated ? 'bg-slate-50' : idx % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <span className={player.is_eliminated ? 'line-through text-slate-400' : 'font-medium'}>
                          {player.name}
                        </span>
                        {player.is_eliminated && (
                          <span className="ml-1 text-xs bg-red-100 text-red-500 px-1 rounded">OUT</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500 hidden sm:table-cell">
                        {player.seed ? `(${player.seed}) ` : ''}{player.team}
                      </td>
                      <td className="px-2 py-2 text-center text-slate-400 text-xs hidden md:table-cell">
                        {player.season_ppg ?? '—'}
                      </td>
                      {ROUNDS.map(r => {
                        const pts = getPoints(player, r)
                        return (
                          <td key={r} className="px-2 py-2 text-center">
                            {pts === null ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <span className="font-medium">{pts}</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-center font-bold text-orange-500">{total}</td>
                    </tr>
                  )
                })}

                {/* Drafter totals row */}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                  <td className="px-3 py-2 text-slate-600" colSpan={2}>Team Total</td>
                  <td className="hidden md:table-cell" />
                  {ROUNDS.map(r => {
                    const roundTotal = (drafter.players || []).reduce((sum, p) => sum + (getPoints(p, r) || 0), 0)
                    const hasAny = (drafter.players || []).some(p => getPoints(p, r) !== null)
                    return (
                      <td key={r} className="px-2 py-2 text-center text-slate-600">
                        {hasAny ? roundTotal : <span className="text-slate-300">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-center text-orange-500 text-lg">{getDrafterTotal(drafter)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
