import Database from 'better-sqlite3';
const db = new Database('server/data/casebank.db');

// Get 5 most recent AI_CONFLICT cases
const conflicts = db.prepare(`
  SELECT c.case_id, c.prompt, c.meta_json
  FROM cases c
  WHERE c.meta_status = 'QUARANTINED_AI_CONFLICT'
  ORDER BY c.case_id DESC
  LIMIT 5
`).all();

for (const row of conflicts) {
  const meta = JSON.parse(row.meta_json);
  const opts = db.prepare('SELECT option_id, option_text, is_correct FROM case_options WHERE case_id = ? ORDER BY sort_order').all(row.case_id);
  const dbAnswer = opts.find(o => o.is_correct)?.option_text || '???';
  console.log(`---`);
  console.log(`ID: ${row.case_id}`);
  console.log(`Prompt: ${(row.prompt || '').substring(0, 100)}`);
  console.log(`DB Answer: ${dbAnswer}`);
  console.log(`AI Answer: ${meta.ai_suggested_answer || '???'}`);
  console.log(`AI Reason: ${meta.ai_reasoning || '???'}`);
}
db.close();
