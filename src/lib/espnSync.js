import { supabase } from './supabase.js'

// Calendar for date-based fallback (adjusted for timezone in code)
const TOURNAMENT_CALENDAR = {
  '2026-03-17': 'Play-In',
  '2026-03-18': 'Play-In',
  '2026-03-19': 'Round of 64',
  '2026-03-20': 'Round of 64',
  '2026-03-21': 'Round of 32',
  '2026-03-22': 'Round of 32',
}

/**
 * Detects the correct tournament round name using ESPN headlines 
 * with a timezone-aware date fallback.
 */
function getTargetRound(event) {
  const headline = (event.notes?.[0]?.headline || "").toLowerCase();
  const name = (event.name || "").toLowerCase();
  const fullText = headline + " " + name;

  if (fullText.includes('first four') || fullText.includes('play-in')) return 'Play-In';
  if (fullText.includes('first round') || fullText.includes('round of 64')) return 'Round of 64';
  if (fullText.includes('second round') || fullText.includes('round of 32')) return 'Round of 32';
  if (fullText.includes('sweet 16') || fullText.includes('sweet sixteen')) return 'Sweet Sixteen';
  if (fullText.includes('elite 8') || fullText.includes('elite eight')) return 'Elite Eight';
  if (fullText.includes('final four')) return 'Final Four';
  if (fullText.includes('championship')) return 'Championship';

  // Fallback: Adjust UTC date to US Eastern Time (-5 hours) to handle late night games
  const date = new Date(event.date);
  date.setHours(date.getHours() - 5); 
  const localDateStr = date.toISOString().slice(0, 10);
  
  return TOURNAMENT_CALENDAR[localDateStr] || null;
}

export async function syncTournamentScores(onProgress) {
  // Only sync dates that have actually occurred
  const todayISO = new Date().toISOString().slice(0, 10);
  const activeDates = Object.keys(TOURNAMENT_CALENDAR)
    .filter(date => date <= todayISO)
    .map(date => date.replace(/-/g, ''));

  const allStats = {}; // { "Player Name": { "Round": points } }
  const processedGameIds = new Set();

  onProgress?.(`Starting score sync for ${activeDates.length} tournament days...`);

  for (const dateStr of activeDates) {
    // Group 100 ensures we only get NCAA Tournament games
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=100&limit=100`;
    
    try {
      const res = await fetch(url);
      const { events = [] } = await res.json();

      for (const event of events) {
        if (processedGameIds.has(event.id)) continue;

        const roundName = getTargetRound(event);
        if (!roundName) continue; 
        
        processedGameIds.add(event.id);

        // Fetch the summary for the individual player boxscore
        const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${event.id}`;
        const sumRes = await fetch(summaryUrl);
        const summary = await sumRes.json();

        summary.boxscore?.players?.forEach(teamData => {
          teamData.statistics?.forEach(statGroup => {
            const ptsIdx = (statGroup.names || []).indexOf('PTS');
            if (ptsIdx === -1) return;

            statGroup.athletes?.forEach(ath => {
              const pts = parseInt(ath.stats?.[ptsIdx]);
              const playerName = ath.athlete?.displayName;

              if (playerName && !isNaN(pts) && pts > 0) {
                if (!allStats[playerName]) allStats[playerName] = {};
                // Sum points for the specific round (handles rare edge cases)
                allStats[playerName][roundName] = (allStats[playerName][roundName] || 0) + pts;
              }
            });
          });
        });
      }
    } catch (err) {
      console.error(`Error fetching date ${dateStr}:`, err);
    }
  }

  // --- Update Database ---
  const { data: drafted } = await supabase.from('players').select('id, name').not('drafter_id', 'is', null);
  if (!drafted) return { matched: [], unmatched: [] };

  let totalUpserts = 0;
  for (const p of drafted) {
    const rounds = allStats[p.name];
    if (rounds) {
      for (const [roundName, points] of Object.entries(rounds)) {
        await supabase.from('player_scores').upsert({
          player_id: p.id,
          round_name: roundName,
          points: points,
          updated_at: new Date().toISOString()
        }, { onConflict: 'player_id,round_name' });
        totalUpserts++;
      }
    }
  }

  onProgress?.(`✓ Score Sync Complete. Updated ${totalUpserts} entries.`);
  return { matched: [], unmatched: [] };
}