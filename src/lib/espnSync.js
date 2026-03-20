import { supabase } from './supabase.js'

// Official 2026 Tournament Calendar (US Eastern Time)
// By hard-locking rounds to dates, we ignore ESPN's generic "Championship" titles.
const TOURNAMENT_CALENDAR = {
  '2026-03-17': 'Play-In', '2026-03-18': 'Play-In',
  '2026-03-19': 'Round of 64', '2026-03-20': 'Round of 64',
  '2026-03-21': 'Round of 32', '2026-03-22': 'Round of 32',
  '2026-03-26': 'Sweet Sixteen', '2026-03-27': 'Sweet Sixteen',
  '2026-03-28': 'Elite Eight', '2026-03-29': 'Elite Eight',
  '2026-04-04': 'Final Four', '2026-04-06': 'Championship'
}

// Strictly ignore anything before the First Four began (Tuesday, March 17)
const TOURNAMENT_START_TIME = new Date('2026-03-17T00:00:00Z').getTime();

/**
 * Universal Round Detector:
 * Maps the game to a round strictly by its US Eastern date.
 * This handles late-night rollovers (like Boopie Miller) and prevents 
 * generic title leaks into the Championship column.
 */
function getTargetRound(event) {
  const gameTime = new Date(event.date);
  if (isNaN(gameTime.getTime())) return null;

  // Shift UTC to US Eastern (-5h) to keep late games on the correct calendar day
  const localTime = new Date(gameTime.getTime() - (5 * 60 * 60 * 1000));
  const localDateStr = localTime.toISOString().slice(0, 10);
  
  return TOURNAMENT_CALENDAR[localDateStr] || null;
}

export async function syncTournamentScores(onProgress) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const activeDates = Object.keys(TOURNAMENT_CALENDAR)
    .filter(date => date <= todayISO)
    .map(date => date.replace(/-/g, ''));

  const allStats = {}; 
  const losingTeamIds = new Set();
  const processedGameIds = new Set();

  onProgress?.(`Starting sync for ${activeDates.length} days of tournament data...`);

  for (const dateStr of activeDates) {
    // group 100 = Strict NCAA Men's Tournament filter
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`;
    const res = await fetch(url);
    const { events = [] } = await res.json();

    for (const event of events) {
      if (processedGameIds.has(event.id)) continue;

      // GUARD 1: TEMPORAL FENCE (Blocks Arizona/Saint Louis March 14 conference losses)
      const eventStartTime = new Date(event.date).getTime();
      if (eventStartTime < TOURNAMENT_START_TIME) continue;

      // GUARD 2: CALENDAR ROUNDING (Prevents "Championship" column leak)
      const roundName = getTargetRound(event);
      if (!roundName) continue;
      processedGameIds.add(event.id);

      // --- 1. ELIMINATION LOGIC ---
      if (event.status?.type?.name === 'STATUS_FINAL') {
        const competitors = event.competitions?.[0]?.competitors || [];
        for (const c of competitors) {
          if (c.winner === false && c.team?.id) losingTeamIds.add(String(c.team.id));
        }
      }

      // --- 2. PLAYER SCORE LOGIC ---
      const sumRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`);
      const summary = await sumRes.json();
      summary.boxscore?.players?.forEach(teamData => {
        teamData.statistics?.forEach(statGroup => {
          const ptsIdx = (statGroup.names || []).indexOf('PTS');
          if (ptsIdx === -1) return;
          statGroup.athletes?.forEach(ath => {
            const pts = parseInt(ath.stats?.[ptsIdx]);
            if (ath.athlete?.displayName && !isNaN(pts) && pts > 0) {
              const pName = ath.athlete.displayName;
              if (!allStats[pName]) allStats[pName] = {};
              allStats[pName][roundName] = (allStats[pName][roundName] || 0) + pts;
            }
          });
        });
      });
    }
  }

  // --- DATABASE UPDATE PHASE ---
  
  // A. Eliminations (Strictly STATUS_FINAL + Tournament Games Only)
  if (losingTeamIds.size > 0) {
    const { data: activePlayers } = await supabase.from('players')
      .select('id, name, team, espn_team_id')
      .eq('is_eliminated', false)
      .not('espn_team_id', 'is', null);
      
    const toEliminate = activePlayers?.filter(p => losingTeamIds.has(String(p.espn_team_id))) || [];
    if (toEliminate.length > 0) {
      await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
      onProgress?.(`✓ Confirmed Eliminations: ${toEliminate.map(p => `${p.name} (${p.team})`).join(', ')}`);
    }
  }

  // B. Scores (Date-Strict Round Assignment)
  const { data: drafted } = await supabase.from('players').select('id, name').not('drafter_id', 'is', null);
  if (drafted) {
    for (const p of drafted) {
      const rounds = allStats[p.name];
      if (rounds) {
        for (const [roundName, points] of Object.entries(rounds)) {
          await supabase.from('player_scores').upsert({
            player_id: p.id, round_name: roundName, points: points, updated_at: new Date().toISOString()
          }, { onConflict: 'player_id,round_name' });
        }
      }
    }
  }

  onProgress?.(`✓ Sync finished. Leaderboard is now accurate.`);
  return { matched: [], unmatched: [] };
}