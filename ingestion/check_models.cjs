const fs = require('fs');
const API_KEY = fs.readFileSync('D:/Dev/MedCase/.env', 'utf-8').match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

fetch('https://api.openai.com/v1/models', {
  headers: { 'Authorization': `Bearer ${API_KEY}` }
})
.then(r => r.json())
.then(data => {
  const models = data.data
    .map(m => m.id)
    .filter(id => id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('o4'))
    .sort();
  console.log('Available GPT/Reasoning models:');
  models.forEach(m => console.log(`  ${m}`));
  console.log(`\nTotal: ${models.length} models`);
});
