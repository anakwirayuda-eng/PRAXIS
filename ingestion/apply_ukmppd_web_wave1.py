from __future__ import annotations

import json
import os
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
REPORT_FILE = ROOT / "ingestion" / "output" / "ukmppd_web_wave1_report.json"
BASIS = "deterministic:ukmppd-web-wave1"


FIXES: dict[int, dict[str, Any]] = {
    54523: {
        "prompt": "Apa diagnosis fraktur distal radius dengan dislokasi radioulnar distal?",
        "narrative": "Laki-laki 22 tahun datang ke IGD setelah jatuh dari sepeda motor. X-ray menunjukkan fraktur distal radius dengan dislokasi sendi radioulnar distal. Apa diagnosisnya?",
    },
    54524: {
        "prompt": "Apa diagnosis fraktur distal radius akibat jatuh dengan pergelangan tangan fleksi?",
        "narrative": "Laki-laki 20 tahun datang ke IGD setelah jatuh dari sepeda motor dengan posisi tangan tertekuk ke dalam menatap aspal. X-ray menunjukkan fraktur distal radius dengan angulasi/pemindahan fragmen ke volar. Apa diagnosisnya?",
    },
    54533: {
        "prompt": "Hormon apa yang paling berperan pada hiperplasia prostat jinak?",
        "narrative": "Pria 61 tahun mengeluh pancaran kencing melemah selama 4 bulan, nokturia, dan tidak ada nyeri atau duh uretra. Rectal toucher menunjukkan pembesaran prostat simetris dan rata, konsisten dengan hiperplasia prostat jinak. Hormon apa yang paling berperan?",
        "options": [
            {"id": "A", "text": "Dihidrotestosteron", "is_correct": True},
            {"id": "B", "text": "Aldosteron", "is_correct": False},
            {"id": "C", "text": "Progesteron", "is_correct": False},
            {"id": "D", "text": "hCG", "is_correct": False},
            {"id": "E", "text": "Testosteron", "is_correct": False},
        ],
    },
    54534: {
        "prompt": "Zona prostat yang paling sering menjadi lokasi karsinoma prostat adalah:",
        "narrative": "Pria 60 tahun memiliki riwayat karsinoma prostat dan telah menjalani TURP. Zona prostat yang paling sering menjadi lokasi karsinoma prostat adalah:",
    },
    54537: {
        "prompt": "Apa diagnosis paling mungkin pada nyeri skrotum akut dengan testis horizontal?",
        "narrative": "Laki-laki 17 tahun datang ke IGD dengan bengkak dan nyeri pada skrotum kanan sejak 1 hari, nyeri menjalar ke lipat paha. Pemeriksaan menunjukkan skrotum kemerahan dan testis kanan tampak lebih horizontal dari biasanya. Apa diagnosis paling mungkin?",
        "options": [
            {"id": "A", "text": "Torsio testis", "is_correct": True},
            {"id": "B", "text": "Orkitis", "is_correct": False},
            {"id": "C", "text": "Epididimitis", "is_correct": False},
            {"id": "D", "text": "Gangren skrotalis", "is_correct": False},
        ],
    },
    54538: {
        "prompt": "Apa tatalaksana awal yang tepat pada pneumotoraks traumatik stabil?",
        "narrative": "Laki-laki 25 tahun datang dengan sesak napas dan nyeri dada kanan setelah jatuh dari sepeda motor 2 jam sebelumnya. Pemeriksaan menunjukkan hemitoraks kanan hipersonor dan suara vesikuler menurun tanpa tanda syok atau deviasi trakea. Apa tatalaksana awal yang tepat?",
        "options": [
            {"id": "A", "text": "Dekompresi jarum", "is_correct": False},
            {"id": "B", "text": "Intubasi", "is_correct": False},
            {"id": "C", "text": "Oksigen dengan face mask", "is_correct": True},
            {"id": "D", "text": "Cairan kristaloid", "is_correct": False},
            {"id": "E", "text": "Trakeostomi", "is_correct": False},
        ],
    },
    54546: {
        "prompt": "Pemeriksaan penunjang awal untuk nodul tiroid eutiroid adalah:",
        "narrative": "Wanita 35 tahun datang dengan benjolan di leher yang ikut bergerak saat menelan. Tidak ada keluhan berdebar atau mata menonjol. Laboratorium menunjukkan TSH normal. Pemeriksaan penunjang awal yang tepat adalah:",
    },
    54552: {
        "prompt": "Apa diagnosis pada pasien dengan nyeri berkemih, hematuria, dan rasa tidak puas setelah kencing?",
        "narrative": "Laki-laki 50 tahun datang ke IGD dengan nyeri saat kencing, sedikit darah pada urin, rasa tidak puas setelah berkemih, nyeri ketok pinggang, dan riwayat sering menahan kencing. Apa diagnosis paling mungkin?",
        "options": [
            {"id": "A", "text": "Karsinoma buli-buli", "is_correct": False},
            {"id": "B", "text": "Vesikolitiasis", "is_correct": True},
            {"id": "C", "text": "Ureterolitiasis", "is_correct": False},
            {"id": "D", "text": "Nefrolitiasis", "is_correct": False},
            {"id": "E", "text": "Uretritis", "is_correct": False},
        ],
    },
    54557: {
        "prompt": "Pemeriksaan lanjutan pada kecurigaan trauma uretra posterior adalah:",
        "narrative": "Laki-laki 40 tahun datang ke IGD setelah kecelakaan. Pemeriksaan menunjukkan prostat melayang yang mengarah ke trauma uretra posterior. Pemeriksaan lanjutan yang paling tepat dari opsi yang tersedia adalah:",
    },
    54566: {
        "prompt": "Perpindahan nyeri ulu hati ke perut kanan bawah pada apendisitis disebut:",
        "narrative": "Laki-laki 22 tahun datang dengan nyeri ulu hati yang berpindah ke perut kanan bawah. Perpindahan nyeri viseral periumbilikal/epigastrium ke kuadran kanan bawah pada apendisitis disebut:",
    },
    54568: {
        "prompt": "Apa diagnosis pada anak dengan sendi lutut bengkak panas dan tidak dapat berjalan?",
        "narrative": "Anak 4 tahun batuk-pilek sejak 1 bulan lalu. Satu minggu kemudian pasien tidak dapat berjalan karena lutut bengkak, nyeri, dan teraba panas. Apa diagnosis paling mungkin?",
        "options": [
            {"id": "A", "text": "Osteomielitis kronis", "is_correct": False},
            {"id": "B", "text": "Artritis septik", "is_correct": True},
            {"id": "C", "text": "Fraktur femur", "is_correct": False},
            {"id": "D", "text": "Artritis reumatoid", "is_correct": False},
            {"id": "E", "text": "Osteosarkoma", "is_correct": False},
        ],
    },
    54575: {
        "prompt": "Apa diagnosis pada trauma kepala dengan lucid interval?",
        "narrative": "Seorang laki-laki datang ke IGD tidak sadar setelah kecelakaan. Ia sempat pingsan 15 menit, sadar penuh, lalu 1,5 jam kemudian kembali mengalami penurunan kesadaran. Apa diagnosis paling mungkin?",
    },
    54576: {
        "prompt": "Apa diagnosis pada benjolan tiroid disertai suara serak lama?",
        "narrative": "Wanita 34 tahun datang dengan benjolan di leher sejak 6 bulan, tidak nyeri, disertai suara serak sejak 2 tahun. Tidak ada tanda tirotoksikosis. Apa diagnosis yang paling tepat?",
    },
    54577: {
        "prompt": "Apa diagnosis massa subkutan lunak yang mudah digerakkan di bokong?",
        "narrative": "Wanita 45 tahun datang dengan benjolan di bokong yang awalnya kecil lalu membesar hingga sebesar telur angsa. Pemeriksaan menunjukkan massa subkutan diameter sekitar 8 cm, lunak, mudah digerakkan, dan tidak nyeri. Apa diagnosis paling mungkin?",
        "options": [
            {"id": "A", "text": "Lipoma", "is_correct": True},
            {"id": "B", "text": "Leiomioma", "is_correct": False},
            {"id": "C", "text": "Fibroma", "is_correct": False},
            {"id": "D", "text": "Hemangioma", "is_correct": False},
            {"id": "E", "text": "Rabdomioma", "is_correct": False},
        ],
    },
    54581: {
        "prompt": "Apa kemungkinan diagnosis pada trauma dengan nyeri kuadran kiri atas?",
        "narrative": "Perempuan 35 tahun mengalami kecelakaan lalu lintas dan dibawa ke IGD. Pasien mengeluh nyeri pada kuadran kiri atas abdomen dan bagian depan. Apa kemungkinan diagnosisnya?",
    },
    54582: {
        "prompt": "Apa diagnosis nyeri kuadran kanan atas dengan Murphy sign?",
        "narrative": "Wanita 43 tahun datang ke IGD dengan nyeri perut disertai demam, mual, dan muntah sejak 1 hari. Nyeri awal dirasakan di ulu hati lalu menetap di kuadran kanan atas, dan pemeriksaan mendukung Murphy sign. Apa diagnosisnya?",
        "options": [
            {"id": "A", "text": "Kolesistitis akut", "is_correct": True},
            {"id": "B", "text": "Kolelitiasis", "is_correct": False},
            {"id": "C", "text": "Pankreatitis akut", "is_correct": False},
            {"id": "D", "text": "Gastroduodenitis", "is_correct": False},
            {"id": "E", "text": "Perforasi ulkus lambung", "is_correct": False},
        ],
    },
    54583: {
        "prompt": "Apa diagnosis nyeri pinggang kanan dengan piuria dan batu saluran kemih?",
        "narrative": "Wanita 31 tahun mengeluh nyeri pinggang kanan hilang timbul sejak 3 bulan, disertai nyeri saat BAK dan urin keruh. Pemeriksaan mengarah ke infeksi ginjal yang berasosiasi dengan batu. Diagnosis pasien ini adalah:",
    },
    54588: {
        "prompt": "Apa diagnosis nyeri perut kanan bawah dengan tanda apendisitis akut?",
        "narrative": "Wanita 24 tahun mengalami nyeri perut kanan bawah dan ulu hati sejak 3 hari, nyeri bertambah saat kaki ditekuk dan berjalan, demam, nyeri tekan kanan bawah, nyeri lepas, psoas sign, dan obturator sign. Apa diagnosisnya?",
        "options": [
            {"id": "A", "text": "Apendisitis akut", "is_correct": True},
            {"id": "B", "text": "Apendisitis kronis", "is_correct": False},
            {"id": "C", "text": "Apendisitis perforasi", "is_correct": False},
            {"id": "D", "text": "Peritonitis akibat perforasi apendiks", "is_correct": False},
            {"id": "E", "text": "Peritonitis akibat perforasi gaster", "is_correct": False},
        ],
    },
    54591: {
        "prompt": "Apa diagnosis paling mungkin pada nyeri perut kiri bawah akut dengan demam?",
        "narrative": "Wanita 33 tahun datang ke IGD dengan nyeri perut kiri bawah sejak kemarin, disertai demam, mual, muntah, takikardia, dan nyeri tekan kuadran kiri bawah. Apa diagnosis paling mungkin?",
        "options": [
            {"id": "A", "text": "Abses hepar", "is_correct": False},
            {"id": "B", "text": "Divertikulitis", "is_correct": True},
            {"id": "C", "text": "Apendisitis", "is_correct": False},
            {"id": "D", "text": "Intususepsi", "is_correct": False},
            {"id": "E", "text": "Ulkus gastroduodenal", "is_correct": False},
        ],
    },
    54619: {
        "prompt": "Apa yang sebaiknya dilakukan dokter saat pasien ingin hasil skrining thalassemia dijelaskan di depan tunangannya?",
        "narrative": "Wanita 27 tahun akan menikah dan takut menderita thalassemia karena saudara sepupunya menderita thalassemia mayor. Ia menjalani pemeriksaan dan satu minggu kemudian datang bersama tunangannya untuk meminta penjelasan hasil. Apa yang sebaiknya dokter lakukan?",
    },
    54621: {
        "prompt": "Kepada siapa keluarga harus diarahkan bila ingin mengetahui isi Visum et Repertum?",
        "narrative": "Pada jenazah dilakukan ekshumasi dan autopsi karena diduga kematian tidak wajar. Keluarga meminta dokter menjelaskan hasil Visum et Repertum. Sikap sebagai dokter adalah:",
    },
    54623: {
        "prompt": "Metode identifikasi primer apa yang membantu identifikasi korban kecelakaan massal?",
        "narrative": "Korban kecelakaan pesawat berjumlah 150 orang. Dilakukan pemeriksaan antemortem dan postmortem untuk identifikasi. Metode identifikasi primer yang paling membantu adalah:",
    },
    54626: {
        "prompt": "Apa yang dilakukan dokter bila keluarga menolak autopsi pada kematian tidak wajar?",
        "narrative": "Seorang dokter diminta memeriksa jenazah yang diduga meninggal karena gantung diri. Dokter menyarankan autopsi, tetapi keluarga menolak. Apa yang dilakukan dokter?",
    },
    54629: {
        "prompt": "Temuan pemeriksaan jenazah apa yang paling sesuai dengan kematian mendadak di pematang sawah tanpa saksi?",
        "narrative": "Seorang lelaki tua ditemukan meninggal di pematang sawah tanpa saksi mata. Pada konteks forensik, temuan kulit yang paling spesifik untuk kemungkinan pajanan listrik atau panas lingkungan adalah:",
        "options": [
            {"id": "A", "text": "Luka bakar", "is_correct": True},
            {"id": "B", "text": "Bula", "is_correct": False},
            {"id": "C", "text": "Luka tekan geser", "is_correct": False},
            {"id": "D", "text": "Tanda iskemik", "is_correct": False},
            {"id": "E", "text": "Laserasi", "is_correct": False},
        ],
    },
    54630: {
        "prompt": "Apa jenis luka akibat gesekan kulit dengan permukaan kasar pada kecelakaan lalu lintas?",
        "narrative": "Seorang laki-laki dibawa ke IGD setelah kecelakaan lalu lintas. Luka tampak sebagai kerusakan superfisial epidermis akibat gesekan kulit dengan permukaan kasar, dengan reaksi radang dan biasanya tidak meninggalkan jaringan parut dalam. Apa jenis luka tersebut?",
        "options": [
            {"id": "A", "text": "Luka sayat", "is_correct": False},
            {"id": "B", "text": "Luka lecet geser", "is_correct": True},
            {"id": "C", "text": "Luka lecet tekan", "is_correct": False},
            {"id": "D", "text": "Luka tusuk", "is_correct": False},
            {"id": "E", "text": "Laserasi", "is_correct": False},
        ],
    },
    54631: {
        "prompt": "Kapan dokter dapat menyatakan kematian pasien?",
        "narrative": "Pasien dengan sirosis hepatis dan perdarahan saluran cerna atas dinyatakan meninggal di IGD. Kapan dokter dapat menyatakan kematian pasien?",
        "options": [
            {"id": "A", "text": "Setelah memeriksa tekanan darah, nadi, dan refleks batang otak", "is_correct": True},
            {"id": "B", "text": "Menunggu 30 menit sampai lebam mayat muncul", "is_correct": False},
            {"id": "C", "text": "Menunggu 30 menit sampai kaku mayat muncul", "is_correct": False},
            {"id": "D", "text": "Menunggu 2 jam sampai lebam mayat muncul", "is_correct": False},
            {"id": "E", "text": "Menunggu 2 jam sampai kaku mayat muncul", "is_correct": False},
        ],
    },
    54637: {
        "prompt": "Terapi antivirus yang sesuai untuk herpes zoster adalah:",
        "narrative": "Pasien dengan herpes zoster membutuhkan terapi antivirus. Terapi yang sesuai adalah:",
    },
    54638: {
        "prompt": "Organisme penyebab tinea kapitis dengan fluoresensi hijau keemasan pada lampu Wood adalah:",
        "narrative": "Anak 8 tahun datang dengan gatal di daerah kepala. Pemeriksaan lampu Wood tampak fluoresensi hijau keemasan pada rambut. Organisme penyebab yang paling sesuai adalah:",
        "options": [
            {"id": "A", "text": "Trichophyton rubrum", "is_correct": False},
            {"id": "B", "text": "Microsporum sp.", "is_correct": True},
            {"id": "C", "text": "Candida albicans", "is_correct": False},
            {"id": "D", "text": "Malassezia furfur", "is_correct": False},
            {"id": "E", "text": "Staphylococcus aureus", "is_correct": False},
        ],
    },
    54640: {
        "prompt": "Antibiotik sistemik untuk impetigo krustosa pada anak ini adalah:",
        "narrative": "Anak 3 tahun sering pilek dan memiliki krusta kuning yang mudah lepas di sekitar hidung dan bibir, konsisten dengan impetigo krustosa. Antibiotik sistemik dari opsi berikut yang paling tepat adalah:",
    },
    54643: {
        "prompt": "Apa diagnosis bercak kulit kronis tidak gatal disertai gangguan sensibilitas?",
        "narrative": "Pria 35 tahun datang dengan bercak kemerahan di seluruh tubuh selama 3 bulan. Bercak awalnya di punggung lalu menyebar ke kaki dan tangan, tidak gatal, disertai vertigo, kesemutan, rasa tebal pada kedua kaki, dan kaki terasa kasar. Status dermatologis menunjukkan makula/plak eritematosa dengan ukuran bervariasi. Diagnosisnya adalah:",
    },
    54645: {
        "prompt": "Apa diagnosis lesi eritematosa berbatas tegas dengan tepi meninggi setelah trauma kulit?",
        "narrative": "Perempuan 30 tahun dengan obesitas datang setelah tungkai kanan tertusuk duri 3 hari lalu. Ia demam dan terdapat lesi kemerahan dengan batas tegas, edema, menjalar hingga paha dalam, serta tepi lesi meninggi. Diagnosis yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Erysipelas", "is_correct": True},
            {"id": "B", "text": "Impetigo", "is_correct": False},
            {"id": "C", "text": "Selulitis", "is_correct": False},
            {"id": "D", "text": "Abses", "is_correct": False},
            {"id": "E", "text": "Ektima", "is_correct": False},
        ],
    },
    54648: {
        "prompt": "Mikroorganisme penyebab cutaneous larva migrans setelah pajanan pasir pantai adalah:",
        "narrative": "Wanita 27 tahun datang dengan nyeri dan gatal pada punggung kaki kanan setelah berkunjung ke pantai. Lesi tampak berkelok-kelok dan bertambah panjang setiap hari. Mikroorganisme penyebab paling mungkin adalah:",
        "options": [
            {"id": "A", "text": "Loa loa", "is_correct": False},
            {"id": "B", "text": "Ancylostoma duodenale", "is_correct": False},
            {"id": "C", "text": "Ancylostoma braziliense", "is_correct": True},
            {"id": "D", "text": "Dracunculus medinensis", "is_correct": False},
            {"id": "E", "text": "Strongyloides stercoralis", "is_correct": False},
        ],
    },
    54654: {
        "prompt": "Parasit/arthropoda apa yang bertubuh pipih dorsoventral, beruas, satu pasang kaki tiap ruas, antena, dan poison claw?",
        "narrative": "Anak 12 tahun dibawa ke puskesmas setelah bermain ke hutan, kemudian punggung kaki kanan kemerahan, bengkak, dan nyeri. Ditemukan arthropoda berbadan pipih dorsoventral, kepala dan badan beruas-ruas, tiap ruas memiliki sepasang kaki, terdapat antena dan poison claw. Kemungkinan penyebabnya adalah:",
        "options": [
            {"id": "A", "text": "Millipede", "is_correct": False},
            {"id": "B", "text": "Centipede", "is_correct": True},
            {"id": "C", "text": "Sarcoptes scabiei", "is_correct": False},
            {"id": "D", "text": "Latrodectus geometricus", "is_correct": False},
        ],
    },
    54657: {
        "prompt": "Pemeriksaan penunjang klasik untuk lesi varisela adalah:",
        "narrative": "Anak 6 tahun demam 5 hari lalu muncul vesikel kecil berair yang awalnya di wajah kemudian menyebar sentripetal ke seluruh tubuh. Pemeriksaan penunjang klasik dari opsi berikut adalah:",
        "options": [
            {"id": "A", "text": "Tzanck test", "is_correct": True},
            {"id": "B", "text": "KOH test", "is_correct": False},
            {"id": "C", "text": "Pewarnaan Gram", "is_correct": False},
            {"id": "D", "text": "Ziehl-Neelsen", "is_correct": False},
            {"id": "E", "text": "Hematoksilin-eosin", "is_correct": False},
        ],
    },
    54658: {
        "prompt": "Obat topikal pilihan untuk skabies pada anak adalah:",
        "narrative": "Anak 18 bulan datang dengan gatal dan bintik-bintik di sela jari, selangkangan, dan siku. Kakak pasien mengalami keluhan serupa dan tinggal di asrama. Obat topikal pilihan untuk pasien ini adalah:",
        "options": [
            {"id": "A", "text": "Permetrin 5%", "is_correct": True},
            {"id": "B", "text": "Steroid topikal", "is_correct": False},
            {"id": "C", "text": "Salep sulfur 2-4", "is_correct": False},
            {"id": "D", "text": "Cetirizine", "is_correct": False},
            {"id": "E", "text": "Diphenhydramine", "is_correct": False},
        ],
    },
    54659: {
        "prompt": "Apa diagnosis plak putih gatal dengan hifa pendek dan spora bergerombol?",
        "narrative": "Anak 5 tahun mengeluh gatal di leher. Pemeriksaan fisik menunjukkan plak putih; kerokan menunjukkan hifa pendek dan spora bergerombol, serta fluoresensi kuning keemasan. Diagnosisnya adalah:",
        "options": [
            {"id": "A", "text": "Tinea corporis", "is_correct": False},
            {"id": "B", "text": "Kandidiasis kutis", "is_correct": False},
            {"id": "C", "text": "Pityriasis versicolor", "is_correct": True},
            {"id": "D", "text": "Keratitis", "is_correct": False},
            {"id": "E", "text": "Vitiligo", "is_correct": False},
        ],
    },
    54666: {
        "prompt": "Apa diagnosis laki-laki dengan kencing bernanah setelah hubungan seksual berisiko?",
        "narrative": "Laki-laki 25 tahun mengeluh kencing keluar nanah sejak 2 hari dan nyeri saat berkemih. Ia berhubungan seksual dengan PSK 1 minggu sebelumnya tanpa kondom. Ostium uretra eksternum tampak eritema, dan mikroskopis menunjukkan banyak leukosit. Apa diagnosisnya?",
        "options": [
            {"id": "A", "text": "Uretritis gonore", "is_correct": True},
            {"id": "B", "text": "Uretritis non-gonore", "is_correct": False},
            {"id": "C", "text": "Sistitis", "is_correct": False},
            {"id": "D", "text": "Sifilis stadium 1", "is_correct": False},
            {"id": "E", "text": "Sifilis stadium 2", "is_correct": False},
        ],
    },
}


def ensure_rationale_dict(case_data: dict[str, Any]) -> dict[str, Any]:
    rationale = case_data.get("rationale")
    if isinstance(rationale, dict):
        return rationale
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
    without_quality_flags(meta, {"readability_batch_salvage_hold"})
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["ukmppd_web_release_at"] = timestamp
    with_quality_flag(meta, "ukmppd_web_repaired")
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
