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
REPORT_FILE = ROOT / "ingestion" / "output" / "fdi_fk_wave1_report.json"
BASIS = "deterministic:fdi-fk-wave1"


FIXES: dict[int, dict[str, Any]] = {
    66809: {
        "prompt": "Apa tatalaksana definitif otitis media akut dengan membran timpani menonjol dan nyeri hebat?",
        "narrative": "Anak perempuan 7 tahun datang dengan nyeri telinga kiri 3 hari, demam tinggi, gelisah, dan riwayat batuk-pilek 1 minggu. Otoskopi menunjukkan membran timpani kiri menonjol/hiperemis sesuai otitis media akut berat. Tatalaksana definitif yang tepat adalah:",
        "options": [
            {"id": "A", "text": "H2O2 3%", "is_correct": False},
            {"id": "B", "text": "Miringotomi", "is_correct": True},
            {"id": "C", "text": "Observasi saja", "is_correct": False},
            {"id": "D", "text": "Amoksisilin dosis rendah tanpa tindakan", "is_correct": False},
            {"id": "E", "text": "Miringoplasti", "is_correct": False},
        ],
    },
    66814: {
        "prompt": "Apa hasil spirometri yang diharapkan pada PPOK stabil?",
        "narrative": "Pria 60 tahun datang dengan sesak napas, riwayat merokok 30 tahun, barrel chest, foto toraks hiperinflasi dengan diafragma mendatar, dan kondisi stabil. Pemeriksaan spirometri yang diharapkan adalah:",
        "options": [
            {"id": "A", "text": "FEV1 menurun, FVC normal, FEV1/FVC post-bronkodilator <70%", "is_correct": True},
            {"id": "B", "text": "FEV1 menurun, FVC normal, FEV1/FVC post-bronkodilator >70%", "is_correct": False},
            {"id": "C", "text": "FEV1 normal dengan FEV1/FVC normal", "is_correct": False},
            {"id": "D", "text": "FEV1 meningkat, FVC menurun, FEV1/FVC post-bronkodilator <70%", "is_correct": False},
            {"id": "E", "text": "FEV1 meningkat, FVC meningkat, FEV1/FVC post-bronkodilator <70%", "is_correct": False},
        ],
    },
    66817: {
        "prompt": "Apa terapi aritmia torsades de pointes pada pasien berdebar dengan EKG polymorphic VT?",
        "narrative": "Pria 50 tahun datang dengan berdebar dan pusing. Nadi 150x/menit, riwayat hipertensi dan nyeri dada. EKG menunjukkan polymorphic ventricular tachycardia dengan pola twisting yang sesuai torsades de pointes. Terapi paling tepat adalah:",
        "options": [
            {"id": "A", "text": "ACE inhibitor", "is_correct": False},
            {"id": "B", "text": "Amiodaron", "is_correct": False},
            {"id": "C", "text": "Observasi", "is_correct": False},
            {"id": "D", "text": "Epinefrin", "is_correct": False},
            {"id": "E", "text": "MgSO4", "is_correct": True},
        ],
    },
    66883: {
        "prompt": "Apa terapi konservatif barotrauma telinga tengah setelah menyelam?",
        "narrative": "Pria 21 tahun mengeluh nyeri telinga dan berdenging setelah menyelam sekitar 60 meter. Membran timpani tampak suram kebiruan, hidung menunjukkan sekret bening dan konka edema hiperemis. Terapi konservatif yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Perasat Valsalva", "is_correct": True},
            {"id": "B", "text": "Antibiotik lokal", "is_correct": False},
            {"id": "C", "text": "Pemasangan grommet", "is_correct": False},
            {"id": "D", "text": "Selalu mengunyah saja", "is_correct": False},
        ],
    },
    67027: {
        "prompt": "Apa diagnosis tonsil kriptik dengan halitosis dan keluhan mengganjal kronik?",
        "narrative": "Perempuan 37 tahun mengeluh rasa mengganjal di tenggorokan sejak 7 hari, hilang timbul sejak 6 bulan. Tidak ada demam, batuk, atau nyeri tenggorok. Tonsil T2/T2 tidak hiperemis, kripta melebar, dan terdapat halitosis. Diagnosis yang mungkin adalah:",
        "options": [
            {"id": "A", "text": "Tonsilitis akut", "is_correct": False},
            {"id": "B", "text": "Tonsilitis kronis", "is_correct": True},
            {"id": "C", "text": "Tonsilitis kronis eksaserbasi akut", "is_correct": False},
            {"id": "D", "text": "Karsinoma tonsil", "is_correct": False},
        ],
    },
    66885: {
        "prompt": "Komplikasi apa yang paling mungkin pada difteri faring dengan bull neck?",
        "narrative": "Anak 7 tahun datang dengan nyeri tenggorokan, disfoni, demam, tonsil T2/T2, pseudomembran putih yang berdarah saat diangkat, dan bull neck. Komplikasi yang paling mungkin terjadi adalah:",
        "options": [
            {"id": "A", "text": "Faringitis luetika", "is_correct": False},
            {"id": "B", "text": "Miokarditis", "is_correct": True},
            {"id": "C", "text": "Rhinosinusitis", "is_correct": False},
            {"id": "D", "text": "Meningitis", "is_correct": False},
        ],
    },
    66887: {
        "prompt": "Komplikasi apa yang dapat terjadi bila hematoma septum nasi tidak ditangani?",
        "narrative": "Anak laki-laki 15 tahun datang dengan hidung bengkak dan tersumbat setelah berkelahi. Pemeriksaan menunjukkan hematoma septum berbentuk bulat, licin, dan merah. Komplikasi yang dapat terjadi bila tidak segera ditangani adalah:",
        "options": [
            {"id": "A", "text": "Abses telinga dalam", "is_correct": False},
            {"id": "B", "text": "Septum hematoma", "is_correct": False},
            {"id": "C", "text": "Rhinosinusitis", "is_correct": False},
            {"id": "D", "text": "Saddle nose", "is_correct": True},
        ],
    },
    66922: {
        "prompt": "Bagaimana penularan disentri basiler dengan diare darah dan demam tinggi?",
        "narrative": "Anak 6 tahun mengalami BAB cair berlendir dan berdarah merah segar 15 kali sehari, nyeri setiap akan BAB, demam 39 derajat C, abdomen cekung, bising usus meningkat, dan turgor agak lambat. Gambaran ini sesuai disentri basiler. Cara penularannya adalah:",
        "options": [
            {"id": "A", "text": "Kista/trofozoit, fekal-oral", "is_correct": False},
            {"id": "B", "text": "Cholera enterotoxin, fekal-oral", "is_correct": False},
            {"id": "C", "text": "Larva rhabditiform, fekal-oral", "is_correct": False},
            {"id": "D", "text": "Shiga-like toxin, fekal-oral", "is_correct": True},
        ],
    },
    67022: {
        "prompt": "Apa diagnosis benjolan daun telinga berisi darah setelah trauma tinju?",
        "narrative": "Pria 37 tahun atlet tinju datang dengan benjolan nyeri pada daun telinga setelah terkena pukulan. Status lokalis menunjukkan edema, hiperemis, nyeri tekan, massa fluktuatif berisi darah, dan aspirasi menghasilkan cairan kemerahan. Diagnosis yang mungkin adalah:",
        "options": [
            {"id": "A", "text": "Otitis eksterna", "is_correct": False},
            {"id": "B", "text": "Perikondritis", "is_correct": False},
            {"id": "C", "text": "Abses periaurikular", "is_correct": False},
            {"id": "D", "text": "Othematoma/pseudoothematoma", "is_correct": True},
        ],
    },
    67026: {
        "prompt": "Apa hasil garputala pada otosklerosis dengan tuli konduktif bilateral?",
        "narrative": "Perempuan 45 tahun mengeluh pendengaran menurun progresif bilateral, lebih berat di kanan, disertai tinnitus. Di keramaian pasien cenderung bicara pelan dan merasa pendengarannya membaik, sesuai paracusis Willisii pada otosklerosis. Hasil garputala yang paling mungkin adalah:",
        "options": [
            {"id": "A", "text": "Rinne -/-, Weber tidak ada lateralisasi, Schwabach memendek", "is_correct": False},
            {"id": "B", "text": "Rinne +/+, Weber tidak ada lateralisasi, Schwabach memendek bilateral", "is_correct": False},
            {"id": "C", "text": "Rinne +/+, Weber lateralisasi ke kiri, Schwabach memanjang", "is_correct": False},
            {"id": "D", "text": "Rinne -/-, Weber lateralisasi ke kanan, Schwabach memanjang", "is_correct": True},
        ],
    },
    67069: {
        "prompt": "Apa terapi konservatif laringitis akut pada guru paduan suara?",
        "narrative": "Pria 35 tahun mengeluh suara serak 3 hari disertai nyeri tenggorok setelah batuk-pilek. Ia bekerja sebagai guru paduan suara dan sering menggunakan suara. Laringoskopi indirek menunjukkan rima glotis terbuka, hiperemis, dan gerak simetris. Terapi konservatif yang disarankan adalah:",
        "options": [
            {"id": "A", "text": "Antibiotik oral rutin", "is_correct": False},
            {"id": "B", "text": "Trakeostomi", "is_correct": False},
            {"id": "C", "text": "Istirahat berbicara/istirahat suara", "is_correct": True},
            {"id": "D", "text": "Bedah mikro laring", "is_correct": False},
        ],
    },
    67071: {
        "prompt": "Faktor risiko utama apa pada otitis eksterna maligna dengan diabetes tidak terkontrol?",
        "narrative": "Perempuan 32 tahun mengalami otore kuning, nyeri telinga kanan yang bertambah saat daun telinga digerakkan, facial palsy, dan keluhan berulang. Pasien memiliki diabetes melitus dengan GDS 350 mg/dL. Faktor risiko yang paling mungkin adalah:",
        "options": [
            {"id": "A", "text": "Hipertensi grade II", "is_correct": False},
            {"id": "B", "text": "Jenis kelamin perempuan", "is_correct": False},
            {"id": "C", "text": "Stroke non-hemoragik", "is_correct": False},
            {"id": "D", "text": "Usia lanjut", "is_correct": False},
            {"id": "E", "text": "Diabetes melitus tidak terkontrol", "is_correct": True},
        ],
    },
    67073: {
        "prompt": "Apa diagnosis vesikel telinga unilateral dengan paralisis fasialis setelah riwayat varisela?",
        "narrative": "Perempuan 27 tahun mengeluh nyeri telinga kiri, demam, lemas, dan vesikel berkelompok berisi cairan dari pipi hingga belakang telinga. Pemeriksaan menunjukkan vesikel di atas makula eritem, lesi satu gerombolan seusia, kulit antar-gerombolan normal, dan paralisis otot wajah kiri. Riwayat cacar air saat kecil ada. Diagnosisnya adalah:",
        "options": [
            {"id": "A", "text": "Otitis eksterna maligna", "is_correct": False},
            {"id": "B", "text": "Herpes zoster otikus", "is_correct": True},
            {"id": "C", "text": "Varicella primer", "is_correct": False},
            {"id": "D", "text": "Bell's palsy", "is_correct": False},
        ],
    },
    66749: {
        "prompt": "Apa tatalaksana tepat pada open pneumothorax pascatrauma dada?",
        "narrative": "Pria 45 tahun datang setelah kecelakaan lalu lintas. Tampak luka terbuka pada dada kiri dengan gelembung udara keluar, perkusi hipersonor pada dada kiri, dan pasien masih sadar dengan tanda vital relatif stabil. Tatalaksana definitif dari pilihan yang tersedia adalah:",
        "options": [
            {"id": "A", "text": "Pasang WSD", "is_correct": True},
            {"id": "B", "text": "Perikardiosentesis", "is_correct": False},
            {"id": "C", "text": "Needle decompression", "is_correct": False},
            {"id": "D", "text": "Analgetik saja", "is_correct": False},
        ],
    },
    66960: {
        "prompt": "Apa nama defek kelopak mata kongenital dengan tepi kelopak tidak utuh?",
        "narrative": "Seorang anak dibawa karena kelopak mata kiri tampak tidak lazim. Visus kedua mata normal, mata tenang, tidak ada nyeri atau gatal. Kelopak tampak memiliki defek kongenital pada tepi kelopak. Kondisi ini disebut:",
    },
    67031: {
        "prompt": "Apa dasar embriologis koloboma kelopak mata?",
        "narrative": "Seorang anak dibawa karena kelopak mata tampak tidak normal sejak lahir. Visus normal, mata tenang, tidak merah, tidak nyeri, tidak gatal, dan tidak ada riwayat trauma. Kondisi tersebut sesuai koloboma kelopak. Dasar keluhan ini adalah:",
    },
    66748: {
        "prompt": "Berapa perkiraan luas luka bakar pada wajah, dada, dan lengan kanan bawah?",
        "narrative": "Pria 30 tahun datang dengan luka bakar 1 hari. Tanda vital stabil. Tampak luka bakar merah nyeri pada daerah wajah, dada, dan lengan kanan bawah. Dengan pendekatan rule of nines/pembagian area sederhana, luas luka bakar yang paling sesuai dari pilihan adalah:",
    },
    66811: {
        "prompt": "Pemeriksaan penunjang apa yang diharapkan pada rinitis non-alergi/vasomotor?",
        "narrative": "Pria 29 tahun mengeluh hidung tersumbat bergantian kanan-kiri selama 1 tahun, sekret putih kental, membaik dengan minyak kayu putih, tanpa riwayat alergi pribadi maupun keluarga. Konka tampak edema kemerahan dengan sekret seromukosa. Hasil penunjang yang diharapkan adalah:",
        "options": [
            {"id": "A", "text": "Skin prick test positif kuat", "is_correct": False},
            {"id": "B", "text": "Leukosit meningkat", "is_correct": False},
            {"id": "C", "text": "IgE total normal", "is_correct": True},
            {"id": "D", "text": "Kadar eosinofil meningkat", "is_correct": False},
        ],
    },
    66977: {
        "prompt": "Apa diagnosis papul kecil dengan rambut di tengah pada bokong?",
        "narrative": "Wanita 27 tahun datang dengan benjolan kecil pada bokong kiri. Status dermatologis menunjukkan satu papul 0,3 cm dengan rambut di tengahnya. Diagnosis yang tepat adalah:",
    },
    66991: {
        "prompt": "Kapan perkiraan waktu kematian bila lebam mayat masih hilang dengan penekanan?",
        "narrative": "Mayat perempuan ditemukan di kamar hotel. Lebam mayat di punggung masih hilang dengan penekanan. Dokter tiba di TKP pukul 09.00 tanggal 20-08-2018. Perkiraan waktu kematian yang paling sesuai adalah:",
    },
    67365: {
        "prompt": "Apa diagnosis EKG dengan dua VES berturut-turut pada pasien berdebar?",
        "narrative": "Perempuan 60 tahun datang dengan berdebar dan keringat dingin sejak 1 jam. Riwayat hipertensi dan infark miokard 2 tahun lalu. EKG lead II menunjukkan dua ventricular extrasystole berturut-turut. Diagnosis yang tepat adalah:",
    },
    68215: {
        "prompt": "Apa diagnosis vesikel/papul gatal rekuren pada telapak tangan yang mudah berkeringat?",
        "narrative": "Perempuan 22 tahun datang dengan bintik kecil pada jari dan telapak tangan, gatal mengganggu, tangan mudah berkeringat, dan riwayat keluhan serupa yang sembuh sendiri. Pemeriksaan menunjukkan papul/vesikel kecil sewarna kulit pada telapak/jari. Diagnosis yang tepat adalah:",
    },
    67741: {
        "prompt": "Apa diagnosis ulkus diabetik dengan gangren lokal pada dorsum pedis?",
        "narrative": "Perempuan 39 tahun dengan diabetes tidak terkontrol 10 tahun memiliki luka kaki kiri 4 bulan yang memburuk, berbau tidak sedap, dan tampak kehitaman lokal pada dorsum pedis sinistra. Diagnosisnya adalah:",
    },
    67747: {
        "prompt": "Apa diagnosis benjolan kulit lutut sewarna kulit yang stabil dan tidak nyeri?",
        "narrative": "Perempuan 27 tahun memiliki benjolan sewarna kulit pada lutut kanan selama sekitar 5 bulan, tidak gatal, tidak nyeri, dan tidak membesar. Diagnosis yang paling mungkin dari pilihan adalah:",
    },
    67137: {
        "prompt": "Apa patofisiologi poliuria setelah trauma kepala dengan papiledema?",
        "narrative": "Perempuan 35 tahun mengalami kecelakaan kepala 2 hari lalu, kemudian BAK lebih dari 20 kali dalam 24 jam, nyeri kepala, muntah, dan papiledema. Gambaran ini mengarah ke diabetes insipidus sentral akibat gangguan hipotalamus-hipofisis setelah peningkatan TIK. Patofisiologi yang terjadi adalah:",
    },
    67230: {
        "prompt": "Apa diagnosis disfagia progresif padat lalu cair dengan gambaran bird-beak?",
        "narrative": "Pria 45 tahun mengeluh sering tersedak saat makan, awalnya sulit menelan makanan padat lalu seminggu terakhir juga sulit menelan minuman. Keluhan disertai penurunan berat badan dan rasa terbakar di dada. Barium swallow menunjukkan gambaran bird-beak. Diagnosis yang tepat adalah:",
    },
    67300: {
        "prompt": "Apa tatalaksana skabies pada ibu hamil?",
        "narrative": "Wanita 24 tahun G1P0A0 datang bersama suami dengan gatal pada sela jari kedua tangan sejak 3 hari, memberat malam hari, dan suami memiliki keluhan serupa. Pemeriksaan menunjukkan lesi khas skabies. Tatalaksana yang sesuai dan aman adalah:",
        "options": [
            {"id": "A", "text": "Gameksan 1%", "is_correct": False},
            {"id": "B", "text": "Sulfur presipitatum 10%", "is_correct": False},
            {"id": "C", "text": "Permetrin 1%", "is_correct": False},
            {"id": "D", "text": "Permetrin 5%", "is_correct": True},
            {"id": "E", "text": "Lindane 1%", "is_correct": False},
        ],
    },
    67303: {
        "prompt": "Apa diagnosis nodul aksila gatal-panas yang pecah menjadi ulkus bergaung?",
        "narrative": "Wanita 32 tahun datang dengan benjolan di ketiak kiri 3 minggu, terasa gatal dan panas. Setelah pecah, terbentuk luka dengan tepi merah kebiruan dan dinding bergaung. Diagnosisnya adalah:",
        "options": [
            {"id": "A", "text": "Skrofuloderma", "is_correct": False},
            {"id": "B", "text": "Hidradenitis supurativa", "is_correct": True},
            {"id": "C", "text": "Karbunkel", "is_correct": False},
            {"id": "D", "text": "Akne vulgaris", "is_correct": False},
            {"id": "E", "text": "Furunkel", "is_correct": False},
        ],
    },
    67310: {
        "prompt": "Apa hasil KOH pada pityriasis versicolor?",
        "narrative": "Pria 19 tahun mengeluh gatal pada punggung yang memberat saat berkeringat. Pemeriksaan menunjukkan makula hipopigmentasi berbatas tidak tegas dengan skuama halus. Dokter mencurigai pityriasis versicolor dan melakukan KOH. Hasil yang diharapkan adalah:",
        "options": [
            {"id": "A", "text": "Pseudohifa dan blastospora", "is_correct": False},
            {"id": "B", "text": "Hifa panjang dan artrospora", "is_correct": False},
            {"id": "C", "text": "Pseudohifa dan konidiospora", "is_correct": False},
            {"id": "D", "text": "Hifa pendek dan blastospora", "is_correct": True},
            {"id": "E", "text": "Hifa panjang dan blastospora", "is_correct": False},
        ],
    },
    67368: {
        "prompt": "Kelainan anatomi apa yang bukan bagian dari tetralogi Fallot?",
        "narrative": "Anak laki-laki 4 tahun mengalami sesak dan sianosis, membaik saat berjongkok, serta terdapat clubbing. Dokter menyatakan pasien memiliki penyakit jantung bawaan tetralogi Fallot. Berikut yang bukan kelainan anatomi pada penyakit tersebut adalah:",
    },
    67612: {
        "prompt": "Apa diagnosis sesak mendadak dengan riwayat DVT, D-dimer tinggi, dan pola S1Q3T3?",
        "narrative": "Pria 56 tahun datang dengan sesak mendadak dan nyeri dada. Riwayat nyeri, bengkak, dan kemerahan pada kaki. Pemeriksaan menunjukkan takipnea, takikardia, SpO2 88%, D-dimer meningkat, dan EKG pola S1Q3T3. Diagnosis yang tepat adalah:",
    },
    67631: {
        "prompt": "Apa diagnosis batuk kronik dengan edema wajah, JVP meningkat, dan massa mediastinum?",
        "narrative": "Perempuan 35 tahun mengalami sesak dan batuk 2 bulan, nyeri dada, sulit menelan, wajah terutama kelopak mata membengkak, JVP meningkat, dan foto toraks menunjukkan massa mediastinum. Diagnosis yang paling mungkin adalah:",
    },
    68253: {
        "prompt": "Apa diagnosis bercak berulang di lokasi sama setelah minum obat analgesik?",
        "narrative": "Perempuan 25 tahun mengeluh bercak kehitaman di perut. Lesi awalnya kemerahan lalu menjadi hiperpigmentasi, gatal minimal, pernah berulang 3 bulan lalu di lokasi yang sama, dan muncul setelah minum obat antinyeri. Diagnosis yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Urtikaria", "is_correct": False},
            {"id": "B", "text": "Fixed drug eruption", "is_correct": True},
            {"id": "C", "text": "Tinea corporis", "is_correct": False},
            {"id": "D", "text": "Dermatitis numularis", "is_correct": False},
            {"id": "E", "text": "Liken simpleks kronikus", "is_correct": False},
        ],
    },
    68266: {
        "prompt": "Apa diagnosis makula hipopigmentasi berskuama yang gatal saat berkeringat?",
        "narrative": "Pria 30 tahun memiliki makula hipopigmentasi di lengan atas kanan yang sering kambuh, gatal saat berkeringat, berskuama, berbatas tegas, dan pemeriksaan mikologi mendukung infeksi Malassezia. Diagnosisnya adalah:",
    },
    68275: {
        "prompt": "Apa penyebab ulkus kulit memanjang pada leher dengan gejala TB paru?",
        "narrative": "Pria 45 tahun datang dengan luka memanjang pada leher, diawali benjolan berisi cairan yang pecah. Pasien batuk 3 minggu, demam ringan, dan keringat malam. Ulkus kemerahan, memanjang, permukaan kotor, soliter, sesuai skrofuloderma. Penyebab lesi kulit adalah:",
    },
    67497: {
        "prompt": "Apa diagnosis massa dinding anterior vagina pada perempuan 32 tahun?",
        "narrative": "Perempuan 32 tahun mengeluh benjolan keluar dari kemaluan dan sulit memasukkan tampon saat haid. Inspekulo menunjukkan massa pada dinding anterior/anterolateral vagina yang menutupi liang vagina. Diagnosis paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Kista Gartner", "is_correct": True},
            {"id": "B", "text": "Kista Bartholin", "is_correct": False},
            {"id": "C", "text": "Kista Nabothi", "is_correct": False},
            {"id": "D", "text": "Divertikulum uretra", "is_correct": False},
            {"id": "E", "text": "Duktus Gartner normal", "is_correct": False},
        ],
    },
    67523: {
        "prompt": "Apa penyebab abortus berulang dengan panjang serviks 1,5 cm?",
        "narrative": "Wanita 34 tahun ingin memiliki keturunan dan memiliki riwayat abortus spontan tiga kali. Pemeriksaan menunjukkan panjang serviks 1,5 cm. Kemungkinan penyebab keadaan pasien adalah:",
    },
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


