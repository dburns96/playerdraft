import { supabase } from './supabase.js'

const TOURNAMENT_START_DATE = '20260317'; // Tuesday, March 17 (First Four)
const TOURNAMENT_DATES = ['20260317', '20260318', '20260319', '20260320', '20260321', '20260322']

async function autoEliminateLosers(completedEvents, onProgress) {
  const losingTeamIds = new Set();
  
  for (const event of completedEvents) {
    // 1. MUST be officially completed
    if (event.status?.type?.completed !== true) continue;
    
    // 2. MUST be within the NCAA Tournament dates (Blocks older conference losses)
    const eventDate = event.date.slice(0, 10).replace(/-/g, '');
    if (eventDate < TOURNAMENT_START_DATE) continue;

    const competitors = event.competitions?.[0]?.competitors || [];
    const team1 = competitors[0];
    const team2 = competitors[1];

    if (!team1 || !team2) continue;

    // 3. SCORE CHECK: Only eliminate if the game is Final and they lost
    const score1 = parseInt(team1.score || "0");
    const score2 = parseInt(team2.score || "0");

    if (score1 > 0 || score2 > 0) {
      if (team1.winner === false && score1 < score2) losingTeamIds.add(String(team1.team.id));
      if (team2.winner === false && score2 < score1) losingTeamIds.add(String(team2.team.id));
    }
  }

  if (losingTeamIds.size === 0) return;

  const { data: players } = await supabase.from('players').select('id, name, espn_team_id').eq('is_eliminated', false).not('espn_team_id', 'is', null);
  if (!players || players.length === 0) return;

  const toEliminate = players.filter(p => losingTeamIds.has(String(p.espn_team_id)));
  if (toEliminate.length === 0) return;

  await supabase.from('players').update({ is_eliminated: true }).in('id', toEliminate.map(p => p.id));
  onProgress?.(`✓ Confirmed Eliminations: ${toEliminate.map(p => p.name).join(', ')}`);
}

// ... rest of your syncTournamentScores function stays the same ...