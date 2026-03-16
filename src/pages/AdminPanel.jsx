import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { syncTournamentScores } from '../lib/espnSync.js'

const ROUNDS = ['Play-In', 'Round of 64', 'Round of 32', 'Sweet Sixteen', 'Elite Eight', 'Final Four', 'Championship']
const TABS = ['Drafters', 'Players', 'Scores', 'ESPN Sync']

// ─── Drafters Tab ──────────────────────────────────────────────────────────────
function DraftersTab() {
  const [drafters, setDrafters] = useState([])
  const [name, setName] = useState('')
  const [pos, setPos] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  async function load() {
    const { data } = await supabase.from('drafters').select('*').order('draft_position')
    setDrafters(data || [])
  }
  useEffect(() => { load() }, [])

  async function addDrafter(e) {
    e.preventDefault()
    if (!name || !pos) return
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('drafters').insert({ name: name.trim(), draft_position: parseInt(pos) })
    if (error) setMsg({ type: 'error', text: error.message })
    else { setName(''); setPos(''); await load() }
    setSaving(false)
  }

  async function deleteDrafter(id) {
    if (!confirm('Delete this drafter? This will also unassign their players.')) return
    await supabase.from('drafters').delete().eq('id', id)
    load()
  }

  return (
    <div className="space-y-6">
      <form onSubmit={addDrafter} className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Greg"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-40" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Draft Position (1–8)</label>
          <input type="number" min="1" max="8" value={pos} onChange={e => setPos(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-20" required />
        </div>
        <button disabled={saving} className="bg-[#1e3a5f] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#2d4a7a] disabled:opacity-50">
          Add Drafter
        </button>
      </form>
      {msg && <div className={`p-2 rounded text-sm ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{msg.text}</div>}

      <table className="w-full text-sm bg-white shadow-sm rounded-xl overflow-hidden border border-slate-200">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-slate-600">Draft Pos</th>
            <th className="text-left px-3 py-2 font-semibold text-slate-600">Name</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {drafters.map(d => (
            <tr key={d.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-500">#{d.draft_position}</td>
              <td className="px-3 py-2 font-medium">{d.name}</td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => deleteDrafter(d.id)} className="text-red-400 hover:text-red-600 text-xs">Delete</button>
              </td>
            </tr>
          ))}
          {drafters.length === 0 && (
            <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400 italic">No drafters added yet</td></tr>
          )}
        </tbody>
      </table>
      <p className="text-xs text-slate-400">Add all 8 drafters before starting the draft. Draft position determines snake order.</p>
    </div>
  )
}

// ─── Players Tab ──────────────────────────────────────────────────────────────
function PlayersTab() {
  const [players, setPlayers] = useState([])
  const [form, setForm] = useState({ name: '', team: '', seed: '', season_ppg: '' })
  const [csvText, setCsvText] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showCsvHelp, setShowCsvHelp] = useState(false)

  async function load() {
    const { data } = await supabase.from('players').select('*, drafter:drafter_id(name)').order('name')
    setPlayers(data || [])
  }
  useEffect(() => { load() }, [])

  async function addPlayer(e) {
    e.preventDefault()
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('players').insert({
      name: form.name.trim(),
      team: form.team.trim(),
      seed: form.seed ? parseInt(form.seed) : null,
      season_ppg: form.season_ppg ? parseFloat(form.season_ppg) : null,
    })
    if (error) setMsg({ type: 'error', text: error.message })
    else { setForm({ name: '', team: '', seed: '', season_ppg: '' }); setMsg({ type: 'ok', text: 'Player added!' }); await load() }
    setSaving(false)
  }

  async function importCsv() {
    setSaving(true); setMsg(null)
    const lines = csvText.trim().split('\n').filter(l => l.trim() && !l.startsWith('Name'))
    const rows = lines.map(line => {
      const [name, team, seed, season_ppg] = line.split(',').map(s => s.trim())
      return { name, team, seed: seed ? parseInt(seed) : null, season_ppg: season_ppg ? parseFloat(season_ppg) : null }
    }).filter(r => r.name && r.team)

    if (rows.length === 0) { setMsg({ type: 'error', text: 'No valid rows found. Check format.' }); setSaving(false); return }

    const { error } = await supabase.from('players').insert(rows)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setCsvText(''); setMsg({ type: 'ok', text: `Imported ${rows.length} players!` }); await load() }
    setSaving(false)
  }

  async function toggleEliminated(player) {
    await supabase.from('players').update({ is_eliminated: !player.is_eliminated }).eq('id', player.id)
    load()
  }

  async function deletePlayer(id) {
    if (!confirm('Delete this player?')) return
    await supabase.from('players').delete().eq('id', id)
    load()
  }

  return (
    <div className="space-y-6">
      {/* Add single player */}
      <form onSubmit={addPlayer} className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Player Name</label>
          <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Johni Broome"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-44" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Team</label>
          <input value={form.team} onChange={e => setForm(f => ({...f, team: e.target.value}))} placeholder="Auburn"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-32" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Seed</label>
          <input type="number" min="1" max="16" value={form.seed} onChange={e => setForm(f => ({...f, seed: e.target.value}))}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-16" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Reg Season PPG</label>
          <input type="number" step="0.1" value={form.season_ppg} onChange={e => setForm(f => ({...f, season_ppg: e.target.value}))}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-20" />
        </div>
        <button disabled={saving} className="bg-[#1e3a5f] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#2d4a7a] disabled:opacity-50">
          Add Player
        </button>
      </form>

      {/* CSV Import */}
      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-600">Bulk CSV Import</span>
          <button onClick={() => setShowCsvHelp(!showCsvHelp)} className="text-xs text-blue-500 hover:underline">
            {showCsvHelp ? 'Hide' : 'Show'} format guide
          </button>
        </div>
        {showCsvHelp && (
          <pre className="text-xs bg-white border border-slate-200 rounded p-2 mb-2 text-slate-500">
{`Name,Team,Seed,PPG
Johni Broome,Auburn,1,18.9
Cooper Flagg,Duke,1,18.9
Walter Clayton Jr.,Florida,1,17.4`}
          </pre>
        )}
        <textarea value={csvText} onChange={e => setCsvText(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono h-28 resize-none"
          placeholder="Paste CSV here..." />
        <button onClick={importCsv} disabled={saving || !csvText.trim()}
          className="mt-2 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50">
          Import CSV
        </button>
      </div>

      {msg && <div className={`p-2 rounded text-sm ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{msg.text}</div>}

      {/* Player list */}
      <table className="w-full text-sm bg-white shadow-sm rounded-xl overflow-hidden border border-slate-200">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left px-3 py-2 text-slate-600">Player</th>
            <th className="text-left px-3 py-2 text-slate-600">Team</th>
            <th className="text-center px-2 py-2 text-slate-600">Seed</th>
            <th className="text-center px-2 py-2 text-slate-600">PPG</th>
            <th className="text-left px-3 py-2 text-slate-600">Drafter</th>
            <th className="text-center px-2 py-2 text-slate-600">Eliminated</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {players.map(p => (
            <tr key={p.id} className={`border-t border-slate-100 ${p.is_eliminated ? 'bg-red-50' : ''}`}>
              <td className={`px-3 py-2 font-medium ${p.is_eliminated ? 'line-through text-slate-400' : ''}`}>{p.name}</td>
              <td className="px-3 py-2 text-slate-500">{p.team}</td>
              <td className="px-2 py-2 text-center text-slate-400">{p.seed || '—'}</td>
              <td className="px-2 py-2 text-center text-slate-400">{p.season_ppg || '—'}</td>
              <td className="px-3 py-2 text-slate-500">{p.drafter?.name || <span className="italic text-slate-300">undrafted</span>}</td>
              <td className="px-2 py-2 text-center">
                <button onClick={() => toggleEliminated(p)}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${p.is_eliminated ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                  {p.is_eliminated ? 'OUT' : 'Active'}
                </button>
              </td>
              <td className="px-2 py-2 text-right">
                <button onClick={() => deletePlayer(p.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
              </td>
            </tr>
          ))}
          {players.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400 italic">No players yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Scores Tab ──────────────────────────────────────────────────────────────
function ScoresTab() {
  const [players, setPlayers] = useState([])
  const [scores, setScores] = useState({}) // {[playerId_round]: points}
  const [editCell, setEditCell] = useState(null) // "playerId|round"
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data: playersData } = await supabase
      .from('players')
      .select('id, name, team, is_eliminated, drafter:drafter_id(name), player_scores(round_name, points)')
      .not('drafter_id', 'is', null)
      .order('name')

    setPlayers(playersData || [])
    const scoreMap = {}
    for (const p of playersData || []) {
      for (const s of p.player_scores || []) {
        scoreMap[`${p.id}|${s.round_name}`] = s.points
      }
    }
    setScores(scoreMap)
  }
  useEffect(() => { load() }, [])

  async function saveCell(playerId, round, val) {
    setSaving(true)
    const pts = parseInt(val)
    if (!isNaN(pts)) {
      await supabase.from('player_scores').upsert(
        { player_id: playerId, round_name: round, points: pts, updated_at: new Date().toISOString() },
        { onConflict: 'player_id,round_name' }
      )
      setScores(s => ({ ...s, [`${playerId}|${round}`]: pts }))
    }
    setEditCell(null)
    setSaving(false)
  }

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">Click any cell to manually enter points. This overrides ESPN sync data.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm bg-white shadow-sm rounded-xl overflow-hidden border border-slate-200">
          <thead className="bg-[#1e3a5f] text-white">
            <tr>
              <th className="text-left px-3 py-2">Player</th>
              <th className="text-left px-3 py-2 hidden sm:table-cell">Team</th>
              <th className="text-left px-3 py-2 hidden md:table-cell">Drafter</th>
              {ROUNDS.map(r => <th key={r} className="text-center px-2 py-2 text-xs whitespace-nowrap">{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {players.map((player, idx) => (
              <tr key={player.id} className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                <td className={`px-3 py-1.5 font-medium ${player.is_eliminated ? 'line-through text-slate-400' : ''}`}>{player.name}</td>
                <td className="px-3 py-1.5 text-slate-500 hidden sm:table-cell">{player.team}</td>
                <td className="px-3 py-1.5 text-slate-500 hidden md:table-cell">{player.drafter?.name}</td>
                {ROUNDS.map(r => {
                  const key = `${player.id}|${r}`
                  const isEditing = editCell === key
                  const val = scores[key]
                  return (
                    <td key={r} className="px-1 py-1 text-center">
                      {isEditing ? (
                        <input
                          autoFocus
                          type="number"
                          defaultValue={val ?? ''}
                          className="w-14 border border-orange-400 rounded px-1 py-0.5 text-xs text-center focus:outline-none"
                          onBlur={e => saveCell(player.id, r, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveCell(player.id, r, e.target.value)
                            if (e.key === 'Escape') setEditCell(null)
                          }}
                        />
                      ) : (
                        <button
                          onClick={() => { setEditCell(key); setEditVal(val ?? '') }}
                          className={`w-12 h-7 rounded text-xs hover:bg-orange-50 hover:border-orange-300 border ${
                            val !== undefined ? 'font-bold text-slate-700 border-slate-200' : 'text-slate-300 border-transparent'
                          }`}
                        >
                          {val !== undefined ? val : '—'}
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {players.length === 0 && (
              <tr><td colSpan={ROUNDS.length + 3} className="px-3 py-8 text-center text-slate-400 italic">
                No drafted players yet
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── ESPN Sync Tab ─────────────────────────────────────────────────────────────
function EspnSyncTab() {
  const [syncing, setSyncing] = useState(false)
  const [log, setLog] = useState([])
  const [result, setResult] = useState(null)
  const [lastSync, setLastSync] = useState(null)

  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'last_espn_sync').single()
      .then(({ data }) => setLastSync(data?.value || null))
  }, [])

  async function runSync() {
    setSyncing(true)
    setLog([])
    setResult(null)

    try {
      const res = await syncTournamentScores(msg => setLog(l => [...l, msg]))
      setResult(res)
      const { data } = await supabase.from('settings').select('value').eq('key', 'last_espn_sync').single()
      setLastSync(data?.value || null)
    } catch (err) {
      setResult({ error: err.message })
    }
    setSyncing(false)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h3 className="font-semibold text-slate-700">Sync Scores from ESPN</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Pulls points for all completed tournament games and matches them to your drafted players.
          </p>
          {lastSync && (
            <p className="text-xs text-slate-400 mt-1">Last synced: {new Date(lastSync).toLocaleString()}</p>
          )}
        </div>
        <button
          onClick={runSync}
          disabled={syncing}
          className="bg-orange-500 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
        >
          {syncing ? '⏳ Syncing...' : '🔄 Refresh Scores from ESPN'}
        </button>
      </div>

      {/* Live log */}
      {log.length > 0 && (
        <div className="bg-slate-900 text-green-400 rounded-xl p-4 font-mono text-xs h-48 overflow-y-auto">
          {log.map((l, i) => <div key={i}>&gt; {l}</div>)}
          {syncing && <div className="animate-pulse">&gt; _</div>}
        </div>
      )}

      {/* Results */}
      {result && !result.error && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="font-semibold text-green-700 mb-2">✅ Matched ({result.matched.length})</div>
            {result.matched.length === 0 ? (
              <p className="text-sm text-green-600 italic">None — check that players are drafted and tournament games are complete.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {result.matched.map((m, i) => (
                  <li key={i} className="text-green-800">
                    {m.ourName}
                    {m.ourName !== m.espnName && <span className="text-green-500 text-xs ml-1">(ESPN: {m.espnName})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <div className="font-semibold text-yellow-700 mb-2">⚠️ Unmatched ({result.unmatched.length})</div>
            {result.unmatched.length === 0 ? (
              <p className="text-sm text-yellow-600 italic">All players matched!</p>
            ) : (
              <>
                <ul className="text-sm space-y-1 mb-2">
                  {result.unmatched.map((n, i) => <li key={i} className="text-yellow-800">{n}</li>)}
                </ul>
                <p className="text-xs text-yellow-600">
                  For unmatched players, use the Scores tab to enter points manually. 
                  Make sure their name in the Players tab matches ESPN's spelling exactly.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {result?.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          <strong>Sync failed:</strong> {result.error}
          <p className="mt-1 text-xs">This might be a CORS issue. Try refreshing, or enter scores manually in the Scores tab.</p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>How it works:</strong> The sync fetches completed NCAA tournament games from ESPN's public API, 
        reads each player's points from the box score, and matches them to your drafted players by name.
        It's safe to run multiple times — it only updates, never duplicates.
      </div>
    </div>
  )
}

// ─── Main AdminPanel ────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [tab, setTab] = useState('Drafters')

  return (
    <div>
      <h2 className="text-2xl font-bold text-[#1e3a5f] mb-1">Admin Panel</h2>
      <p className="text-sm text-slate-500 mb-5">Only you can see this page.</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              tab === t
                ? 'border-orange-500 text-orange-600 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Drafters' && <DraftersTab />}
      {tab === 'Players' && <PlayersTab />}
      {tab === 'Scores' && <ScoresTab />}
      {tab === 'ESPN Sync' && <EspnSyncTab />}
    </div>
  )
}
