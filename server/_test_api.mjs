// Quick API test
const adminKey = process.env.ADMIN_KEY || '';

const tests = [
  { name: 'Health Check', fn: () => fetch('http://localhost:3001/api/health').then(r => r.json()) },
  { 
    name: 'POST Feedback', 
    fn: () => fetch('http://localhost:3001/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: '12345', tags: ['wrong_answer', 'unclear'], comment: 'Test feedback from CLI' }),
    }).then(r => r.json())
  },
  { name: 'GET Feedback', fn: () => fetch('http://localhost:3001/api/feedback').then(r => r.json()) },
  { name: 'GET Stats', fn: () => fetch('http://localhost:3001/api/feedback/stats').then(r => r.json()) },
  { 
    name: 'Admin Overview', 
    fn: () => fetch('http://localhost:3001/api/admin/overview', {
      headers: adminKey ? { 'X-Admin-Key': adminKey } : {},
    }).then(r => r.json())
  },
  { 
    name: 'Admin Unauth', 
    fn: () => fetch('http://localhost:3001/api/admin/overview').then(r => ({ status: r.status, ok: r.ok }))
  },
];

for (const t of tests) {
  try {
    const result = await t.fn();
    console.log(`✅ ${t.name}:`, JSON.stringify(result).slice(0, 200));
  } catch (e) {
    console.log(`❌ ${t.name}:`, e.message);
  }
}
