import Database from 'better-sqlite3';
const db = new Database('server/data/casebank.db');

// Accurate T9-v2 stats by parsing meta_json
const cases = db.prepare("SELECT meta_json FROM cases WHERE source = 'medmcqa'").all();

let t9_v2_done = 0;
let ai_agrees = 0;
let ai_conflict = 0;
let pending = 0;

for (const row of cases) {
  const meta = JSON.parse(row.meta_json || '{}');
  const is_v2 = meta._openclaw_t9_v2 === true;
  
  if (is_v2) {
    t9_v2_done++;
    if (meta.clinical_consensus === 'AI_AGREES_WITH_BASELINE') {
      ai_agrees++;
    } else if (meta.status === 'QUARANTINED_AI_CONFLICT') {
      ai_conflict++;
    }
  } else {
    // Only count as pending if not already quarantined by other means (Radar, etc.)
    if (!meta.status?.startsWith('QUARANTINED')) {
      pending++;
    }
  }
}

console.log(JSON.stringify({ 
  t9_v2_done, 
  ai_agrees, 
  ai_conflict, 
  pending 
}));

db.close();
