from __future__ import annotations

import json
import sqlite3
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from ingestion.apply_medqa_image_detach_wave2 import (
        DB_FILE,
        JSON_FILE,
        compute_avg_option_length,
        load_case_rows,
        normalize_text,
        persist_sqlite,
        read_json,
        rebuild_answer_anchor_text,
        summarize_text,
        update_json_cases,
        with_quality_flag,
        write_json_atomic,
    )
except ModuleNotFoundError:
    sys.path.append(str(Path(__file__).resolve().parent.parent))
    from ingestion.apply_medqa_image_detach_wave2 import (
        DB_FILE,
        JSON_FILE,
        compute_avg_option_length,
        load_case_rows,
        normalize_text,
        persist_sqlite,
        read_json,
        rebuild_answer_anchor_text,
        summarize_text,
        update_json_cases,
        with_quality_flag,
        write_json_atomic,
    )


ROOT = Path(__file__).resolve().parent.parent
REPORT_FILE = ROOT / "ingestion" / "output" / "residual_readability_wave1_report.json"
BASIS = "deterministic:residual-readability-wave1"


FIXES: dict[int, dict[str, Any]] = {
    24353: {
        "prompt": "What is the most appropriate next step for a child with bruises, fractures, and retinal hemorrhages?",
        "narrative": "A 3-year-old boy has multiple healed fractures, bruising, blue-appearing irises, and fundoscopic retinal hemorrhages. The pattern is most concerning for nonaccidental trauma. What is the most appropriate next step in care?",
        "options": [
            {"id": "A", "text": "Genetic testing for a collagen synthesis disorder", "is_correct": False},
            {"id": "B", "text": "Call child protective services", "is_correct": True},
            {"id": "C", "text": "Hearing test", "is_correct": False},
            {"id": "D", "text": "Bone marrow transplant", "is_correct": False},
        ],
    },
    17958: {
        "prompt": "Which condition most likely caused restrictive cardiomyopathy with preserved EF and diastolic dysfunction?",
        "narrative": "A 49-year-old man has weakness, fatigue, marked peripheral edema, preserved ejection fraction, impaired diastolic relaxation, and echocardiographic findings consistent with an infiltrative/restrictive cardiomyopathy. Which condition is the most likely cause?",
        "options": [
            {"id": "A", "text": "Previous treatment with doxorubicin", "is_correct": False},
            {"id": "B", "text": "Hemochromatosis", "is_correct": True},
            {"id": "C", "text": "History of myocardial infarction", "is_correct": False},
            {"id": "D", "text": "History of a recent viral infection", "is_correct": False},
        ],
    },
    20723: {
        "prompt": "Which medication is associated with dilated cardiomyopathy like this patient's postinfectious presentation?",
        "narrative": "A 27-year-old woman has a recent respiratory infection, dyspnea, inspiratory crackles, an S3 gallop, and chest radiograph findings consistent with cardiomegaly from dilated cardiomyopathy. Which medication is associated with the same condition?",
        "options": [
            {"id": "A", "text": "Quinidine", "is_correct": False},
            {"id": "B", "text": "Anthracyclines", "is_correct": True},
            {"id": "C", "text": "Metoprolol", "is_correct": False},
            {"id": "D", "text": "Vincristine", "is_correct": False},
        ],
    },
    21079: {
        "prompt": "Which HLA variant is associated with ankylosing spondylitis?",
        "narrative": "A 32-year-old man has chronic inflammatory low back pain radiating to the buttocks, morning stiffness that improves with activity, sacroiliac tenderness, limited lumbar motion, and blurred vision suggestive of anterior uveitis. Which HLA variant is associated with this condition?",
        "options": [
            {"id": "A", "text": "HLA-DQ2", "is_correct": False},
            {"id": "B", "text": "HLA-B47", "is_correct": False},
            {"id": "C", "text": "HLA-B27", "is_correct": True},
            {"id": "D", "text": "HLA-DR3", "is_correct": False},
        ],
    },
    23612: {
        "prompt": "Which history fits mechanical hemolysis with schistocytes on peripheral smear?",
        "narrative": "A 62-year-old man has pallor and fatigue. Laboratory studies show normocytic anemia, low haptoglobin, increased reticulocytes, and a peripheral smear with schistocytes/helmet cells, consistent with mechanical intravascular hemolysis. Which patient characteristic best fits the cause?",
        "options": [
            {"id": "A", "text": "Aortic valve replacement", "is_correct": True},
            {"id": "B", "text": "Consumption of fava beans", "is_correct": False},
            {"id": "C", "text": "Infection of red blood cells", "is_correct": False},
            {"id": "D", "text": "Red urine in the morning", "is_correct": False},
        ],
    },
    25567: {
        "prompt": "Which condition predisposes to infective endocarditis with Janeway lesions?",
        "narrative": "A 64-year-old man has fever, night sweats, fatigue, orthopnea, a holosystolic murmur, and painless erythematous macules on the palms consistent with Janeway lesions. Which condition most likely predisposed him to infective endocarditis?",
        "options": [
            {"id": "A", "text": "Rheumatic heart disease", "is_correct": False},
            {"id": "B", "text": "Systemic lupus erythematosus", "is_correct": False},
            {"id": "C", "text": "Mitral valve prolapse", "is_correct": True},
            {"id": "D", "text": "Pulmonary stenosis", "is_correct": False},
        ],
    },
    17689: {
        "prompt": "Which cell type is used to produce recombinant insulin causing this patient's hypoglycemia?",
        "narrative": "A 30-year-old woman is found obtunded with glucose 22 mg/dL, undetectable C-peptide, and low beta-hydroxybutyrate, consistent with exogenous insulin exposure. Which description best matches a cell type commonly used to produce recombinant insulin?",
        "options": [
            {"id": "A", "text": "Gram-negative enteric bacillus; catalase-positive, oxidase-negative, turns pink on MacConkey agar", "is_correct": True},
            {"id": "B", "text": "Located in the periphery of islets of Langerhans", "is_correct": False},
            {"id": "C", "text": "Located in zona fasciculata of the adrenal cortex", "is_correct": False},
            {"id": "D", "text": "Gram-negative enteric bacillus; urease-positive, oxidase-positive, identified by silver stain", "is_correct": False},
        ],
    },
    22789: {
        "prompt": "Which urinalysis pattern is most likely after postrenal acute kidney injury from urinary retention?",
        "narrative": "A 75-year-old man has severe suprapubic pain, bladder distention, inability to urinate, and a 2-year history of progressive urinary difficulty consistent with acute urinary retention from obstruction. Which urinalysis pattern is most likely after postrenal acute kidney injury?",
        "options": [
            {"id": "A", "text": "Urine osmolality 400 mOsm/kg, urine Na+ 25 mEq/L, FENa 1.5%, no casts", "is_correct": False},
            {"id": "B", "text": "Urine osmolality 200 mOsm/kg, urine Na+ 35 mEq/L, FENa 3%, muddy brown casts", "is_correct": False},
            {"id": "C", "text": "Urine osmolality 550 mOsm/kg, urine Na+ 15 mEq/L, FENa 0.9%, red blood cell casts", "is_correct": False},
            {"id": "D", "text": "Urine osmolality 300 mOsm/kg, urine Na+ 45 mEq/L, FENa 5%, no casts", "is_correct": True},
        ],
    },
    26217: {
        "prompt": "What is the next step for torsades de pointes in a stable patient?",
        "narrative": "Two days after admission for Mycoplasma pneumoniae pneumonia, a 70-year-old man has palpitations and nausea. He is stable, with pulse 59/min and blood pressure 110/60 mmHg. ECG during symptoms shows polymorphic ventricular tachycardia consistent with torsades de pointes. What is the most appropriate next step?",
        "options": [
            {"id": "A", "text": "Administration of metoprolol", "is_correct": False},
            {"id": "B", "text": "Administration of magnesium sulfate", "is_correct": True},
            {"id": "C", "text": "Intermittent transvenous overdrive pacing", "is_correct": False},
            {"id": "D", "text": "Administration of potassium chloride", "is_correct": False},
        ],
    },
    27481: {
        "prompt": "Which drug should be added to valsartan for symptomatic heart failure with preserved EF?",
        "narrative": "A 64-year-old man has exertional dyspnea, paroxysmal nocturnal dyspnea, basal crackles, hepatomegaly, elevated BNP, enlarged left atrium, and ejection fraction 55%. Which drug is most likely to benefit him in addition to valsartan?",
        "options": [
            {"id": "A", "text": "Etanercept", "is_correct": False},
            {"id": "B", "text": "Moxonidine", "is_correct": False},
            {"id": "C", "text": "Sacubitril", "is_correct": True},
            {"id": "D", "text": "Aliskiren", "is_correct": False},
        ],
    },
    18281: {
        "prompt": "What is the next best step after CT-confirmed subarachnoid hemorrhage with elevated blood pressure?",
        "narrative": "A 32-year-old woman has sudden thunderclap headache, nausea, vomiting, neck stiffness, mild papilledema, blood pressure 165/95 mmHg, and noncontrast CT showing acute subarachnoid hemorrhage. Which option is the best next step from the choices provided?",
        "options": [
            {"id": "A", "text": "Mannitol", "is_correct": False},
            {"id": "B", "text": "Lumbar puncture", "is_correct": False},
            {"id": "C", "text": "Dexamethasone", "is_correct": False},
            {"id": "D", "text": "Labetalol", "is_correct": True},
        ],
    },
    25650: {
        "prompt": "Which cause best explains hypercalcemia with hyperphosphatemia and suppressed PTH?",
        "narrative": "A 33-year-old woman has constipation, abdominal pain, decreased appetite, dehydration, and recent over-the-counter supplement use. Serum studies show calcium 12.8 mg/dL, phosphorus 4.6 mg/dL, bicarbonate 22 mEq/L, albumin 4 g/dL, suppressed PTH, TSH 9 microU/mL, and low free T4. What is the most likely underlying cause of her symptoms?",
        "options": [
            {"id": "A", "text": "Primary hypothyroidism", "is_correct": False},
            {"id": "B", "text": "Primary hyperparathyroidism", "is_correct": False},
            {"id": "C", "text": "Excess calcium carbonate intake", "is_correct": False},
            {"id": "D", "text": "Vitamin D toxicity", "is_correct": True},
        ],
    },
    59576: {
        "prompt": "Apa diagnosis disfagia progresif pada pasien usia lanjut dengan penurunan berat badan?",
        "narrative": "Perempuan 51 tahun datang dengan nyeri ulu hati, sulit menelan yang makin memberat dari makanan padat hingga cair, dan penurunan berat badan. Pemeriksaan endoskopi menunjukkan massa esofagus yang mudah berdarah. Diagnosis yang paling mungkin adalah:",
        "options": [
            {"id": "A", "text": "Karsinoma esofagus", "is_correct": True},
            {"id": "B", "text": "Barrett esophagus", "is_correct": False},
            {"id": "C", "text": "GERD", "is_correct": False},
            {"id": "D", "text": "Akalasia", "is_correct": False},
            {"id": "E", "text": "Mallory-Weiss tear", "is_correct": False},
        ],
    },
    59626: {
        "prompt": "Apa diagnosis sulit membaca dekat pada usia 45 tahun dengan visus jauh 6/6?",
        "narrative": "Seorang wanita 45 tahun mengeluh sulit membaca dekat sejak 1 bulan. Pemeriksaan visus jauh menunjukkan 6/6 pada kedua mata. Keluhan membaik dengan lensa baca positif. Diagnosis yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Presbiopia", "is_correct": True},
            {"id": "B", "text": "Ambliopia", "is_correct": False},
            {"id": "C", "text": "Astigmatisme", "is_correct": False},
            {"id": "D", "text": "Anisometropia", "is_correct": False},
            {"id": "E", "text": "Miopia", "is_correct": False},
        ],
    },
    59628: {
        "prompt": "Apa diagnosis plak gatal polisiklik dengan tepi aktif pada perut?",
        "narrative": "Seorang laki-laki 34 tahun datang dengan gatal pada perut sejak 5 hari. Pemeriksaan menunjukkan plak eritematosa polisiklik dengan skuama dan tepi lesi lebih aktif dibanding bagian tengah. Diagnosis yang paling mungkin adalah:",
        "options": [
            {"id": "A", "text": "Tinea corporis", "is_correct": True},
            {"id": "B", "text": "Dermatitis atopik", "is_correct": False},
            {"id": "C", "text": "Dermatitis seboroik", "is_correct": False},
            {"id": "D", "text": "Psoriasis vulgaris", "is_correct": False},
            {"id": "E", "text": "Eritema multiforme", "is_correct": False},
        ],
    },
    59649: {
        "prompt": "Apa interpretasi serologi hepatitis dengan anti-HAV total positif dan hepatitis B kronik?",
        "narrative": "Pasien 25 tahun diperiksa serologi hepatitis. Hasil menunjukkan anti-HAV total positif, HBsAg positif, anti-HBc total positif, IgM anti-HBc negatif, dan anti-HBs negatif. Interpretasi yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Pernah terinfeksi hepatitis A dan sedang mengalami hepatitis B kronik", "is_correct": True},
            {"id": "B", "text": "Pernah terinfeksi hepatitis A dan sedang mengalami hepatitis B akut", "is_correct": False},
            {"id": "C", "text": "Pernah terinfeksi hepatitis A dan baru divaksin hepatitis B", "is_correct": False},
            {"id": "D", "text": "Sedang terinfeksi hepatitis B akut tanpa riwayat hepatitis A", "is_correct": False},
            {"id": "E", "text": "Pernah terinfeksi hepatitis A dan sudah sembuh dari hepatitis B", "is_correct": False},
        ],
    },
    59751: {
        "prompt": "Apa terapi keputihan berbau amis dengan sekret tipis keabu-abuan?",
        "narrative": "Seorang wanita 27 tahun datang dengan keputihan dan gatal ringan. Cairan vagina tampak tipis putih keabu-abuan, berbau amis, dan dinding vagina tampak eritem ringan. Gambaran ini paling sesuai dengan vaginosis bakterialis. Terapi yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Metronidazol", "is_correct": True},
            {"id": "B", "text": "Kloramfenikol", "is_correct": False},
            {"id": "C", "text": "Ciprofloxacin", "is_correct": False},
            {"id": "D", "text": "Mikonazol", "is_correct": False},
            {"id": "E", "text": "Gameksan", "is_correct": False},
        ],
    },
    59417: {
        "prompt": "Apa kesimpulan forensik pada bayi lahir hidup dengan tanda asfiksia dan trauma?",
        "narrative": "Jenazah bayi laki-laki berat 800 gram dan panjang 46 cm ditemukan dengan plasenta masih melekat. Pada pemeriksaan terdapat lanugo, kuku melebihi ujung jari, memar pada bibir dan wajah, ujung kuku kebiruan, serta paru menutupi rongga dada, teraba spons, dan mengkilap seperti marmer. Temuan ini menunjukkan bayi pernah bernapas dan mengalami kekerasan/asfiksia setelah lahir. Kesimpulan forensik yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Mati wajar", "is_correct": False},
            {"id": "B", "text": "Abortus", "is_correct": False},
            {"id": "C", "text": "Penelantaran tanpa tanda kekerasan", "is_correct": False},
            {"id": "D", "text": "Infantisida", "is_correct": True},
            {"id": "E", "text": "Stillbirth", "is_correct": False},
        ],
    },
    59411: {
        "prompt": "Apa ciri luka babras yang terjadi sebelum korban meninggal?",
        "narrative": "Korban laki-laki meninggal dan ditemukan luka babras yang diperkirakan sudah terjadi sebelum kematian. Ciri yang mendukung luka ante-mortem adalah:",
        "options": [
            {"id": "A", "text": "Dasar luka berwarna merah kehitaman dengan tanda perdarahan/vital reaction", "is_correct": True},
            {"id": "B", "text": "Dasar luka pucat tanpa perdarahan", "is_correct": False},
            {"id": "C", "text": "Luka terbuka bertepi rata seperti sayatan", "is_correct": False},
            {"id": "D", "text": "Tidak ada tanda reaksi jaringan sama sekali", "is_correct": False},
            {"id": "E", "text": "Luka terbuka bertepi tidak rata", "is_correct": False},
        ],
    },
    59439: {
        "prompt": "Apa diagnosis perdarahan sedikit pada kehamilan muda dengan serviks masih tertutup?",
        "narrative": "Perempuan hamil 12 minggu datang dengan perdarahan sedikit dari jalan lahir. Pemeriksaan menunjukkan serviks masih tertutup dan tidak ada jaringan konsepsi keluar. Diagnosis yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Abortus imminens", "is_correct": True},
            {"id": "B", "text": "Abortus komplit", "is_correct": False},
            {"id": "C", "text": "Abortus inkomplit", "is_correct": False},
            {"id": "D", "text": "Abortus septik", "is_correct": False},
            {"id": "E", "text": "Abortus insipiens", "is_correct": False},
        ],
    },
    59539: {
        "prompt": "Apa diagnosis neonatus sulit BAB dengan feses menyemprot setelah rectal toucher?",
        "narrative": "Bayi usia 7 hari dibawa karena sulit buang air besar. Setelah pemeriksaan rectal toucher, feses keluar menyemprot. Diagnosis yang paling mungkin adalah:",
        "options": [
            {"id": "A", "text": "Tumor abdomen", "is_correct": False},
            {"id": "B", "text": "Megakolon kongenital/Hirschsprung disease", "is_correct": True},
            {"id": "C", "text": "Invaginasi", "is_correct": False},
            {"id": "D", "text": "Volvulus", "is_correct": False},
        ],
    },
    59389: {
        "prompt": "Apa diagnosis takut jarum suntik yang mengganggu fungsi akademik?",
        "narrative": "Seorang mahasiswi keperawatan 21 tahun sangat takut terhadap jarum suntik. Ketakutan tersebut membuat prestasi belajarnya menurun dan ia ingin berhenti kuliah. Diagnosis yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Fobia spesifik", "is_correct": True},
            {"id": "B", "text": "Gangguan panik", "is_correct": False},
            {"id": "C", "text": "Gangguan cemas menyeluruh", "is_correct": False},
            {"id": "D", "text": "Gangguan obsesif-kompulsif", "is_correct": False},
            {"id": "E", "text": "Gangguan waham", "is_correct": False},
        ],
    },
    59487: {
        "prompt": "Pemeriksaan apa untuk nyeri ibu jari akibat gerakan repetitif yang dicurigai de Quervain?",
        "narrative": "Pasien laki-laki 28 tahun mengeluh nyeri pada ibu jari kanan terutama saat digerakkan. Ia bekerja dengan gerakan repetitif di bagian assembling, dan hasil laboratorium dalam batas normal. Pemeriksaan provokatif untuk menegakkan de Quervain tenosynovitis adalah:",
        "options": [
            {"id": "A", "text": "Tes Finkelstein", "is_correct": True},
            {"id": "B", "text": "Tes FABER", "is_correct": False},
            {"id": "C", "text": "Tes Lasegue", "is_correct": False},
            {"id": "D", "text": "Tes Patrick", "is_correct": False},
            {"id": "E", "text": "Tes McMurray", "is_correct": False},
        ],
    },
    59489: {
        "prompt": "Apa diagnosis kelemahan ekstremitas progresif dengan refleks menurun dan gangguan otonom?",
        "narrative": "Seorang wanita 35 tahun mengalami nyeri punggung bawah, kelemahan kedua tungkai progresif, parestesia, kesulitan BAB/BAK, dan refleks fisiologis menurun. Gambaran kelemahan progresif dengan hiporefleksia paling sesuai dengan:",
        "options": [
            {"id": "A", "text": "Amyotrophic lateral sclerosis", "is_correct": False},
            {"id": "B", "text": "Protrusi diskus intervertebralis", "is_correct": False},
            {"id": "C", "text": "Kompresi medula spinalis", "is_correct": False},
            {"id": "D", "text": "Guillain-Barre syndrome", "is_correct": True},
            {"id": "E", "text": "Sindrom cauda equina", "is_correct": False},
        ],
    },
    965026: {
        "prompt": "Apa diagnosis luka kelopak mata kronik dengan keratin pearls pada histologi?",
        "narrative": "Perempuan 60 tahun bekerja sebagai juru parkir selama 30 tahun dan memiliki luka pada kelopak mata kiri bawah sejak 4 bulan yang makin membesar. Pemeriksaan histologi menunjukkan keratin pearls. Diagnosis yang paling sesuai adalah:",
        "options": [
            {"id": "A", "text": "Karsinoma sel basal", "is_correct": False},
            {"id": "B", "text": "Karsinoma sel skuamosa", "is_correct": True},
            {"id": "C", "text": "Melanoma maligna", "is_correct": False},
            {"id": "D", "text": "Nevus pigmentosus", "is_correct": False},
            {"id": "E", "text": "Veruka vulgaris", "is_correct": False},
        ],
    },
    965037: {
        "prompt": "Apa diagnosis kebotakan frontal berbentuk huruf M dengan riwayat keluarga?",
        "narrative": "Pria 25 tahun datang dengan rambut rontok sejak 3 bulan. Ia stres, dan ayahnya memiliki riwayat keluhan serupa. Pemeriksaan menunjukkan area botak pada regio frontal berbentuk huruf M. Diagnosis yang paling sesuai adalah:",
        "options": [
            {"id": "A", "text": "Alopecia areata", "is_correct": False},
            {"id": "B", "text": "Alopecia androgenik", "is_correct": True},
            {"id": "C", "text": "Telogen effluvium", "is_correct": False},
            {"id": "D", "text": "Anagen effluvium", "is_correct": False},
            {"id": "E", "text": "Trikotilomania", "is_correct": False},
        ],
    },
    965069: {
        "prompt": "Apa diagnosis demam rematik akut dengan murmur apeks dan eritema marginatum?",
        "narrative": "Anak 15 tahun datang dengan sesak, demam hilang timbul sejak 1 bulan, nyeri tenggorok, nyeri lutut, murmur sistolik di apeks, ASTO meningkat, CRP meningkat, dan lesi kulit annular sesuai eritema marginatum. Diagnosis yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Perikarditis", "is_correct": False},
            {"id": "B", "text": "Sindrom koroner akut", "is_correct": False},
            {"id": "C", "text": "Demam rematik akut", "is_correct": True},
            {"id": "D", "text": "Kardiomiopati", "is_correct": False},
            {"id": "E", "text": "Endokarditis infektif", "is_correct": False},
        ],
    },
    965080: {
        "prompt": "Prinsip kedokteran keluarga apa saat dokter mengobati hipertensi sekaligus memberi edukasi gaya hidup?",
        "narrative": "Perempuan 38 tahun berobat karena hipertensi. Tekanan darah 145/88 mmHg. Dokter memberikan amlodipin dan memotivasi pasien minum obat rutin, beraktivitas fisik, mengatur pola makan, dan membatasi garam untuk mencegah keparahan hipertensi. Prinsip kedokteran keluarga yang diterapkan adalah:",
        "options": [
            {"id": "A", "text": "Komprehensif", "is_correct": True},
            {"id": "B", "text": "Berkesinambungan/kontinu", "is_correct": False},
            {"id": "C", "text": "Koordinatif", "is_correct": False},
            {"id": "D", "text": "Kolaboratif", "is_correct": False},
            {"id": "E", "text": "Holistik saja tanpa terapi medis", "is_correct": False},
        ],
    },
    965076: {
        "prompt": "Berapa tambahan iuran BPJS PPU untuk dua anggota keluarga tambahan?",
        "narrative": "Tn. S adalah PNS dan sudah menanggung istri serta tiga anak. Ia ingin menambahkan dua anggota keluarga lain di rumah sebagai peserta tambahan BPJS Kesehatan. Pada peserta PPU, anggota keluarga tambahan dikenakan iuran 1% dari gaji/upah per orang per bulan. Berapa tambahan iuran yang dibayarkan setiap bulan?",
        "options": [
            {"id": "A", "text": "1%", "is_correct": False},
            {"id": "B", "text": "2%", "is_correct": True},
            {"id": "C", "text": "3%", "is_correct": False},
            {"id": "D", "text": "4%", "is_correct": False},
            {"id": "E", "text": "5%", "is_correct": False},
        ],
    },
    66576: {
        "prompt": "Apa diagnosis pasien HIV dengan lesi multiple ring-enhancement di CT kepala?",
        "narrative": "Tn. V, 35 tahun, dibawa ke IGD tidak sadar. Ia demam dan nyeri kepala sejak 5 hari, mengalami penurunan berat badan dan diare 3 bulan, serta memiliki needle track pada kedua regio kubiti. Pemeriksaan neurologis menunjukkan Babinski positif. CT kepala kontras menunjukkan multiple ring-enhancement lesions. Diagnosis yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Intoksikasi opiat", "is_correct": False},
            {"id": "B", "text": "Meningitis virus", "is_correct": False},
            {"id": "C", "text": "Abses otak bakterial", "is_correct": False},
            {"id": "D", "text": "Tuberkuloma otak", "is_correct": False},
            {"id": "E", "text": "Toksoplasmosis serebri", "is_correct": True},
        ],
    },
    66544: {
        "prompt": "Apa diagnosis anak dengan gatal kronik, riwayat atopi, xerosis, dan likenifikasi?",
        "narrative": "Anak 11 tahun dibawa karena gatal pada leher, pergelangan tangan, dan kaki yang hilang timbul sejak bayi. Pasien memiliki riwayat asma intermiten dan rinitis alergi, serta ibu memiliki asma. Pemeriksaan menunjukkan eritema, xerosis, ekskoriasi, dan plak likenifikasi pada leher dan ekstremitas. Diagnosis yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Dermatitis seboroik", "is_correct": False},
            {"id": "B", "text": "Dermatitis kontak iritan", "is_correct": False},
            {"id": "C", "text": "Dermatitis kontak alergi", "is_correct": False},
            {"id": "D", "text": "Dermatitis atopik kronik/rekalsitran", "is_correct": True},
            {"id": "E", "text": "Dermatitis venenata", "is_correct": False},
        ],
    },
    66546: {
        "prompt": "Apa diagnosis trauma mata akibat amonia dengan iskemia limbus kurang dari sepertiga?",
        "narrative": "Laki-laki 46 tahun datang 30 menit setelah mata terkena cairan amonia. Ia sudah membilas mata dengan air mengalir. Pemeriksaan menunjukkan VOD 6/6, VOS 6/20, blefarospasme, injeksi siliar, iskemia limbus kurang dari sepertiga, dan defek epitel kornea. Diagnosis yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Trauma basa grade I", "is_correct": False},
            {"id": "B", "text": "Trauma basa grade II", "is_correct": True},
            {"id": "C", "text": "Trauma asam grade I", "is_correct": False},
            {"id": "D", "text": "Trauma asam grade II", "is_correct": False},
            {"id": "E", "text": "Trauma panas", "is_correct": False},
        ],
    },
    66561: {
        "prompt": "Apa diagnosis pengasuh yang memalsukan gangguan anak agar mendapat perhatian?",
        "narrative": "Seorang pengasuh anak berusia 25 tahun mengaku anak asuhnya tidak bisa mendengar dan idiot agar anak tersebut mendapat perhatian lebih dibanding anak lain. Akibatnya, orang sekitar memperlakukan anak tersebut seperti anak tuna rungu dan memberi perlakuan khusus. Kelainan yang paling sesuai adalah:",
        "options": [
            {"id": "A", "text": "Malingering", "is_correct": False},
            {"id": "B", "text": "Gangguan konversi", "is_correct": False},
            {"id": "C", "text": "Factitious disorder pada diri sendiri", "is_correct": False},
            {"id": "D", "text": "Munchausen syndrome by proxy/factitious disorder imposed on another", "is_correct": True},
            {"id": "E", "text": "Gangguan disosiatif sensorik", "is_correct": False},
        ],
    },
    950201: {
        "prompt": "Apa diagnosis epistaksis berulang, massa hidung, limfadenopati leher, dan gangguan pendengaran?",
        "narrative": "Laki-laki 48 tahun datang dengan mimisan hilang timbul selama 3 bulan, rasa mengganjal di hidung kanan, bau busuk, pembesaran kelenjar leher kanan, massa di hidung kanan pada rinoskopi anterior, dan pendengaran menurun. Diagnosis yang paling mungkin adalah:",
        "options": [
            {"id": "A", "text": "Limfadenitis koli", "is_correct": False},
            {"id": "B", "text": "Sinusitis maksilaris", "is_correct": False},
            {"id": "C", "text": "Polip nasofaring", "is_correct": False},
            {"id": "D", "text": "Angiofibroma nasofaring", "is_correct": False},
            {"id": "E", "text": "Karsinoma nasofaring", "is_correct": True},
        ],
    },
    950207: {
        "prompt": "Apa pelanggaran etik bila dokter perusahaan membuka hasil pemeriksaan karyawan tanpa izin?",
        "narrative": "Seorang dokter melakukan pemeriksaan kesehatan pada karyawan perusahaan. Hasil pemeriksaan seorang karyawan kemudian disampaikan kepada pihak perusahaan tanpa persetujuan pasien. Penilaian etik yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Salah karena tidak meminta persetujuan pasien untuk pemeriksaan awal", "is_correct": False},
            {"id": "B", "text": "Salah karena memberitahukan rahasia pasien", "is_correct": True},
            {"id": "C", "text": "Benar karena semua penyakit mengancam jiwa", "is_correct": False},
            {"id": "D", "text": "Benar karena mengikuti aturan dokter perusahaan", "is_correct": False},
            {"id": "E", "text": "Salah hanya karena melanggar autonomi pasien, bukan kerahasiaan", "is_correct": False},
        ],
    },
    950217: {
        "prompt": "Apa tujuan KB pada wanita 39 tahun yang sudah memiliki tiga anak?",
        "narrative": "Ny. Cefat, 39 tahun, datang bersama suaminya untuk konseling KB. Pasien sudah mempunyai tiga anak, tidak ada riwayat penyakit bermakna, dan pemeriksaan fisik normal. Tujuan KB yang paling sesuai pada kondisi pasien ini adalah:",
        "options": [
            {"id": "A", "text": "Menjarangkan kehamilan", "is_correct": False},
            {"id": "B", "text": "Menunda kehamilan pertama", "is_correct": False},
            {"id": "C", "text": "Mencegah kehamilan", "is_correct": True},
            {"id": "D", "text": "Mengakhiri kesuburan tanpa konseling pilihan metode", "is_correct": False},
            {"id": "E", "text": "Mencegah infeksi menular seksual", "is_correct": False},
        ],
    },
    66252: {
        "prompt": "Manakah yang bukan bagian dari triad Whipple?",
        "narrative": "Triad Whipple digunakan untuk menilai hipoglikemia klinis. Komponennya meliputi gejala hipoglikemia, kadar glukosa plasma rendah saat gejala, dan perbaikan gejala setelah pemberian glukosa. Manakah yang bukan bagian dari triad Whipple?",
        "options": [
            {"id": "A", "text": "Gejala hipoglikemia saat puasa atau aktivitas", "is_correct": False},
            {"id": "B", "text": "Kadar glukosa serum rendah saat gejala", "is_correct": False},
            {"id": "C", "text": "Hiperinsulinemia", "is_correct": True},
            {"id": "D", "text": "Perbaikan gejala setelah pemberian glukosa", "is_correct": False},
            {"id": "E", "text": "Semua di atas merupakan bagian triad", "is_correct": False},
        ],
    },
    65379: {
        "prompt": "Organisme bakteremia apa yang memerlukan kombinasi penisilin dan aminoglikosida?",
        "narrative": "Pada bakteremia tertentu, terapi sinergis dengan beta-laktam seperti penisilin/ampisilin dan aminoglikosida dapat diperlukan, terutama pada infeksi enterokokus serius. Organisme yang paling sesuai adalah:",
        "options": [
            {"id": "A", "text": "Enterococcus faecalis", "is_correct": True},
            {"id": "B", "text": "Staphylococcus aureus", "is_correct": False},
            {"id": "C", "text": "Streptococcus pneumoniae", "is_correct": False},
            {"id": "D", "text": "Bacteroides fragilis", "is_correct": False},
            {"id": "E", "text": "Semua di atas", "is_correct": False},
        ],
    },
    65084: {
        "prompt": "Struktur mana yang termasuk ganglia basal?",
        "narrative": "Ganglia basal mencakup struktur seperti nukleus kaudatus, putamen, dan globus pallidus. Struktur mana yang termasuk ganglia basal?",
        "options": [
            {"id": "A", "text": "Nukleus kaudatus", "is_correct": True},
            {"id": "B", "text": "Thalamus", "is_correct": False},
            {"id": "C", "text": "Epifisis", "is_correct": False},
            {"id": "D", "text": "Semua di atas", "is_correct": False},
            {"id": "E", "text": "Tidak ada yang di atas", "is_correct": False},
        ],
    },
    66643: {
        "prompt": "Imunisasi apa yang mencegah difteri dengan pseudomembran faring dan bull neck?",
        "narrative": "Anak 7 tahun demam, sulit makan, plak keputihan menutupi tonsil dan faring yang melekat erat dan mudah berdarah, serta bengkak pada leher. Gambaran ini sesuai difteri. Imunisasi yang dapat mencegah penyakit tersebut adalah:",
        "options": [
            {"id": "A", "text": "BCG", "is_correct": False},
            {"id": "B", "text": "MR", "is_correct": False},
            {"id": "C", "text": "DPT", "is_correct": True},
            {"id": "D", "text": "TT saja", "is_correct": False},
            {"id": "E", "text": "Hepatitis B", "is_correct": False},
        ],
    },
    66642: {
        "prompt": "Apa diagnosis vena retina berkelok dan perdarahan flame-shaped pada satu kuadran?",
        "narrative": "Ny. Bianca, 67 tahun, dengan riwayat diabetes dan hipertensi datang karena penglihatan mata kiri tiba-tiba kabur. Funduskopi menunjukkan vena berkelok-kelok dan dilatasi disertai dot/blot hemorrhages serta flame-shaped hemorrhages pada kuadran superotemporal. Diagnosis yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Oklusi arteri sentralis retina", "is_correct": False},
            {"id": "B", "text": "Oklusi arteri cabang retina", "is_correct": False},
            {"id": "C", "text": "Oklusi vena sentralis retina", "is_correct": False},
            {"id": "D", "text": "Oklusi vena cabang retina", "is_correct": True},
            {"id": "E", "text": "Age-related macular degeneration", "is_correct": False},
        ],
    },
    66632: {
        "prompt": "Uji korelasi apa untuk dua variabel numerik berdistribusi normal?",
        "narrative": "Seorang peneliti ingin menilai korelasi antara dua variabel numerik. Kedua variabel berdistribusi normal. Uji statistik yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Paired t-test", "is_correct": False},
            {"id": "B", "text": "Spearman", "is_correct": False},
            {"id": "C", "text": "Pearson", "is_correct": True},
            {"id": "D", "text": "Chi-square", "is_correct": False},
            {"id": "E", "text": "Independent sample t-test", "is_correct": False},
        ],
    },
    66627: {
        "prompt": "Obat mana yang merupakan mood stabilizer?",
        "narrative": "Dalam terapi gangguan mood, beberapa obat digunakan sebagai mood stabilizer untuk episode mania atau profilaksis bipolar. Obat yang termasuk mood stabilizer adalah:",
        "options": [
            {"id": "A", "text": "Clozapine", "is_correct": False},
            {"id": "B", "text": "Diazepam", "is_correct": False},
            {"id": "C", "text": "Asam valproat", "is_correct": True},
            {"id": "D", "text": "Amitriptilin", "is_correct": False},
            {"id": "E", "text": "Alprazolam", "is_correct": False},
        ],
    },
    63020: {
        "prompt": "Pada SCT ini, apakah temuan class switching sel B mendukung hipotesis aktivasi makrofag?",
        "narrative": "Biopsi kelenjar getah bening menunjukkan area germinal center dengan banyak sel B. Hipotesis awal adalah proses imunologi yang terjadi berupa aktivasi makrofag. Informasi tambahan menunjukkan proporsi sel B yang sedang menjalani class switching, dengan IgM rendah dan IgG tinggi di kelenjar getah bening. Terhadap hipotesis aktivasi makrofag, temuan ini:",
        "options": [
            {"id": "-2", "text": "Sangat menyingkirkan", "is_correct": False},
            {"id": "-1", "text": "Menyingkirkan", "is_correct": True},
            {"id": "0", "text": "Tidak berpengaruh", "is_correct": False},
            {"id": "+1", "text": "Mendukung", "is_correct": False},
            {"id": "+2", "text": "Sangat mendukung", "is_correct": False},
        ],
    },
    64838: {
        "prompt": "Apa langkah awal pada ibu hamil 24 minggu dengan glikosuria dan glukosa puasa tinggi?",
        "narrative": "Wanita 26 tahun hamil pertama usia kehamilan 24 minggu datang kontrol. Urinalisis menunjukkan glukosa 2+ dan glukosa darah puasa 132 mg/dL. Tindakan awal yang paling tepat untuk menegakkan status gangguan glukosa pada kehamilan adalah:",
        "options": [
            {"id": "A", "text": "Pengumpulan urine selama 24 jam", "is_correct": False},
            {"id": "B", "text": "Memulai obat diabetes oral", "is_correct": False},
            {"id": "C", "text": "Mengukur variabilitas kadar glukosa darah harian saja", "is_correct": False},
            {"id": "D", "text": "Memulai terapi insulin intensif tanpa konfirmasi", "is_correct": False},
            {"id": "E", "text": "Melakukan uji toleransi glukosa oral 75 g", "is_correct": True},
        ],
    },
}


