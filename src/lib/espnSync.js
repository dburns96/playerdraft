import { supabase } from './supabase.js'

// Official 2026 Tournament Dates
const CALENDAR = {
  '2026-03-17': 'Play-In', '2026-03-18': 'Play-In',
  '2026-03-19': 'Round of 64', '2026-03-20': 'Round of 64',
  '2026-03-21': 'Round of 32', '2026-03-22': 'Round of 32'
}

export async function syncTournamentScores(onProgress) {
  const dates = Object.keys(CALENDAR).filter(d => d <= new Date().toISOString().slice(0, 10)).map(d => d.replace(/-/g, ''));
  
  const allStats = {}; // { playerName: [{ points, roundName, gameId }] }
  const losingTeamIds = new Set();
  const processedGameIds = new Set();

  onProgress?.(`Syncing ${dates.length} days of verified tournament data...`);

  for (const dateStr of dates) {
    // group 100 = NCAA Men's Tournament only.
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`;
    const res = await fetch(url);
    const { events = [] } = await res.json();

    for (const event of events) {
      if (processedGameIds.has(event.id)) continue;

      // GUARD 1: Temporal Fence (Ignore conference tourney carry-over)
      const actualDate = event.date.slice(0, 10); // "2026-03-19"
      if (actualDate < '2026-03-17') continue; 

      // GUARD 2: Round Lockdown (Round is based on Game Date, not Sync Date)
      const roundName = CALENDAR[actualDate];
      if (!roundName) continue;

      processedGameIds.add(event.id);

      // GUARD 3: Elimination Lockdown (Only STATUS_FINAL and real winner/loser)
      if (event.status?.type?.name === 'STATUS_FINAL') {
        const competitors = event.competitions?.[0]?.competitors || [];
        for (const c of competitors) {
          if (c.winner === false && c.team?.id) losingTeamIds.add(String(c.team.id));
        }
      }

      // GUARD 4: Score Lockdown (Fetch player boxscores)
      const sumRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`);
      const summary = await sumRes.json();

      summary.boxscore?.players?.forEach(teamData => {
        teamData.statistics?.forEach(statGroup => {
          const ptsIdx = (statGroup.names || []).indexOf('PTS');
          if (ptsIdx === -1) return;
          statGroup.athletes?.forEach(ath => {
            const pts = parseInt(ath.stats?.[ptsIdx]);
            if (ath.athlete?.displayName && !isNaN(pts)) {
              const pName = ath.athlete.displayName;
              if (!allStats[pName]) allStats[pName] = [];
              // Prevent duplicate score entries (1 per game)
              if (!allStats[pName].some(s => s.gameId === event.id)) {
                allStats[pName].push({ points: pts, roundName, gameId: event.id });
              }
            }
          });
        });
      });
    }
  }

  // --- DATABASE UPDATE ---
  if (losingTeamIds.size > 0) {
    const { data: players } = await supabase.from('players').select('id, team, espn_team_id').eq('is_eliminated', false).not('espn_team_id', 'is', null);
    const toEliminate = players?.filter(p => losingTeamIds.has(String(p.espn_team_id))) || [];
    if (toEliminate.length > 0) {
      await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
      onProgress?.(`✓ Confirmed Eliminations: ${toEliminate.map(p => `${p.name} (${p.team})`).join(', ')}`);
    }
  }

  const { data: drafted } = await supabase.from('players').select('id, name').not('drafter_id', 'is', null);
  if (drafted) {
    for (const p of drafted) {
      const stats = allStats[p.name];
      if (stats) {
        for (const s of stats) {
          await supabase.from('player_scores').upsert({
            player_id: p.id, round_name: s.roundName, points: s.points, updated_at: new Date().toISOString()
          }, { onConflict: 'player_id,round_name' });
        }
      }
    }
  }
  return { matched: [], unmatched: [] };
}