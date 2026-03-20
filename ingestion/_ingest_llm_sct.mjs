import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Batch 9 — ChatGPT 5.4 Extended Pro — IKM/Healthcare Management
// Pre-improved: diversified panel_votes, enriched rationales, adjusted answer keys where needed
const NEW_CASES = [
  {
    "id": "sct_gen_1a7c2f4d",
    "q_type": "SCT",
    "category": "IKM",
    "vignette": "Di sebuah rumah sakit daerah, terdapat banyak keluhan dari pasien mengenai waktu tunggu yang lama untuk mendapatkan layanan medis. Banyak pasien yang merasa frustrasi dan tidak puas dengan pelayanan yang diberikan.",
    "prompt": "Jika Anda memikirkan 'Keterlambatan dalam Layanan Kesehatan' dan kemudian Anda menemukan 'Evaluasi menunjukkan kekurangan dalam manajemen antrian dan jadwal dokter yang padat', maka masalah keterlambatan dalam layanan kesehatan menjadi:",
    "options": [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 1, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 5, "is_correct": false },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 9, "is_correct": true }
    ],
    "rationale": "Kekurangan manajemen antrian dan jadwal dokter padat merupakan <b>root cause</b> langsung dari waktu tunggu pasien. Temuan ini <b>sangat mendukung (+2)</b> identifikasi masalah keterlambatan karena secara langsung menjelaskan keluhan pasien. Dalam kerangka <b>Lean Healthcare</b> dan standar akreditasi rumah sakit (SNARS), bottleneck pada antrian dan scheduling merupakan indikator utama inefisiensi proses pelayanan yang harus segera diperbaiki."
  },
  {
    "id": "sct_gen_2d8b6a9f",
    "q_type": "SCT",
    "category": "IKM",
    "vignette": "Sebuah klinik kesehatan komunitas di sebuah daerah terpencil menghadapi kekurangan tenaga medis dan fasilitas yang terbatas. Masyarakat setempat seringkali kesulitan untuk mengakses layanan kesehatan yang berkualitas.",
    "prompt": "Jika Anda memikirkan 'Kesenjangan Akses Layanan Kesehatan' dan kemudian Anda menemukan 'Survei menunjukkan bahwa 40% masyarakat tidak mengetahui jadwal pelayanan dan lokasi fasilitas kesehatan terdekat', maka kesenjangan akses layanan kesehatan menjadi:",
    "options": [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 1, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 2, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 8, "is_correct": true },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 4, "is_correct": false }
    ],
    "rationale": "Ketidaktahuan 40% masyarakat tentang jadwal dan lokasi faskes <b>mendukung (+1)</b> identifikasi kesenjangan akses, namun ini adalah <b>information barrier</b> yang merupakan salah satu dari beberapa dimensi akses (Penchansky & Thomas model). Faktor lain seperti <b>geographic barrier</b> (jarak), <b>affordability</b> (biaya), dan <b>availability</b> (ketersediaan tenaga medis) juga harus dievaluasi sebelum menyimpulkan akar masalah secara komprehensif."
  },
  {
    "id": "sct_gen_3c5d7e1a",
    "q_type": "SCT",
    "category": "IKM",
    "vignette": "Di sebuah rumah sakit besar, banyak pasien yang mengeluh tentang kualitas layanan di ruang gawat darurat (UGD), terutama terkait dengan respons tim medis yang lambat dan fasilitas yang kurang memadai.",
    "prompt": "Jika Anda memikirkan 'Kualitas Layanan Gawat Darurat' dan kemudian Anda menemukan 'Audit menunjukkan bahwa peralatan medis yang rusak dan kurangnya pelatihan staf mengenai prosedur gawat darurat', maka kualitas layanan gawat darurat menjadi:",
    "options": [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 1, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 4, "is_correct": false },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 10, "is_correct": true }
    ],
    "rationale": "Peralatan rusak dan kurangnya pelatihan staf merupakan <b>defisiensi struktural dan kompetensi</b> yang secara langsung menjelaskan lambatnya respons dan buruknya kualitas layanan UGD. Temuan ini <b>sangat mendukung (+2)</b> masalah kualitas karena menyentuh 2 dari 3 pilar Donabedian (structure dan process). Sesuai standar <b>SNARS dan JCI</b>, peralatan medis yang berfungsi dan pelatihan BLS/ACLS berkala merupakan syarat mutlak akreditasi UGD."
  },
  {
    "id": "sct_gen_4d7f5c2b",
    "q_type": "SCT",
    "category": "IKM",
    "vignette": "Dalam sebuah rumah sakit, keluhan pasien tentang prosedur administrasi yang rumit dan waktu tunggu yang lama dalam proses pendaftaran menjadi isu utama. Pasien sering kali merasa kesulitan saat harus memenuhi berbagai persyaratan administrasi sebelum mendapatkan perawatan medis.",
    "prompt": "Jika Anda memikirkan 'Proses Administrasi yang Tidak Efisien' dan kemudian Anda menemukan 'Hasil wawancara dengan staf administrasi menunjukkan kekurangan sistem informasi yang terintegrasi', maka proses administrasi yang tidak efisien menjadi:",
    "options": [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 1, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 3, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 8, "is_correct": true },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 3, "is_correct": false }
    ],
    "rationale": "Kekurangan Sistem Informasi RS (SIMRS) terintegrasi <b>mendukung (+1)</b> identifikasi inefisiensi administrasi. Namun, ini hanya satu faktor — diperlukan analisis lebih lanjut apakah masalahnya pada <b>desain workflow</b> (value stream mapping), <b>SDM</b> (beban kerja staf), atau <b>kebijakan birokrasi</b> RS. Implementasi SIMRS saja tidak menjamin efisiensi tanpa redesain proses bisnis secara holistik (Permenkes tentang Rekam Medis Elektronik)."
  },
  {
    "id": "sct_gen_5b8e2f1a",
    "q_type": "SCT",
    "category": "IKM",
    "vignette": "Di sebuah rumah sakit besar, pasien dengan penyakit kronis sering kali menghadapi tantangan dalam mendapatkan perawatan yang terkoordinasi antara berbagai spesialis. Hal ini menyebabkan beberapa pasien merasa tidak puas dengan pengelolaan perawatan mereka.",
    "prompt": "Jika Anda memikirkan 'Koordinasi Perawatan yang Buruk' dan kemudian Anda menemukan 'Hasil audit menunjukkan bahwa rujukan antara spesialis tidak selalu tercatat dalam sistem rekam medis elektronik', maka koordinasi perawatan yang buruk menjadi:",
    "options": [
      { "id": "-2", "text": "Sangat Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "-1", "text": "Menyingkirkan", "panel_votes": 0, "is_correct": false },
      { "id": "0", "text": "Tidak Berpengaruh", "panel_votes": 2, "is_correct": false },
      { "id": "+1", "text": "Mendukung", "panel_votes": 9, "is_correct": true },
      { "id": "+2", "text": "Sangat Mendukung", "panel_votes": 4, "is_correct": false }
    ],
    "rationale": "Rujukan yang tidak tercatat dalam RME <b>mendukung (+1)</b> masalah koordinasi karena menunjukkan kegagalan komunikasi antar-spesialis. Namun, pencatatan buruk bisa merupakan <b>gejala</b> bukan <b>akar masalah</b> — penyebab utama mungkin terletak pada tidak adanya <b>case manager</b>, kurangnya clinical pathway terintegrasi, atau resistensi staf terhadap digitalisasi. Model <b>Integrated Care</b> (WHO) menekankan perlunya koordinasi multidimensi, bukan hanya perbaikan teknologi."
  }
];

const DB_PATH = path.join(__dirname, '../public/data/compiled_cases.json');
console.log('Reading database...');
const rawData = fs.readFileSync(DB_PATH, 'utf-8');
const db = JSON.parse(rawData);

let added = 0;
const existMap = new Set(db.map(c => c._id || c.id));

for (let newCase of NEW_CASES) {
    if (!existMap.has(newCase.id)) {
        newCase._id = newCase.id;
        delete newCase.id;
        newCase.source = 'ai-generated-sct-batch9';
        newCase._llmSource = 'ChatGPT 5.4 Extended Pro';
        db.push(newCase);
        added++;
    }
}

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log('Successfully added ' + added + ' new SCT cases (pre-improved). DB size: ' + db.length);