RETIRE: dict[int, str] = {
    59627: "Severe OCR corruption; genital lesion stem and diagnostic clues are not internally coherent.",
    59643: "Severe OCR corruption; thyrotoxicosis/chest-pain fragments cannot support a safe MCQ.",
    59657: "Severe OCR corruption; abdominal/urologic options are mismatched.",
    59663: "Severe OCR corruption; obstetric UTI stem is paired with unrelated diet options.",
    59688: "Severe OCR corruption; cardiopulmonary stem and answer options are clinically inconsistent.",
    59711: "Missing clinical vignette; only answer options remain.",
    59715: "Research/vaccine stem is mismatched with confidentiality options.",
    950209: "Source dump is paired with unrelated autopsy-technique options.",
    66640: "Statistics source dump lacks a recoverable question stem.",
    66629: "Lipoma/liposarcoma source dump lacks enough coherent stem context for safe correction.",
    66645: "Psychiatry case stem is missing; only partial explanation/options remain.",
}


def ensure_rationale_dict(case_data: dict[str, Any]) -> dict[str, Any]:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return deepcopy(rationale)
    return {"correct": normalize_text(rationale)}


def without_quality_flags(meta: dict[str, Any], remove: set[str]) -> None:
    flags = meta.get("quality_flags")
    if not isinstance(flags, list):
        return
    remaining = [flag for flag in flags if flag not in remove]
    if remaining:
        meta["quality_flags"] = remaining
    else:
        meta.pop("quality_flags", None)


