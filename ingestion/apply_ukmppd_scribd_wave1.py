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
REPORT_FILE = ROOT / "ingestion" / "output" / "ukmppd_scribd_wave1_report.json"
BASIS = "deterministic:ukmppd-scribd-wave1"


FIXES: dict[int, dict[str, Any]] = {
    950048: {
        "prompt": "Apa tindakan awal pada anak dengan benda tajam tertancap di abdomen?",
        "narrative": "Anak 10 tahun dibawa ke puskesmas dengan besi tertancap pada perut dan ujungnya mencuat sekitar 12 cm. Apa tindakan paling tepat sebelum rujukan?",
        "options": [
            {"id": "A", "text": "Digoyangkan dengan lembut untuk melihat kedalaman luka", "is_correct": False},
            {"id": "B", "text": "Dibiarkan tanpa imobilisasi", "is_correct": False},
            {"id": "C", "text": "Dicabut segera", "is_correct": False},
            {"id": "D", "text": "Dicabut lalu menghentikan perdarahan", "is_correct": False},
            {"id": "E", "text": "Diamankan/diimobilisasi lalu dirujuk", "is_correct": True},
        ],
    },
    950169: {
        "prompt": "Bagaimana dokter menyampaikan berita kematian setelah RJP tidak berhasil?",
        "narrative": "Pasien mengalami henti jantung dan dilakukan RJP selama 30 menit. Setelah upaya resusitasi tidak berhasil, pasien dinyatakan meninggal dunia. Bagaimanakah dokter sebaiknya mengabarkan berita kematian kepada keluarga?",
        "options": [
            {"id": "A", "text": "Langsung menyampaikan saat itu juga tanpa menilai kesiapan keluarga", "is_correct": False},
            {"id": "B", "text": "Mengatakan penyakit pasien sudah parah", "is_correct": False},
            {"id": "C", "text": "Mengatakan seandainya pasien sampai ke RS lebih cepat mungkin tertolong", "is_correct": False},
            {"id": "D", "text": "Memberi tahu dan menjelaskan setelah keluarga pasien lebih tenang", "is_correct": True},
            {"id": "E", "text": "Menunggu tim dokter lain untuk menjelaskan penyebab kematian", "is_correct": False},
        ],
    },
    950170: {
        "prompt": "Apa langkah dokter bila pasien lanjut usia belum memahami informed consent setelah dijelaskan berulang?",
        "narrative": "Pasien 72 tahun sudah dijelaskan sebanyak tiga kali mengenai penyakit dan tindakan terbaik yang dapat dilakukan, namun pasien masih belum memahami. Sebagai dokter, langkah selanjutnya yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Langsung melakukan tindakan terbaik karena dokter sudah menjelaskan", "is_correct": False},
            {"id": "B", "text": "Meminta izin pasien untuk memanggil keluarga agar penjelasan dapat dibantu", "is_correct": True},
            {"id": "C", "text": "Meminta pasien menandatangani informed consent terlebih dahulu", "is_correct": False},
            {"id": "D", "text": "Tidak melakukan tindakan apa pun sebelum pasien mengerti sendiri", "is_correct": False},
            {"id": "E", "text": "Segera melakukan tindakan tanpa persetujuan tambahan", "is_correct": False},
        ],
    },
    950168: {
        "prompt": "Jenis pertanyaan apa pada anamnesis dengan jawaban ya/tidak?",
        "narrative": "Dokter berkata, 'Bapak dirujuk ke sini karena ada masalah pada kelenjar tiroid. Apakah Bapak ada keluhan berdebar-debar? Ada penurunan berat badan walaupun nafsu makan baik?' Pasien menjawab, 'Tidak, dok.' Bentuk pertanyaan yang digunakan dokter adalah:",
        "options": [
            {"id": "A", "text": "Pertanyaan terbuka", "is_correct": False},
            {"id": "B", "text": "Pertanyaan tertutup", "is_correct": True},
            {"id": "C", "text": "Evaluasi", "is_correct": False},
            {"id": "D", "text": "Asumsi", "is_correct": False},
            {"id": "E", "text": "Konklusi", "is_correct": False},
        ],
    },
    950077: {
        "prompt": "Apa terapi TB paru pada ibu hamil trimester pertama dengan BTA positif?",
        "narrative": "Wanita 22 tahun hamil 6 minggu datang dengan batuk sejak 3 bulan, berat badan selama kehamilan belum bertambah, dan keringat malam. Pemeriksaan BTA sputum SPS menunjukkan hasil +/+/- . Terapi yang sesuai adalah:",
        "options": [
            {"id": "A", "text": "OAT kategori I", "is_correct": True},
            {"id": "B", "text": "OAT kategori II", "is_correct": False},
            {"id": "C", "text": "INH saja", "is_correct": False},
            {"id": "D", "text": "Tidak perlu diterapi", "is_correct": False},
            {"id": "E", "text": "INH dan bisoprolol", "is_correct": False},
        ],
    },
    950008: {
        "prompt": "Obat antihipertensi apa yang tepat pada pasien diabetes dengan gangguan ginjal?",
        "narrative": "Pria 45 tahun datang untuk pemeriksaan kesehatan. Tekanan darah 150/100 mmHg, riwayat diabetes melitus 5 tahun, ureum 50 mg/dL, dan kreatinin 2,0 mg/dL. Obat hipertensi yang paling tepat diberikan adalah:",
        "options": [
            {"id": "A", "text": "Beta blocker", "is_correct": False},
            {"id": "B", "text": "Calcium channel blocker", "is_correct": False},
            {"id": "C", "text": "Diuretik", "is_correct": False},
            {"id": "D", "text": "ACE inhibitor", "is_correct": True},
            {"id": "E", "text": "DPP-4 inhibitor", "is_correct": False},
        ],
    },
    950010: {
        "prompt": "Bagaimana kontrol gula darah pada pasien DM dengan infeksi berat dan gangguan ginjal?",
        "narrative": "Wanita 50 tahun dengan hipertensi dan diabetes 10 tahun menggunakan glibenclamide dan metformin. Pasien demam tinggi 5 hari, terdapat luka bernanah di tungkai yang makin meluas, leukosit 15.000/mm3, dan kreatinin 2,1 mg/dL. Penatalaksanaan kontrol gula darah yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Teruskan glibenclamide dan metformin", "is_correct": False},
            {"id": "B", "text": "Teruskan glibenclamide dan hentikan metformin", "is_correct": False},
            {"id": "C", "text": "Hentikan glibenclamide dan teruskan metformin", "is_correct": False},
            {"id": "D", "text": "Ganti pengobatan dengan acarbose", "is_correct": False},
            {"id": "E", "text": "Ganti pengobatan dengan insulin", "is_correct": True},
        ],
    },
    950095: {
        "prompt": "Apa patofisiologi nyeri kepala migren?",
        "narrative": "Pada pasien dengan nyeri kepala berulang yang dicurigai migren, keluhan nyeri terjadi karena aktivasi sistem trigeminovaskular dan mediator/neurotransmiter yang merangsang nosiseptor intrakranial. Patofisiologi keluhan tersebut adalah:",
    },
    950073: {
        "prompt": "Apa tatalaksana ketuban pecah dini pada kehamilan 32 minggu dengan persalinan aktif?",
        "narrative": "Wanita 21 tahun G2P1A0 hamil 32 minggu datang dengan kontraksi makin kuat, keluar cairan dari jalan lahir sejak 8 jam, lendir bercampur darah, dan pembukaan serviks 2 cm. Tatalaksana yang tepat adalah:",
    },
    950057: {
        "prompt": "Apa diagnosis nyeri seluruh abdomen dan bising usus menghilang setelah trauma perut?",
        "narrative": "Pria 35 tahun dibawa ke IGD setelah kecelakaan lalu lintas. Terdapat jejas pada perut, bising usus menghilang, dan nyeri pada seluruh lapang abdomen. Kondisi yang terjadi pada pasien adalah:",
    },
    950059: {
        "prompt": "Apa diagnosis fraktur distal radius dengan angulasi volar?",
        "narrative": "Wanita 37 tahun datang ke UGD dengan nyeri dan sulit menggerakkan lengan kanan setelah jatuh. Pergelangan tangan kanan deformitas, neurovaskular distal baik, luka tidak ada. Foto antebrachii dextra AP-lateral menunjukkan fraktur distal radius dekstra dengan angulasi ventral. Diagnosis yang tepat adalah:",
    },
    950035: {
        "prompt": "Faktor risiko apa yang paling berpengaruh pada kanker payudara dalam kasus ini?",
        "narrative": "Perempuan 48 tahun datang dengan benjolan payudara kanan yang cepat membesar sejak 6 bulan. Pemeriksaan menunjukkan peau d'orange. Ibunya memiliki penyakit yang sama. Pasien menarche usia 9 tahun, menikah usia 13 tahun, dan melahirkan usia 14 tahun. Faktor yang paling berpengaruh adalah:",
    },
    950045: {
        "prompt": "Manuver terapi apa untuk BPPV dengan vertigo saat menoleh?",
        "narrative": "Wanita 33 tahun mengeluh pusing disertai mual terutama pagi hari. Keluhan bertambah ketika kepala menoleh ke kanan, tanpa tinnitus. Pemeriksaan menunjukkan nistagmus halus ke kanan. Manuver terapi yang tepat adalah:",
    },
    950141: {
        "prompt": "Apa tindakan dokter setelah pasien meninggal pasca-RJP di IGD?",
        "narrative": "Pria 56 tahun meninggal setelah dilakukan RJP selama 30 menit oleh dokter di IGD. Tindakan dokter yang tepat adalah:",
    },
    950142: {
        "prompt": "Apa langkah dokter bila pasien TB lanjut usia tetap bingung setelah penjelasan berulang?",
        "narrative": "Pria 78 tahun didiagnosis TB paru. Dokter sudah menjelaskan hasil pemeriksaan, penyakit, dan obat yang harus diminum sebanyak tiga kali, tetapi pasien tetap tampak bingung dan belum mengerti. Pasien datang sendiri, sementara anak yang mengurusnya menunggu di luar. Hal yang tepat dilakukan dokter adalah:",
        "options": [
            {"id": "A", "text": "Meminta izin pasien untuk memanggil keluarganya", "is_correct": True},
            {"id": "B", "text": "Langsung memanggil anak pasien tanpa meminta izin", "is_correct": False},
            {"id": "C", "text": "Menuliskan instruksi tertulis tanpa menemui keluarga", "is_correct": False},
            {"id": "D", "text": "Membiarkan pasien pulang karena dokter sudah menjelaskan", "is_correct": False},
            {"id": "E", "text": "Tidak ada pilihan yang tepat", "is_correct": False},
        ],
    },
    950143: {
        "prompt": "Apa tindakan dokter pada remaja yang menggunakan heroin dan meminta orang tua tidak diberi tahu?",
        "narrative": "Remaja 14 tahun diketahui menggunakan heroin saat pemeriksaan kesehatan. Ia meminta dokter agar tidak memberitahukan hasil pemeriksaan kepada orang tuanya. Tindakan yang paling tepat adalah:",
        "options": [
            {"id": "A", "text": "Mengikuti kemauan anak karena merupakan hak autonomi", "is_correct": False},
            {"id": "B", "text": "Mengikuti kemauan anak tetapi memberitahu orang tua secara diam-diam", "is_correct": False},
            {"id": "C", "text": "Tetap memberitahu orang tua pasien serta menjelaskan kebutuhan pengobatan dan rehabilitasi", "is_correct": True},
            {"id": "D", "text": "Memberitahu orang tua lalu langsung merujuk tanpa penjelasan", "is_correct": False},
            {"id": "E", "text": "Tidak ada jawaban yang tepat", "is_correct": False},
        ],
    },
    950186: {
        "prompt": "Apa pengobatan medikamentosa untuk ascariasis/infeksi cacing usus sederhana?",
        "narrative": "Pasien dengan infeksi cacing usus sederhana membutuhkan terapi antihelmintik lini pertama. Pengobatan medikamentosa yang tepat adalah:",
    },
    950084: {
        "prompt": "Apa diagnosis visus membaik dengan pinhole dan lensa sferis positif?",
        "narrative": "Pria 37 tahun datang dengan penurunan penglihatan. Visus 6/15 membaik dengan pinhole. Setelah diberi lensa sferis positif, visus menjadi 6/6. Diagnosis pada kasus ini adalah:",
    },
    950051: {
        "prompt": "Saraf apa yang terganggu pada cedera pleksus brakialis bagian bawah?",
        "narrative": "Remaja 16 tahun dibawa ke UGD karena luka pisau di daerah aksila. Dokter mencurigai cedera pleksus brakialis bagian bawah. Kemungkinan nervus yang mengalami kerusakan adalah:",
    },
    950100: {
        "prompt": "Apa jenis afasia dengan bicara tidak lancar, pemahaman relatif baik, dan repetisi terganggu?",
        "narrative": "Pasien 65 tahun pernah mengalami kelumpuhan mendadak sisi kiri 3 bulan lalu. Saat ini motoriknya membaik, tetapi ia sulit berkomunikasi: bicara tidak lancar, memahami pembicaraan orang, namun tidak dapat mengulang pembicaraan. Kelainan yang dialami adalah:",
    },
    951088: {
        "prompt": "Kondisi apa yang menjadi prasyarat pemeriksaan mati batang otak?",
        "narrative": "Pemeriksaan mati batang otak dilakukan pada pasien dengan koma dalam, tidak responsif, dan tidak ada respons neurologis bermakna. Keadaan yang sesuai sebagai prasyarat pemeriksaan adalah:",
        "options": [
            {"id": "A", "text": "Koma unresponsive/GCS 3 atau FOUR score 0", "is_correct": True},
            {"id": "B", "text": "Tidak adanya sikap tubuh abnormal saja", "is_correct": False},
            {"id": "C", "text": "Tidak adanya gerakan tidak terkoordinasi atau sentakan epileptik saja", "is_correct": False},
        ],
    },
    951095: {
        "prompt": "Apa tindakan bila inersia uteri disertai disproporsi sefalopelvik?",
        "narrative": "Pada persalinan lama, rencana tindakan ditentukan berdasarkan his, kemajuan persalinan, dan indikasi obstetrik. Bila inersia uteri disertai disproporsi sefalopelvik, tindakan yang tepat adalah:",
        "options": [
            {"id": "A", "text": "Lakukan augmentasi persalinan dengan infus oksitosin", "is_correct": False},
            {"id": "B", "text": "Seksio sesarea", "is_correct": True},
            {"id": "C", "text": "Observasi saja sampai his membaik", "is_correct": False},
        ],
    },
    950120: {
        "prompt": "Apa diagnosis waham bahwa tokoh terkenal mencintai pasien?",
        "narrative": "Perempuan 19 tahun sering bertengkar karena merasa teman-temannya mengejeknya. Ia yakin dirinya sangat menarik sehingga artis terkenal menyukai, mengikuti, dan memberi perhatian khusus kepadanya. Diagnosis yang tepat adalah:",
    },
    950123: {
        "prompt": "Apa diagnosis episode terbangun ketakutan tanpa mengingat mimpi?",
        "narrative": "Perempuan 22 tahun setiap hari mengalami episode seperti mimpi buruk, tetapi sama sekali tidak dapat mengingat isi mimpi. Ia sering bangun pagi dengan jantung berdebar dan berkeringat. Diagnosis yang tepat adalah:",
    },
    950128: {
        "prompt": "Apa diagnosis mimpi buruk, avoidance, sedih, mudah kaget, dan marah setelah trauma?",
        "narrative": "Perempuan 30 tahun mengalami mimpi buruk berulang sejak 3 bulan setelah anaknya meninggal dalam kecelakaan lalu lintas. Ia menghindari jalan tempat kejadian, merasa sedih, kehilangan minat memasak, mudah kaget, dan mudah marah. Diagnosis yang tepat adalah:",
    },
    950131: {
        "prompt": "Gejala apa pada jawaban pasien yang melompat dari satu ide ke ide tidak berkaitan?",
        "narrative": "Perempuan 34 tahun dibawa ke RSJ karena mengamuk. Saat ditanya mengapa berpakaian berantakan, ia menjawab, 'Tidak tahu saya dok kenapa begitu. Dokter bilang saya jelek? Harga mangga sedang naik-naiknya dok!' lalu tertawa. Gejala klinis pada anamnesis tersebut adalah:",
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
    without_quality_flags(meta, {"readability_batch_salvage_hold"})
    meta["avg_option_length"] = compute_avg_option_length(updated.get("options") or [])
    meta["readability_ai_pass"] = True
    meta["readability_ai_pass_basis"] = BASIS
    meta["ukmppd_scribd_release_at"] = timestamp
    with_quality_flag(meta, "ukmppd_scribd_repaired")
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
