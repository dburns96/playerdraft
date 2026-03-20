import { supabase } from './supabase.js'

const TOURNAMENT_DATES = [
  '20260317', '20260318', // Play-In
  '20260319', '20260320', // Round of 64
  '20260321', '20260322', // Round of 32
]

// The DATE_TO_ROUND map is a fallback, but we'll use headlines first
const DATE_TO_ROUND = {
  '20260317': 'Play-In', '20260318': 'Play-In',
  '20260319': 'Round of 64', '20260320': 'Round of 64',
  '20260321': 'Round of 32', '20260322': 'Round of 32',
}

async function autoEliminateLosers(completedEvents, onProgress) {
  const losingTeamIds = new Set();
  
  for (const event of completedEvents) {
    // SECURITY: Only games that are STATUS_FINAL and part of the NCAA Tournament
    if (event.status?.type?.name !== 'STATUS_FINAL') continue;
    
    // Ignore any game that happened before the tournament officially started
    const gameDateStr = event.date.slice(0, 10).replace(/-/g, '');
    if (gameDateStr < '20260317') continue;

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

  if (!players?.length) return;

  const toEliminate = players.filter(p => losingTeamIds.has(String(p.espn_team_id)));
  if (toEliminate.length === 0) return;

  const ids = toEliminate.map(p => p.id);
  await supabase.from('players').update({ is_eliminated: true }).in('id', ids);
  onProgress?.(`✓ Eliminated: ${toEliminate.map(p => p.name).join(', ')}`);
}

export async function syncTournamentScores(onProgress) {
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const datesToFetch = TOURNAMENT_DATES.filter(d => d <= todayStr);
  
  const allStats = {};
  const completedEvents = [];
  const processedGameIds = new Set(); // TRACK GAMES TO PREVENT DUPLICATES

  for (const dateStr of datesToFetch) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=50&limit=300`);
    const { events = [] } = await res.json();

    for (const event of events) {
      // 1. Skip if game happened before March 17 or we already processed this Game ID
      const gameDateStr = event.date.slice(0, 10).replace(/-/g, '');
      if (gameDateStr < '20260317' || processedGameIds.has(event.id)) continue;
      
      // 2. Only process completed games
      if (event.status?.type?.name !== 'STATUS_FINAL') continue;

      processedGameIds.add(event.id);
      
      // 3. Determine round (Headline priority -> Date fallback)
      const headline = (event.notes?.[0]?.headline || "").toLowerCase();
      let roundName = DATE_TO_ROUND[gameDateStr] || 'Round of 64';
      if (headline.includes('first four') || headline.includes('play-in')) roundName = 'Play-In';

      event._tournamentRound = roundName;
      completedEvents.push(event);

      const sumRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`);
      const summary = await sumRes.json();

      summary.boxscore?.players?.forEach(team => {
        team.statistics?.forEach(group => {
          const ptsIdx = (group.names || []).indexOf('PTS');
          group.athletes?.forEach(ath => {
            const pts = parseInt(ath.stats?.[ptsIdx]);
            if (ath.athlete?.displayName && !isNaN(pts)) {
              const pName = ath.athlete.displayName;
              if (!allStats[pName]) allStats[pName] = [];
              allStats[pName].push({ points: pts, roundName });
            }
          });
        });
      });
    }
  }

  await autoEliminateLosers(completedEvents, onProgress);

  const { data: drafted } = await supabase.from('players').select('id, name').not('drafter_id', 'is', null);
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
      }
    }
  }

  return { matched: [], unmatched: [] };
}