def clear_review_meta(meta: dict[str, Any]) -> None:
    for key in (
        "status",
        "quarantine_reason",
        "needs_review_reason",
        "needs_review_reasons",
        "readability_ai_hold",
        "readability_ai_hold_at",
        "readability_ai_hold_basis",
        "readability_ai_hold_notes",
        "readability_integrity_hold",
        "radar_tokens",
    ):
        meta.pop(key, None)
    without_quality_flags(
        meta,
        {
            "readability_batch_salvage_hold",
            "image_dependency_detected",
            "missing_image_context",
            "source_contamination_detected",
            "truncated_false_positive_cleared",
        },
    )


def apply_fix(current: dict[str, Any], fix: dict[str, Any], timestamp: str) -> dict[str, Any]:
    updated = deepcopy(current)
    updated["prompt"] = normalize_text(fix["prompt"])
    updated["title"] = normalize_text(fix["prompt"])
    vignette = updated.get("vignette")
    if isinstance(vignette, dict):
        vignette["narrative"] = normalize_text(fix["narrative"])
    else:
        updated["vignette"] = {"narrative": normalize_text(fix["narrative"])}
    updated["options"] = deepcopy(fix["options"])
    if fix.get("rationale"):
        rationale = ensure_rationale_dict(updated)
        rationale["correct"] = normalize_text(fix["rationale"])
        updated["rationale"] = rationale

    meta = deepcopy(updated.get("meta") or {})
    meta["needs_review"] = False
    meta["truncated"] = False
    meta["quarantined"] = False
    clear_review_meta(meta)
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["residual_readability_repair_at"] = timestamp
    with_quality_flag(meta, "residual_readability_repaired")
    updated["meta"] = meta
    return updated


