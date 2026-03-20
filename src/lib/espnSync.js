import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', // First Four
  '20260319', '20260320', // Round of 64
  '20260321', '20260322', // Round of 32
  '20260326', '20260327', // Sweet Sixteen
  '20260328', '20260329', // Elite Eight
  '20260404', '20260406'  // Final Four / Championship
]

// Primary source for round names to ensure correct columns
const DATE_TO_ROUND = {
  '20260317': 'Play-In', '20260318': 'Play-In',
  '20260319': 'Round of 64', '20260320': 'Round of 64',
  '20260321': 'Round of 32', '20260322': 'Round of 32',
  '20260326': 'Sweet Sixteen', '20260327': 'Sweet Sixteen',
  '20260328': 'Elite Eight', '20260329': 'Elite Eight',
  '20260404': 'Final Four', '20260406': 'Championship'
}

async function autoEliminateLosers(completedEvents, onProgress) {
  const losingTeamIds = new Set();
  
  for (const event of completedEvents) {
    // CRITICAL FIX: Only eliminate if the game is actually FINISHED
    if (event.status?.type?.completed !== true) continue;
    
    // Safety check: Only process NCAA Tournament games (Season Type 3)
    if (event.season?.type !== 3 && event.season?.type !== '3') continue;

    const competitors = event.competitions?.[0]?.competitors || [];
    for (const c of competitors) {
      if (c.winner === false && c.team?.id) {
        losingTeamIds.add(String(c.team.id));
      }
    }
  }

  if (losingTeamIds.size === 0) return;

  const { data: players } = await supabase
    .from('players')
    .select('id, name, team, espn_team_id')
    .eq('is_eliminated', false)
    .not('espn_team_id', 'is', null);

  if (!players || players.length === 0) return;

  const toEliminate = players.filter(p => losingTeamIds.has(String(p.espn_team_id)));
  
  if (toEliminate.length === 0) return;

  const ids = toEliminate.map(p => p.id);
  await supabase.from('players').update({ is_eliminated: true }).in('id', ids);
  onProgress?.(`✓ Confirmed Eliminations: ${toEliminate.map(p => `${p.name} (${p.team})`).join(', ')}`);
}

export async function syncTournamentScores(onProgress) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= today);
  
  const allStats = {};
  const completedEvents = [];
  const matched = [];
  const unmatched = [];

  for (const dateStr of datesToFetch) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`;
    const res = await fetch(url);
    const { events = [] } = await res.json();

    for (const event of events) {
      // Use date-based round names so points go to 'Round of 64' instead of 'Championship'
      const roundName = DATE_TO_ROUND[dateStr] || 'Postseason';
      
      if (event.status?.type?.completed) {
        event._tournamentRound = roundName;
        completedEvents.push(event);
      }

      // Fetch player stats
      const sumUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`;
      const sumRes = await fetch(sumUrl);
      const summary = await sumRes.json();

      summary.boxscore?.players?.forEach(team => {
        team.statistics?.forEach(group => {
          const ptsIdx = (group.names || []).indexOf('PTS');
          group.athletes?.forEach(ath => {
            const pts = parseInt(ath.stats?.[ptsIdx]);
            if (ath.athlete?.displayName && !isNaN(pts)) {
              const pName = ath.athlete.displayName;
              if (!allStats[pName]) allStats[pName] = [];
              // Avoid duplicate scores for the same round
              if (!allStats[pName].some(s => s.roundName === roundName)) {
                allStats[pName].push({ points: pts, roundName });
              }
            }
          });
        });
      });
    }
  }

  // 1. Run strict elimination (Completed games only)
  await autoEliminateLosers(completedEvents, onProgress);

  // 2. Map scores to database
  const { data: drafted } = await supabase.from('players').select('id, name, team').not('drafter_id', 'is', null);
  if (drafted) {
    for (const p of drafted) {
      const stats = allStats[p.name];
      if (stats) {
        for (const s of stats) {
          await supabase.from('player_scores').upsert(
            { player_id: p.id, round_name: s.roundName, points: s.points, updated_at: new Date().toISOString() },
            { onConflict: 'player_id,round_name' }
          );
        }
        matched.push(p.name);
      } else { unmatched.push(p.name); }
    }
  }

  await supabase.from('settings').upsert({ key: 'last_espn_sync', value: new Date().toISOString() });
  return { matched, unmatched };
}