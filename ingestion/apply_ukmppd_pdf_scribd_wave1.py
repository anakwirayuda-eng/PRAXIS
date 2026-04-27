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
REPORT_FILE = ROOT / "ingestion" / "output" / "ukmppd_pdf_scribd_wave1_report.json"
BASIS = "deterministic:ukmppd-pdf-scribd-wave1"


FIXES: dict[int, dict[str, Any]] = {
    980051: {
        "prompt": "Apa tindakan awal pada pasien sesak akut dengan hipoksemia tanpa tanda syok?",
        "narrative": "Seorang laki-laki 60 tahun datang ke IGD dengan sesak napas sejak 2 jam. Pasien gelisah, frekuensi napas 30 kali/menit, nadi 110 kali/menit, tekanan darah 130/80 mmHg, dan saturasi oksigen 88% pada udara ruangan. Tidak tampak tanda syok. Tindakan awal yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Berikan oksigen suplemental melalui kanul nasal", "is_correct": True},
            {"id": "B", "text": "Torakosentesis segera", "is_correct": False},
            {"id": "C", "text": "Resusitasi cairan agresif", "is_correct": False},
            {"id": "D", "text": "Rontgen toraks sebelum pemberian oksigen", "is_correct": False},
            {"id": "E", "text": "Perikardiosentesis", "is_correct": False},
        ],
    },
    980052: {
        "prompt": "Apa prioritas sebelum merujuk pasien trauma yang sempat tidak stabil hemodinamik?",
        "narrative": "Seorang laki-laki 28 tahun dibawa ke IGD setelah kecelakaan lalu lintas. Saat datang pasien lemah, akral dingin, tekanan darah 90/60 mmHg, nadi 120 kali/menit, serta nyeri perut dan memar dada. Jalan napas bebas, saturasi 97% dengan nasal kanul, dan setelah penanganan awal tekanan darah membaik menjadi 100/70 mmHg. Karena keterbatasan fasilitas, pasien akan dirujuk. Prioritas sebelum dan selama rujukan adalah:",
        "options": [
            {"id": "A", "text": "Foto toraks dan abdomen terlebih dahulu", "is_correct": False},
            {"id": "B", "text": "CT scan abdomen sebelum stabilisasi", "is_correct": False},
            {"id": "C", "text": "Pemasangan WSD rutin", "is_correct": False},
            {"id": "D", "text": "Stabilisasi hemodinamik dengan resusitasi cairan", "is_correct": True},
            {"id": "E", "text": "Perikardiosentesis rutin", "is_correct": False},
        ],
    },
    980159: {
        "prompt": "Apa diagnosis mimpi buruk, avoidance, mudah kaget, dan flashback setelah trauma?",
        "narrative": "Ny. Sanny, 25 tahun, sering mengalami mimpi buruk berulang sejak 2 bulan setelah menyaksikan pembunuhan di dekat rumahnya. Ia sering terbangun dengan jantung berdebar dan berkeringat dingin, mudah terkejut bila melihat orang yang mirip pelaku, menghindari lokasi kejadian, dan merasa seolah kejadian tersebut terulang kembali saat melewatinya. Tidak ada halusinasi, waham, atau gangguan mood menonjol. Diagnosis yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Skizofrenia", "is_correct": False},
            {"id": "B", "text": "Gangguan cemas menyeluruh", "is_correct": False},
            {"id": "C", "text": "Skizoafektif", "is_correct": False},
            {"id": "D", "text": "Gangguan panik", "is_correct": False},
            {"id": "E", "text": "Gangguan stres pascatrauma", "is_correct": True},
        ],
    },
    980004: {
        "prompt": "Apa terapi herpes labialis dengan vesikel berkelompok pada bibir?",
        "narrative": "Seorang perempuan 24 tahun datang dengan lenting-lenting kecil berisi cairan pada bibir dan sudut mulut sejak 2 hari. Keluhan didahului rasa panas dan perih. Pemeriksaan menunjukkan vesikel berkelompok di atas dasar eritem, nyeri tekan, tanpa pus. Terapi yang paling sesuai adalah:",
        "options": [
            {"id": "A", "text": "Prednison", "is_correct": False},
            {"id": "B", "text": "Amoksisilin", "is_correct": False},
            {"id": "C", "text": "Asiklovir", "is_correct": True},
            {"id": "D", "text": "Setirizin", "is_correct": False},
            {"id": "E", "text": "Itrakonazol", "is_correct": False},
        ],
    },
    980015: {
        "prompt": "Berapa nilai modus dari data 0,60; 0,64; 0,69; 0,72; 0,69; 0,81; 0,69?",
        "narrative": "Pada sebuah penelitian diperoleh data 0,60; 0,64; 0,69; 0,72; 0,69; 0,81; 0,69. Nilai yang paling sering muncul adalah:",
        "options": [
            {"id": "A", "text": "0,60", "is_correct": False},
            {"id": "B", "text": "0,81", "is_correct": False},
            {"id": "C", "text": "0,72", "is_correct": False},
            {"id": "D", "text": "0,64", "is_correct": False},
            {"id": "E", "text": "0,69", "is_correct": True},
        ],
    },
    980049: {
        "prompt": "Apa pemeriksaan radiologis awal pada anak dengan hemoptisis kronik dan clubbing?",
        "narrative": "Anak laki-laki 6 tahun dibawa ke IGD dengan batuk berdarah sejak 1 bulan yang memberat saat aktivitas, disertai penurunan berat badan. Pemeriksaan fisik menunjukkan sianosis, clubbing finger, wheezing, dan ronki di lapang paru bawah. Pemeriksaan radiologis awal yang paling dianjurkan adalah:",
        "options": [
            {"id": "A", "text": "Bronkografi sebagai pemeriksaan pertama", "is_correct": False},
            {"id": "B", "text": "Foto toraks dekubitus kiri", "is_correct": False},
            {"id": "C", "text": "Foto toraks dekubitus kanan", "is_correct": False},
            {"id": "D", "text": "Foto toraks PA saja", "is_correct": False},
            {"id": "E", "text": "Foto toraks PA dan lateral", "is_correct": True},
        ],
    },
    980050: {
        "prompt": "Apa diagnosis sesak pascatrauma dengan hemitoraks hipersonor dan suara napas menurun?",
        "narrative": "Seorang laki-laki 24 tahun dibawa ke IGD setelah kecelakaan lalu lintas dengan sesak napas dan nyeri dada kanan. Frekuensi napas 32 kali/menit, nadi 118 kali/menit, tekanan darah 100/70 mmHg, dan saturasi 88% tanpa oksigen. Hemitoraks kanan tertinggal saat bernapas, fremitus menurun, perkusi hipersonor, dan suara napas kanan sangat menurun. Diagnosis yang paling sesuai adalah:",
        "options": [
            {"id": "A", "text": "Laserasi dada kanan", "is_correct": False},
            {"id": "B", "text": "Hematoma dada kanan", "is_correct": False},
            {"id": "C", "text": "Pneumotoraks", "is_correct": True},
            {"id": "D", "text": "Hemotoraks", "is_correct": False},
            {"id": "E", "text": "Tamponade jantung", "is_correct": False},
        ],
    },
    980053: {
        "prompt": "Apa tatalaksana TB paru kategori I bila BTA tetap positif setelah 2 bulan fase intensif?",
        "narrative": "Perempuan 46 tahun dengan TB paru BTA positif mendapat OAT kategori I dan pengawasan menelan obat baik. Setelah 2 bulan fase intensif, pemeriksaan dahak ulang masih BTA positif. Menurut pedoman program TB kategori lama, tatalaksana selanjutnya yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Langsung masuk fase lanjutan/intermiten", "is_correct": False},
            {"id": "B", "text": "Menghentikan OAT kategori I", "is_correct": False},
            {"id": "C", "text": "Memberikan pengobatan sisipan tambahan 1 bulan fase intensif", "is_correct": True},
            {"id": "D", "text": "Langsung mengganti menjadi OAT kategori II", "is_correct": False},
            {"id": "E", "text": "Mengganti menjadi OAT kategori III", "is_correct": False},
        ],
    },
    980054: {
        "prompt": "Apa obat controller profilaksis pada asma persisten ringan-sedang?",
        "narrative": "Seorang laki-laki 22 tahun memiliki riwayat asma sejak kecil. Dalam 3 bulan terakhir ia mengi dan sesak 2-3 kali per minggu serta terbangun malam 2 kali per bulan. Saat serangan ia membaik dengan salbutamol inhalasi. Obat controller jangka panjang untuk mengontrol inflamasi saluran napas adalah:",
        "options": [
            {"id": "A", "text": "Kortikosteroid inhalasi dosis rendah, misalnya budesonid", "is_correct": True},
            {"id": "B", "text": "Salbutamol saja sebagai controller harian", "is_correct": False},
            {"id": "C", "text": "Ipratropium sebagai terapi controller utama", "is_correct": False},
            {"id": "D", "text": "Deksametason sistemik jangka panjang", "is_correct": False},
            {"id": "E", "text": "Prednison sistemik jangka panjang", "is_correct": False},
        ],
    },
    980068: {
        "prompt": "Apa derajat serangan asma pada anak yang masih dapat bicara kalimat pendek dan berjalan?",
        "narrative": "Anak laki-laki 4 tahun dibawa ke IGD karena sesak napas sejak 6 jam disertai mengi. Anak masih sadar, dapat berbicara kalimat pendek, dan masih bisa berjalan, tetapi tampak sesak. Auskultasi menunjukkan wheezing ekspirasi bilateral tanpa ronki basah. Diagnosis derajat serangan yang paling sesuai adalah:",
        "options": [
            {"id": "A", "text": "Serangan asma ringan", "is_correct": False},
            {"id": "B", "text": "Serangan asma sedang", "is_correct": True},
            {"id": "C", "text": "Serangan asma berat", "is_correct": False},
            {"id": "D", "text": "Bronkiolitis", "is_correct": False},
            {"id": "E", "text": "Bronkopneumonia", "is_correct": False},
        ],
    },
    980083: {
        "prompt": "Apa warna fluoresensi lampu Wood pada pityriasis versicolor?",
        "narrative": "Seorang laki-laki 30 tahun datang dengan bercak hipopigmentasi di wajah dan leher sejak 2 bulan, gatal ringan saat berkeringat. Pemeriksaan menunjukkan makula hipopigmentasi multipel dengan skuama halus. Pada pityriasis versicolor, warna fluoresensi lampu Wood yang paling mungkin adalah:",
        "options": [
            {"id": "A", "text": "Kuning keemasan", "is_correct": True},
            {"id": "B", "text": "Merah", "is_correct": False},
            {"id": "C", "text": "Biru", "is_correct": False},
            {"id": "D", "text": "Hijau", "is_correct": False},
            {"id": "E", "text": "Violet", "is_correct": False},
        ],
    },
    980123: {
        "prompt": "Apa diagnosis kejang demam yang berulang dalam 24 jam?",
        "narrative": "Anak laki-laki 17 bulan dibawa ke IGD karena kejang disertai demam tinggi. Demam berlangsung 1 hari, suhu 40 derajat C. Kejang pertama di rumah berlangsung 4 menit, bersifat umum tonik-klonik, lalu berhenti. Saat tiba di IGD, kejang muncul kembali. Tidak ada riwayat kejang tanpa demam, kaku kuduk, atau defisit neurologis fokal. Diagnosis yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Kejang demam kompleks", "is_correct": True},
            {"id": "B", "text": "Kejang demam sederhana", "is_correct": False},
            {"id": "C", "text": "Epilepsi", "is_correct": False},
            {"id": "D", "text": "Meningitis", "is_correct": False},
            {"id": "E", "text": "Status epileptikus", "is_correct": False},
        ],
    },
    980137: {
        "prompt": "Apa pemeriksaan penunjang terbaik untuk konfirmasi herpes genital dari lesi aktif?",
        "narrative": "Seorang laki-laki 37 tahun memiliki vesikel dan erosi dangkal multipel pada glans penis sejak 5 hari, berawal dari vesikel berkelompok berisi cairan jernih di atas dasar eritem. Riwayat hubungan seksual berisiko ada. Pemeriksaan penunjang terbaik untuk mengonfirmasi herpes genital dari lesi aktif adalah:",
        "options": [
            {"id": "A", "text": "Pewarnaan Gram dan NaCl", "is_correct": False},
            {"id": "B", "text": "Kultur bakteri dari apusan", "is_correct": False},
            {"id": "C", "text": "VDRL dan TPHA", "is_correct": False},
            {"id": "D", "text": "PCR HSV dari swab lesi", "is_correct": True},
            {"id": "E", "text": "Tes antibodi monoklonal nonspesifik", "is_correct": False},
        ],
    },
    980152: {
        "prompt": "Apa antidotum overdosis opioid dengan miosis pinpoint dan depresi napas?",
        "narrative": "Seorang pria 28 tahun ditemukan tidak sadar di kamar kos dengan jarum suntik dan botol obat di sampingnya. Pemeriksaan menunjukkan GCS E2V2M4, tekanan darah 90/60 mmHg, nadi 50 kali/menit, frekuensi napas 8 kali/menit, pupil miosis pinpoint bilateral, dan bekas suntikan pada lengan. Antidotum yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Flumazenil", "is_correct": False},
            {"id": "B", "text": "Atropin", "is_correct": False},
            {"id": "C", "text": "N-asetilsistein", "is_correct": False},
            {"id": "D", "text": "Nalmefen", "is_correct": False},
            {"id": "E", "text": "Nalokson", "is_correct": True},
        ],
    },
    980155: {
        "prompt": "Apa diagnosis peningkatan energi, bicara banyak, belanja impulsif, dan kebutuhan tidur menurun?",
        "narrative": "Ny. Intan, 30 tahun, tampak sangat bersemangat selama 2 minggu, berbicara terus-menerus, sulit disela, sering menghabiskan uang untuk barang tidak perlu, berdandan mencolok, membuat banyak rencana, dan hanya tidur 2-3 jam per malam tanpa merasa lelah. Tidak ada riwayat penggunaan zat. Diagnosis yang paling sesuai adalah:",
        "options": [
            {"id": "A", "text": "Gangguan skizoafektif", "is_correct": False},
            {"id": "B", "text": "Episode manik pada gangguan bipolar", "is_correct": True},
            {"id": "C", "text": "Skizofrenia paranoid", "is_correct": False},
            {"id": "D", "text": "Gangguan penyesuaian", "is_correct": False},
            {"id": "E", "text": "Gangguan obsesif-kompulsif", "is_correct": False},
        ],
    },
    980156: {
        "prompt": "Antidepresan apa yang relatif aman pada pasien depresi dengan penyakit jantung koroner?",
        "narrative": "Seorang laki-laki 40 tahun merasa sangat sedih hampir sepanjang hari sejak 2 minggu, kehilangan minat, sulit berkonsentrasi, merasa tidak berharga, dan menarik diri. Tidak ada riwayat mania, psikosis, atau penggunaan zat. Tiga bulan lalu pasien dirawat karena penyakit jantung koroner. Terapi farmakologis yang relatif aman adalah:",
        "options": [
            {"id": "A", "text": "Sertralin", "is_correct": True},
            {"id": "B", "text": "Amitriptilin", "is_correct": False},
            {"id": "C", "text": "Litium", "is_correct": False},
            {"id": "D", "text": "Haloperidol", "is_correct": False},
            {"id": "E", "text": "Diazepam tunggal jangka panjang", "is_correct": False},
        ],
    },
    980166: {
        "prompt": "Apa tatalaksana akut sindrom neuroleptik maligna setelah penggunaan haloperidol?",
        "narrative": "Tn. Jamal, 32 tahun, mengalami penurunan kesadaran setelah 7 hari minum haloperidol. Pemeriksaan menunjukkan tekanan darah 160/100 mmHg, nadi 140 kali/menit, frekuensi napas 30 kali/menit, suhu 39 derajat C, diaforesis, dan rigiditas otot menyeluruh. Gambaran ini sesuai sindrom neuroleptik maligna. Tatalaksana akut yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Hentikan haloperidol, lakukan terapi suportif, dan berikan dantrolen atau bromokriptin", "is_correct": True},
            {"id": "B", "text": "Tambahkan risperidon", "is_correct": False},
            {"id": "C", "text": "Berikan metilfenidat", "is_correct": False},
            {"id": "D", "text": "Berikan donepezil", "is_correct": False},
            {"id": "E", "text": "Lanjutkan haloperidol dengan dosis lebih rendah saja", "is_correct": False},
        ],
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
    without_quality_flags(meta, {"readability_batch_salvage_hold"})
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["ukmppd_pdf_scribd_release_at"] = timestamp
    with_quality_flag(meta, "ukmppd_pdf_scribd_repaired")
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
