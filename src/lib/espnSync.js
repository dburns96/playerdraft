import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', // First Four
  '20260319', '20260320', // Round of 64
  '20260321', '20260322', // Round of 32
  '20260326', '20260327', // Sweet Sixteen
  '20260328', '20260329', // Elite Eight
  '20260404', '20260406'  // Final Four / Championship
]

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
  const validDates = new Set(TOURNAMENT_DATES);
  
  for (const event of completedEvents) {
    // 1. MUST be completed
    if (event.status?.type?.completed !== true) continue;
    
    // 2. MUST be within the NCAA Tournament dates (Blocks March 14 Big 12 loss)
    const eventDate = event.date.slice(0, 10).replace(/-/g, '');
    if (!validDates.has(eventDate)) continue;

    // 3. MUST be Men's Postseason
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

  await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
  onProgress?.(`✓ Confirmed Eliminations: ${toEliminate.map(p => `${p.name} (${p.team})`).join(', ')}`);
}

export async function syncTournamentScores(onProgress) {
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= todayStr);
  
  const allStats = {};
  const completedEvents = [];
  const matched = [];
  const unmatched = [];

  for (const dateStr of datesToFetch) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`);
    const { events = [] } = await res.json();

    for (const event of events) {
      const eventDate = event.date.slice(0, 10).replace(/-/g, '');
      const roundName = DATE_TO_ROUND[eventDate] || 'Postseason';
      
      if (event.status?.type?.completed) {
        event._tournamentRound = roundName;
        completedEvents.push(event);
      }

      // Fetch player stats for scoring
      const sumRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`);
      const summary = await sumRes.json();

      summary.boxscore?.players?.forEach(team => {
        team.statistics?.forEach(group => {
          const ptsIdx = (group.names || []).indexOf('PTS');
          group.athletes?.forEach(ath => {
            const pts = parseInt(ath.stats?.[ptsIdx]);
            if (ath.athlete?.displayName && !isNaN(pts)) {
              if (!allStats[ath.athlete.displayName]) allStats[ath.athlete.displayName] = [];
              if (!allStats[ath.athlete.displayName].some(s => s.roundName === roundName)) {
                allStats[ath.athlete.displayName].push({ points: pts, roundName });
              }
            }
          });
        });
      });
    }
  }

  await autoEliminateLosers(completedEvents, onProgress);

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