def apply_fix(current: dict[str, Any], fix: dict[str, Any], timestamp: str) -> dict[str, Any]:
    updated = deepcopy(current)
    updated["prompt"] = normalize_text(fix["prompt"])
    updated["title"] = normalize_text(fix["prompt"])

    vignette = updated.get("vignette")
    if isinstance(vignette, dict):
        vignette["narrative"] = normalize_text(fix["narrative"])
    else:
        updated["vignette"] = {"narrative": normalize_text(fix["narrative"])}

    if fix.get("options"):
        updated["options"] = deepcopy(fix["options"])
    if fix.get("rationale"):
        rationale = ensure_rationale_dict(updated)
        rationale["correct"] = normalize_text(fix["rationale"])
        updated["rationale"] = rationale

    meta = deepcopy(updated.get("meta") or {})
    meta["needs_review"] = False
    meta["truncated"] = False
    meta["quarantined"] = False
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
            "fdi_prompt_leak",
            "fdi_prompt_leak_fixed",
            "missing_image_context",
            "fdi_prompt_extracted",
            "readability_watermark_removed",
        },
    )
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["fdi_fk_release_at"] = timestamp
    with_quality_flag(meta, "fdi_fk_repaired")
    updated["meta"] = meta
    return updated


def main() -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    target_ids = list(FIXES)
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
                "status": "applied",
                "prompt": summarize_text(updated.get("prompt") or ""),
                "answer_anchor_text": rebuild_answer_anchor_text(updated.get("options") or []),
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
        "applied_count": len(updates),
        "rows": rows,
    }
    write_json_atomic(REPORT_FILE, report)
    sys.stdout.buffer.write((json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