def retire_case(current: dict[str, Any], reason: str, timestamp: str) -> dict[str, Any]:
    updated = deepcopy(current)
    updated["title"] = "Retired unreadable source case"
    updated["prompt"] = "Retired unreadable source case"
    updated["vignette"] = {"narrative": f"This case was retired from the playable pool because: {reason}"}
    meta = deepcopy(updated.get("meta") or {})
    meta["needs_review"] = False
    meta["truncated"] = False
    clear_review_meta(meta)
    meta["quarantined"] = True
    meta["status"] = "QUARANTINED_READABILITY_UNSALVAGEABLE"
    meta["quarantine_reason"] = reason
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["readability_retired_at"] = timestamp
    meta["readability_retired_reason"] = reason
    with_quality_flag(meta, "readability_retired_unsalvageable")
    updated["meta"] = meta
    return updated


def main() -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    target_ids = list(FIXES) + list(RETIRE)
    json_cases = read_json(JSON_FILE, [])
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    cases_by_id = load_case_rows(connection, target_ids)
    updates: dict[int, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []

    for case_id, fix in FIXES.items():
        current = cases_by_id.get(case_id)
        if not current:
            rows.append({"case_id": case_id, "status": "missing_case"})
            continue
        updated = apply_fix(current, fix, timestamp)
        updates[case_id] = updated
        rows.append(
            {
                "case_id": case_id,
                "case_code": updated.get("case_code"),
                "source": updated.get("source"),
                "status": "repaired",
                "prompt": summarize_text(updated.get("prompt") or ""),
                "answer_anchor_text": rebuild_answer_anchor_text(updated.get("options") or []),
            }
        )

    for case_id, reason in RETIRE.items():
        current = cases_by_id.get(case_id)
        if not current:
            rows.append({"case_id": case_id, "status": "missing_case"})
            continue
        updated = retire_case(current, reason, timestamp)
        updates[case_id] = updated
        rows.append(
            {
                "case_id": case_id,
                "case_code": updated.get("case_code"),
                "source": updated.get("source"),
                "status": "retired_unsalvageable",
                "prompt": summarize_text(updated.get("prompt") or ""),
                "reason": reason,
            }
        )

    persist_sqlite(connection, list(updates.values()))
    connection.close()
    update_json_cases(json_cases, updates)
    write_json_atomic(JSON_FILE, json_cases)
    report = {
        "generated_at": timestamp,
        "basis": BASIS,
        "db_file": str(DB_FILE),
        "repaired_count": len(FIXES),
        "retired_count": len(RETIRE),
        "applied_count": len(updates),
        "rows": rows,
    }
    write_json_atomic(REPORT_FILE, report)
    sys.stdout.buffer.write((json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
