import { supabase } from './supabase.js'

// Official 2026 Tournament Calendar (US Eastern Time)
const TOURNAMENT_CALENDAR = {
  '2026-03-17': 'Play-In', '2026-03-18': 'Play-In',
  '2026-03-19': 'Round of 64', '2026-03-20': 'Round of 64',
  '2026-03-21': 'Round of 32', '2026-03-22': 'Round of 32',
  '2026-03-26': 'Sweet Sixteen', '2026-03-27': 'Sweet Sixteen',
  '2026-03-28': 'Elite Eight', '2026-03-29': 'Elite Eight',
  '2026-04-04': 'Final Four', '2026-04-06': 'Championship'
}

/**
 * Universal Round Detector: Works for every game.
 * Prioritizes ESPN's internal labels, then falls back to a global 
 * timezone-adjusted calendar.
 */
function getTargetRound(event) {
  const headline = (event.notes?.[0]?.headline || event.competitions?.[0]?.notes?.[0]?.headline || "").toLowerCase();
  
  // 1. Priority: Use ESPN's official headline labels
  if (headline.includes('first four') || headline.includes('play-in')) return 'Play-In';
  if (headline.includes('round of 64') || headline.includes('first round')) return 'Round of 64';
  if (headline.includes('round of 32') || headline.includes('second round')) return 'Round of 32';
  if (headline.includes('sweet sixteen') || headline.includes('sweet 16')) return 'Sweet Sixteen';
  if (headline.includes('elite eight') || headline.includes('elite 8')) return 'Elite Eight';
  if (headline.includes('final four')) return 'Final Four';
  if (headline.includes('championship')) return 'Championship';

  // 2. Fallback: Global -5 Hour Shift (Aligns UTC with US Eastern)
  const date = new Date(event.date);
  date.setHours(date.getHours() - 5); 
  const localDateStr = date.toISOString().slice(0, 10);
  
  return TOURNAMENT_CALENDAR[localDateStr] || null;
}

export async function syncTournamentScores(onProgress) {
  // Get unique dates to fetch based on current tournament progress
  const todayISO = new Date().toISOString().slice(0, 10);
  const activeDates = Object.keys(TOURNAMENT_CALENDAR)
    .filter(date => date <= todayISO)
    .map(date => date.replace(/-/g, ''));

  const allStats = {}; 
  const losingTeamIds = new Set();
  const processedGameIds = new Set();

  onProgress?.(`Starting Universal Sync for ${activeDates.length} tournament days...`);

  for (const dateStr of activeDates) {
    // group 100 = Strict NCAA Men's Tournament filter
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`;
    const res = await fetch(url);
    const { events = [] } = await res.json();

    for (const event of events) {
      if (processedGameIds.has(event.id)) continue;

      // GUARD: Block any "Ghost" games from before the tournament began
      if (event.date < '2026-03-17T00:00Z') continue;

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
  const { data: drafted } = await supabase.from('players').select('id, name, espn_team_id').not('drafter_id', 'is', null);
  if (!drafted) return { matched: [], unmatched: [] };

  for (const p of drafted) {
    // A. Sync Eliminations
    if (p.espn_team_id && losingTeamIds.has(String(p.espn_team_id))) {
      await supabase.from('players').update({ is_eliminated: true }).eq('id', p.id);
    }
    // B. Sync Scores
    const rounds = allStats[p.name];
    if (rounds) {
      for (const [roundName, points] of Object.entries(rounds)) {
        await supabase.from('player_scores').upsert({
          player_id: p.id, round_name: roundName, points: points, updated_at: new Date().toISOString()
        }, { onConflict: 'player_id,round_name' });
      }
    }
  }

  onProgress?.(`✓ Universal Sync Finished. Processing complete.`);
  return { matched: [], unmatched: [] };
}