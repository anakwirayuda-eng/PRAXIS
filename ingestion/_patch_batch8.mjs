import fs from 'fs';

const DB_PATH = 'D:/Dev/MedCase/public/data/compiled_cases.json';
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

// Patches: fix panel_votes distributions, answer keys, and rationales for batch 8
const patches = {
  'sct_gen_9e3f1a2b': {
    // Glaukoma, IOP 24 mmHg → +1 is reasonable (borderline elevated), but diversify votes
    options: [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 1, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 2, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 8, "is_correct": true },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 4, "is_correct": false }
    ],
    rationale: "IOP 24 mmHg termasuk <b>borderline elevated</b> (normal <21 mmHg). Nilai ini <b>mendukung (+1)</b> kecurigaan glaukoma namun belum definitif karena: (1) IOP bukan satu-satunya kriteria — perlu evaluasi diskus optikus dan lapang pandang, (2) beberapa individu memiliki ocular hypertension tanpa glaukoma, (3) glaukoma normo-tension bisa terjadi tanpa peningkatan IOP. Sesuai guideline AAO Preferred Practice Pattern untuk Glaukoma."
  },
  'sct_gen_10f7b8c9': {
    // Laringitis, laringoskopi pembengkakan pita suara → +1 OK, but penebalan bisa juga nodul/polip
    options: [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 1, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 3, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 9, "is_correct": true },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 2, "is_correct": false }
    ],
    rationale: "Pembengkakan pita suara pada laringoskopi <b>mendukung (+1)</b> diagnosis laringitis namun tidak spesifik. Penebalan pita suara juga ditemukan pada <b>nodul vokal, polip, atau Reinke's edema</b> yang merupakan diagnosis banding penting pada suara serak >2 minggu. Perlu biopsi jika dicurigai keganasan laring, terutama pada perokok (guideline AAO-HNS). Durasi >2 minggu sebenarnya melebihi batas laringitis akut viral (biasanya <7-10 hari)."
  },
  'sct_gen_11c8a3d6': {
    // Alergi kontak, vesikel pada area terpapar → +1 OK, diversify votes
    options: [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 1, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 2, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 8, "is_correct": true },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 4, "is_correct": false }
    ],
    rationale: "Vesikel dan eritema yang terlokalisir pada area kontak bahan tertentu <b>mendukung (+1)</b> dermatitis kontak alergi (DKA tipe IV). Namun, konfirmasi definitif membutuhkan <b>patch test</b> untuk identifikasi alergen spesifik. Perlu dibedakan dengan dermatitis kontak iritan (DKI) yang secara klinis mirip tetapi mekanismenya non-imunologis. Distribusi lesi yang sesuai pola paparan (<i>geometric pattern</i>) merupakan clue diagnostik khas (Fitzpatrick's Dermatology)."
  },
  'sct_gen_12e9b7c4': {
    // Kultur Strep pyogenes POSITIF → ini GOLD STANDARD, harus +2!
    options: [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 0, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 3, "is_correct": false },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 12, "is_correct": true }
    ],
    rationale: "Kultur tenggorokan positif untuk <b>Streptococcus pyogenes</b> (Group A Streptococcus/GAS) merupakan <b>gold standard</b> diagnosis faringitis streptokokus dengan sensitivitas 90-95%. Temuan ini <b>sangat mendukung (+2)</b> diagnosis dan secara definitif mengindikasikan terapi antibiotik (Penisilin V atau Amoksisilin) untuk mencegah komplikasi demam rematik akut dan glomerulonefritis pasca-streptokokus. Sesuai guideline IDSA untuk faringitis GAS pada anak (Nelson Textbook of Pediatrics)."
  },
  'sct_gen_13d9a2f1': {
    // IKM TB, kurangnya pengetahuan → +1 OK tapi rationale perlu diperkuat
    options: [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 1, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 2, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 8, "is_correct": true },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 4, "is_correct": false }
    ],
    rationale: "Rendahnya pengetahuan masyarakat dan kepatuhan berobat <b>mendukung (+1)</b> identifikasi masalah kesehatan masyarakat terkait TB. Namun, ini bukan satu-satunya determinan. Sesuai kerangka WHO End TB Strategy, <b>faktor multidimensi</b> berperan: akses ke layanan kesehatan, stigma sosial, kualitas tenaga kesehatan, dan ketersediaan obat. Survei KAP (Knowledge, Attitude, Practice) saja belum cukup untuk menyimpulkan akar masalah tanpa analisis epidemiologis komprehensif dan evaluasi sistem DOTS di tingkat puskesmas."
  }
};

let patched = 0;
for (const q of db) {
  const id = q._id || q.id;
  if (patches[id]) {
    q.options = patches[id].options;
    q.rationale = patches[id].rationale;
    delete q._qualityFlag;
    patched++;
  }
}

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log('Patched ' + patched + ' SCT cases with improved panel_votes, answer keys, and rationales.');
