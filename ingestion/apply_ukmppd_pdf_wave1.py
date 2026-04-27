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
REPORT_FILE = ROOT / "ingestion" / "output" / "ukmppd_pdf_wave1_report.json"
BASIS = "deterministic:ukmppd-pdf-wave1"


FIXES: dict[int, dict[str, Any]] = {
    16049: {
        "prompt": "Apa diagnosis lesi kulit serpiginosa yang sangat gatal setelah kontak tanah atau pasir?",
        "narrative": "Pasien datang dengan lesi eritematosa berkelok-kelok/serpiginosa pada kulit yang sangat gatal setelah sering kontak dengan tanah atau pasir. Diagnosis pada kelainan kulit tersebut adalah:",
    },
    54996: {
        "prompt": "Komplikasi syok apa yang paling mungkin pada trauma toraks dengan perdarahan intratoraks?",
        "narrative": "Seorang laki-laki dibawa ke UGD setelah kecelakaan lalu lintas dengan sesak napas dan nyeri dada. Pemeriksaan menunjukkan memar dada, hemitoraks kanan tertinggal, perkusi hipersonor/redup tidak simetris, dan gambaran trauma toraks dengan kecurigaan hemopneumotoraks atau perdarahan intratoraks. Komplikasi syok yang paling mungkin adalah:",
    },
    55008: {
        "prompt": "Apa diagnosis nyeri tungkai dengan parestesia dan nyeri pada peregangan pasif?",
        "narrative": "Laki-laki 21 tahun dibawa ke IGD dengan nyeri terbakar dan kesemutan pada tungkai kanan. Pasien tidak dapat menggerakkan kaki dan nyeri bertambah saat tungkai digerakkan secara pasif. Apa diagnosis paling mungkin?",
        "options": [
            {"id": "A", "text": "Ankle sprain", "is_correct": False},
            {"id": "B", "text": "Compartment syndrome", "is_correct": True},
            {"id": "C", "text": "Dislokasi genu", "is_correct": False},
            {"id": "D", "text": "Dislokasi ankle", "is_correct": False},
            {"id": "E", "text": "Fraktur tibia", "is_correct": False},
        ],
    },
    55039: {
        "prompt": "Foto polos regio apa yang tepat untuk cedera vertebra torakal VII?",
        "narrative": "Laki-laki 37 tahun mengalami cedera pada vertebra torakal VII dan terdapat penonjolan di daerah punggung. Foto polos regio apa yang tepat dilakukan?",
        "options": [
            {"id": "A", "text": "Thoracolumbal", "is_correct": False},
            {"id": "B", "text": "Lumbal", "is_correct": False},
            {"id": "C", "text": "Thoracosacral", "is_correct": False},
            {"id": "D", "text": "Thorakal", "is_correct": True},
            {"id": "E", "text": "Sacral", "is_correct": False},
        ],
    },
    55106: {
        "prompt": "Apa diagnosis vesikel unilateral yang bergerombol mengikuti dermatom torakal?",
        "narrative": "Pasien 60 tahun mengeluh panas dan nyeri dada disertai demam 38 derajat C. Pemeriksaan kulit menunjukkan vesikel unilateral yang bergerombol mengikuti arah costa/dermatom torakal. Apa diagnosis pada kasus ini?",
        "options": [
            {"id": "A", "text": "Varicella", "is_correct": False},
            {"id": "B", "text": "Variola", "is_correct": False},
            {"id": "C", "text": "Measles", "is_correct": False},
            {"id": "D", "text": "Herpes zoster", "is_correct": True},
        ],
    },
    55107: {
        "prompt": "Terapi antivirus yang sesuai untuk herpes zoster adalah:",
        "narrative": "Pasien dengan vesikel nyeri unilateral mengikuti dermatom torakal didiagnosis herpes zoster. Terapi antivirus yang sesuai adalah:",
        "options": [
            {"id": "A", "text": "Prednison", "is_correct": False},
            {"id": "B", "text": "Amoxicillin", "is_correct": False},
            {"id": "C", "text": "Acyclovir", "is_correct": True},
            {"id": "D", "text": "Cetirizine", "is_correct": False},
            {"id": "E", "text": "Itraconazole", "is_correct": False},
        ],
    },
    55142: {
        "prompt": "Apa diagnosis gatal kronis pada tungkai dengan plak likenifikasi?",
        "narrative": "Seorang wanita pensiunan datang dengan gatal kronis pada tungkai. Pemeriksaan kulit menunjukkan plak likenifikasi akibat garukan berulang. Apa diagnosis pasien ini?",
    },
    55143: {
        "prompt": "Apa diagnosis gatal pada kaki dengan lesi serpiginosa setelah kontak hewan peliharaan?",
        "narrative": "Seorang wanita datang dengan gatal pada kaki. Pasien memiliki anjing di rumah dan pemeriksaan menunjukkan lesi eritematosa berkelok-kelok/serpiginosa pada kaki. Diagnosis yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Ascariasis", "is_correct": False},
            {"id": "B", "text": "Taeniasis", "is_correct": False},
            {"id": "C", "text": "Trichuriasis", "is_correct": False},
            {"id": "D", "text": "Cutaneous larva migrans", "is_correct": True},
            {"id": "E", "text": "Strongyloidiasis", "is_correct": False},
        ],
    },
    55148: {
        "prompt": "Apa diagnosis plak eritematosa berskuama tebal pada siku, lutut, bokong, dan kulit kepala?",
        "narrative": "Laki-laki 36 tahun datang dengan bercak merah menebal di siku, lutut, dan bokong selama 5 bulan, disertai ketombe. Pemeriksaan dermatologis menunjukkan plak eritematosa dengan skuama tebal. Diagnosis kasus ini adalah:",
    },
    55156: {
        "prompt": "Etiologi kutil genital seperti jengger ayam adalah:",
        "narrative": "Perempuan 30 tahun datang dengan kutil di kemaluan sejak 2 bulan. Suaminya jarang pulang karena bekerja sebagai pelaut. Pemeriksaan menunjukkan lesi verukosa/papilomatosa seperti jengger ayam pada genital. Etiologi paling mungkin adalah:",
        "options": [
            {"id": "A", "text": "Poxvirus", "is_correct": False},
            {"id": "B", "text": "Human papillomavirus", "is_correct": True},
            {"id": "C", "text": "Herpes simplex virus tipe I", "is_correct": False},
            {"id": "D", "text": "Herpes simplex virus tipe II", "is_correct": False},
            {"id": "E", "text": "Human immunodeficiency virus", "is_correct": False},
        ],
    },
    55181: {
        "prompt": "Apa diagnosis anak dengan pruritus ani terutama malam hari?",
        "narrative": "Ibu membawa anak 3 tahun dengan gatal di sekitar anus sejak 1 minggu. Keluhan membuat anak rewel dan sulit tidur pada malam hari, tanpa demam atau muntah. Diagnosis yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Taeniasis", "is_correct": False},
            {"id": "B", "text": "Ascariasis", "is_correct": False},
            {"id": "C", "text": "Enterobiasis", "is_correct": True},
            {"id": "D", "text": "Ancylostomiasis", "is_correct": False},
            {"id": "E", "text": "Strongyloidiasis", "is_correct": False},
        ],
    },
    55184: {
        "prompt": "Apa diagnosis anak demam-sesak dengan infiltrat homogen bilateral pada foto toraks?",
        "narrative": "Anak laki-laki 6 tahun datang dengan sesak dan demam sejak 2 hari. Nadi 118x/menit, respiratory rate 33x/menit, dan suhu 39,1 derajat C. Foto toraks menunjukkan perselubungan homogen di kedua lapangan paru. Apakah diagnosis pasien tersebut?",
        "options": [
            {"id": "A", "text": "Efusi pleura", "is_correct": False},
            {"id": "B", "text": "Asma bronkiale", "is_correct": False},
            {"id": "C", "text": "Pneumonia", "is_correct": True},
            {"id": "D", "text": "Schwarte", "is_correct": False},
            {"id": "E", "text": "Atelektasis", "is_correct": False},
        ],
    },
    55187: {
        "prompt": "Apa pemeriksaan awal yang tepat pada bayi bergejala dengan kontak erat TB?",
        "narrative": "Bayi 3 bulan mengalami demam sejak 1 bulan disertai penurunan berat badan. Ibu pasien batuk berdahak selama 1 bulan dan sedang menjalani terapi OAT. Apa yang sebaiknya dilakukan pada bayi?",
        "options": [
            {"id": "A", "text": "Melakukan vaksinasi BCG", "is_correct": False},
            {"id": "B", "text": "Memberikan profilaksis isoniazid selama 3 bulan", "is_correct": False},
            {"id": "C", "text": "Memberi terapi OAT selama 6-9 bulan", "is_correct": False},
            {"id": "D", "text": "Melakukan uji tuberkulin", "is_correct": False},
            {"id": "E", "text": "Melakukan pemeriksaan foto toraks", "is_correct": True},
        ],
    },
    55190: {
        "prompt": "Apa diagnosis anak dengan kavitas paru berisi air-fluid level?",
        "narrative": "Anak 1 tahun datang dengan batuk, demam, dahak kuning, napas cuping hidung, dan retraksi. Foto toraks menunjukkan massa kistik/kavitas dengan air-fluid level. Diagnosis yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Bronkiektasis", "is_correct": False},
            {"id": "B", "text": "TBC", "is_correct": False},
            {"id": "C", "text": "Bronkiolitis", "is_correct": False},
            {"id": "D", "text": "Abses paru", "is_correct": True},
            {"id": "E", "text": "Bronkopneumonia", "is_correct": False},
        ],
    },
    55215: {
        "prompt": "Apa gambaran radiologis yang khas pada respiratory distress syndrome neonatus prematur?",
        "narrative": "Bayi laki-laki lahir spontan usia gestasi 32 minggu. APGAR menit pertama 7 dan menit kelima 8. Bayi merintih, retraksi saat bernapas, nadi 170x/menit, respiratory rate 80x/menit, dan tampak akrosianosis. Apa kemungkinan gambaran radiologis paru?",
    },
    55218: {
        "prompt": "Pemeriksaan penunjang etiologis untuk hidrosefalus dan korioretinitis kongenital adalah:",
        "narrative": "Bayi 4 bulan dibawa ke RS karena kepala membesar. Pemeriksaan menunjukkan hidrosefalus dan korioretinitis, sehingga dicurigai toksoplasmosis kongenital. Pemeriksaan penunjang etiologis yang tepat adalah:",
    },
    55227: {
        "prompt": "Derajat serangan asma akut pada anak ini adalah:",
        "narrative": "Anak 10 tahun datang ke IGD dengan sesak setelah kerja bakti di sekolah. Ada riwayat sesak berulang dan sudah pernah berobat ke dokter. Nadi 92x/menit, tanpa tanda kegawatan berat seperti sianosis, penurunan kesadaran, atau tidak mampu bicara. Derajat serangan asma akut pada anak ini adalah:",
    },
    55237: {
        "prompt": "Pemeriksaan apa yang dianjurkan pada anak bergejala dengan kontak erat TB?",
        "narrative": "Anak 10 tahun mengalami batuk berdahak dan demam selama 2 minggu. Ia tinggal dengan paman yang memiliki keluhan serupa dan sudah menjalani pengobatan selama 6 bulan. Pemeriksaan apa yang dianjurkan untuk anak tersebut?",
    },
    55244: {
        "prompt": "Apa tindakan dokter untuk surveilans kasus yang perlu dilaporkan di wilayah kerja?",
        "narrative": "Di suatu daerah, dokter menemukan kasus penyakit/kejadian yang perlu masuk sistem surveilans wilayah kerja. Agar kasus tercatat dan ditindaklanjuti melalui jalur kesehatan masyarakat setempat, tindakan dokter yang tepat adalah:",
    },
    55256: {
        "prompt": "Penyakit mana pada laporan puskesmas yang termasuk kejadian luar biasa?",
        "narrative": "Puskesmas menerima laporan beberapa penyakit infeksi dan non-infeksi terbanyak. Dari pilihan yang ada, penyakit yang termasuk kejadian luar biasa dan harus segera diwaspadai/dilaporkan adalah:",
    },
    55282: {
        "prompt": "Nilai tengah yang paling sesuai dari deret data penelitian berikut adalah:",
        "narrative": "Dari sebuah penelitian didapatkan deret nilai: 0,52; 0,54; 0,60; 0,60; 0,63; 0,63; 0,64; 0,64; 0,65; 0,67; 0,69; 0,71; 0,71; 0,72; 0,77; 0,80; 0,80; 0,81; 0,81. Nilai tengah yang paling sesuai dari pilihan berikut adalah:",
    },
    55287: {
        "prompt": "Dalam advokasi kesehatan, audiensi hasil penelitian ke DPR termasuk tahap:",
        "narrative": "Sekelompok remaja meneliti bahaya rokok, lalu melakukan audiensi ke DPR RI. Setelah itu lahir peraturan bahwa kemasan rokok wajib menampilkan gambar bahaya rokok dan peringatan kesehatan. Dalam segi advokasi, tindakan remaja tersebut termasuk:",
    },
    55288: {
        "prompt": "Berapakah relative risk bila risiko kelompok memakai helm adalah setengah kelompok tanpa helm?",
        "narrative": "Pada penelitian hubungan penggunaan helm dengan kejadian cedera/kecelakaan, risiko kejadian pada kelompok memakai helm adalah 20/80, sedangkan pada kelompok tidak memakai helm adalah 40/80. Relative risk pengguna helm dibanding tidak menggunakan helm adalah:",
    },
    55294: {
        "prompt": "Apa diagnosis nyeri sendi jari dengan kaku pagi sekitar 1 jam?",
        "narrative": "Laki-laki 77 tahun datang dengan nyeri pada jari-jari tangan disertai kaku pada pagi hari selama sekitar 1 jam. Diagnosis pada kasus ini adalah:",
    },
    55295: {
        "prompt": "Etiologi anemia dengan nyeri perut dan dugaan telur cacing tambang adalah:",
        "narrative": "Wanita 30 tahun datang dengan nyeri perut, pucat, dan lemas. Pemeriksaan menunjukkan konjungtiva pucat, tanda vital stabil, dan mikroskopis feses mengarah ke telur cacing tambang. Etiologi kasus ini adalah:",
    },
    55297: {
        "prompt": "Apa diagnosis petani/pemetik kebun dengan anemia dan telur cacing tambang?",
        "narrative": "Wanita 35 tahun datang ke puskesmas dengan lemas dan konjungtiva pucat. Pasien bekerja sebagai pemetik kebun teh dan pemeriksaan mikroskopis mengarah ke telur cacing tambang. Kemungkinan diagnosis pada kasus tersebut adalah:",
    },
    55300: {
        "prompt": "Komplikasi berbahaya dari trombosis vena dalam tungkai adalah:",
        "narrative": "Pasien datang dengan nyeri tungkai bawah dan pemeriksaan fisik mengarah ke trombosis vena dalam. Komplikasi berbahaya yang dapat terjadi pada kondisi ini adalah:",
    },
    55320: {
        "prompt": "Antibiotik oral yang tepat untuk demam tifoid tanpa komplikasi di puskesmas adalah:",
        "narrative": "Laki-laki 37 tahun datang ke puskesmas dengan demam 7 hari disertai nyeri perut, mual, muntah, dan lidah putih. Tidak ada tanda komplikasi atau kondisi berat yang membutuhkan rawat inap. Antibiotik oral yang tepat dari pilihan berikut adalah:",
    },
    55397: {
        "prompt": "Tatalaksana farmakologis awal untuk edema paru kardiogenik akut adalah:",
        "narrative": "Perempuan 65 tahun dibawa ke UGD dengan sesak napas berat sejak 30 menit. Satu bulan terakhir sesak makin berat dan pasien tidur dengan 3-4 bantal. Pemeriksaan menunjukkan takikardia, takipnea, kardiomegali, gallop, wheezing, ronki basah basal bilateral, dan foto dada batwing appearance. Tatalaksana farmakologis paling tepat adalah:",
    },
    55446: {
        "prompt": "Diagnosis sesak ortopnea dengan edema paru pada pasien hipertensi adalah:",
        "narrative": "Pria 70 tahun datang ke IGD dengan sesak sejak 1 hari. Keluhan memberat saat berbaring dan membaik saat duduk. Riwayat hipertensi tidak rutin berobat, terdapat pembengkakan kedua kaki, dan radiologi menunjukkan edema paru. Diagnosis yang tepat adalah:",
    },
    55462: {
        "prompt": "Pemeriksaan segera pada nyeri dada tipikal sindrom koroner akut adalah:",
        "narrative": "Laki-laki 45 tahun datang ke UGD dengan nyeri dada kiri seperti tertindih beban berat selama lebih dari 30 menit dan menjalar ke lengan kiri. Tekanan darah 140/90 mmHg, nadi 100x/menit, respiratory rate 20x/menit. Penanganan/pemeriksaan selanjutnya yang segera dilakukan adalah:",
    },
    55463: {
        "prompt": "Tatalaksana awal edema paru kardiogenik dengan kongesti paru adalah:",
        "narrative": "Perempuan 65 tahun datang ke UGD dengan sesak akut. Selama 1 bulan sesak makin berat dan pasien tidur dengan 3-4 bantal. Pemeriksaan menunjukkan hipertensi lama, takikardia, takipnea, kardiomegali, gallop, wheezing, ronki basah basal bilateral, dan foto dada dengan batwing appearance. Tatalaksana yang tepat adalah:",
    },
    55473: {
        "prompt": "Apa diagnosis batuk darah masif dengan sputum purulen berbau dan honeycomb basal?",
        "narrative": "Laki-laki 35 tahun datang ke UGD dengan batuk darah masif sejak 1 jam. Ia batuk berdahak kehijauan berbau busuk terutama pagi hari sejak 1 bulan. Pemeriksaan menunjukkan clubbing finger, ronki kasar di kedua basal paru, dan radiologi tampak honeycomb appearance di kedua basal paru. Diagnosis yang tepat adalah:",
    },
    55490: {
        "prompt": "Pemeriksaan objektif untuk menentukan derajat keparahan asma adalah:",
        "narrative": "Seorang wanita memiliki riwayat sesak kambuh terutama saat terpapar debu. Keluarga memiliki riwayat asma dan pasien sudah rutin berobat. Pemeriksaan yang dapat digunakan untuk menentukan derajat keparahan pasien adalah:",
    },
    55495: {
        "prompt": "Apa diagnosis sesak pascatrauma dengan hemitoraks kanan redup dan suara napas menurun?",
        "narrative": "Laki-laki 40 tahun datang dengan sesak dan nyeri dada kanan. Tekanan darah 90/60 mmHg, nadi 120x/menit, dan respiratory rate 30x/menit. Pemeriksaan menunjukkan pergerakan dinding dada kanan tertinggal, perkusi dada kanan redup, dan suara napas vesikuler menurun. Diagnosis kasus ini adalah:",
        "options": [
            {"id": "A", "text": "PPOK eksaserbasi akut", "is_correct": False},
            {"id": "B", "text": "Asma", "is_correct": False},
            {"id": "C", "text": "Pneumotoraks dextra", "is_correct": False},
            {"id": "D", "text": "Hemotoraks dextra", "is_correct": True},
            {"id": "E", "text": "Atelektasis", "is_correct": False},
        ],
    },
    55580: {
        "prompt": "Apa diagnosis nyeri payudara pada ibu 1 minggu postpartum yang menyusui?",
        "narrative": "Wanita 30 tahun datang dengan nyeri pada payudara. Pasien baru melahirkan anak pertama 1 minggu lalu dan sedang memberikan ASI eksklusif. Diagnosis yang tepat adalah:",
    },
    55626: {
        "prompt": "Apa diagnosis nyeri kepala hebat mendadak disertai kaku kuduk?",
        "narrative": "Wanita 50 tahun datang ke UGD dengan nyeri kepala hebat mendadak sejak 2 jam. Pemeriksaan menunjukkan nadi 100x/menit, respiratory rate 24x/menit, refleks patologis positif, dan kaku kuduk. Apa diagnosis paling tepat?",
    },
}


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
    without_quality_flags(
        meta,
        {
            "readability_batch_salvage_hold",
            "ukmppd_pdf_missing_image_context",
            "ukmppd_pdf_missing_stem_context",
            "ukmppd_pdf_ocr_cleaned",
        },
    )
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["ukmppd_pdf_release_at"] = timestamp
    with_quality_flag(meta, "ukmppd_pdf_repaired")
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
