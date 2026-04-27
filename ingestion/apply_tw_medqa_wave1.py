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
REPORT_FILE = ROOT / "ingestion" / "output" / "tw_medqa_wave1_report.json"
BASIS = "deterministic:tw-medqa-wave1"


FIXES: dict[int, dict[str, str]] = {
    64723: {
        "prompt": "Diagnosis apa yang paling mungkin pada bula flaksid dengan deposisi IgG interselular epidermis?",
        "narrative": "Seorang pria paruh baya memiliki lesi bula/erosif pada kulit. Biopsi menunjukkan akantolisis intraepidermal, dan imunofluoresensi langsung menunjukkan deposisi IgG di antara sel-sel epidermis dengan pola seperti jala. Diagnosis yang paling mungkin adalah:",
    },
    64602: {
        "prompt": "Pernyataan manakah yang salah tentang infeksi tungkai diabetik dengan krepitus dan syok sepsis?",
        "narrative": "Pria 65 tahun dengan diabetes datang ke UGD dengan tekanan darah 87/55 mmHg, nadi 120x/menit, suhu 39 derajat C, dan nyeri hebat pada kaki kiri. Kaki tampak eritematosa, bengkak, sangat nyeri tekan, dan terdapat krepitus. Kondisi ini mengarah ke fasciitis nekrotikans dengan syok sepsis. Pernyataan manakah yang salah?",
    },
    64178: {
        "prompt": "Diagnosis dan terapi terbaik untuk hipomenore setelah beberapa aborsi dengan adhesi intrauterin adalah:",
        "narrative": "Perempuan 30 tahun mengalami penurunan volume menstruasi yang sangat signifikan setelah beberapa kali aborsi. Histeroskopi menunjukkan adhesi intrauterin. Diagnosis dan pengobatan yang paling tepat adalah:",
    },
    63426: {
        "prompt": "Apa diagnosis cedera bahu setelah jatuh dengan temuan dislokasi posterior dan impaksi?",
        "narrative": "Pria 25 tahun jatuh dalam kecelakaan mobil dengan bahu menghantam tanah. Ia mengalami nyeri dan keterbatasan gerak sendi bahu kanan. Foto AP dan aksila menunjukkan dislokasi posterior bahu disertai impaksi. Apa diagnosis cedera bahu pasien ini?",
    },
    63765: {
        "prompt": "Jenis fraktur apa yang ditunjukkan oleh radiograf talus pada pergelangan kaki?",
        "narrative": "Radiograf pergelangan kaki/kaki menunjukkan fraktur pada tulang talus. Jenis patah tulang apa yang paling sesuai?",
    },
    64062: {
        "prompt": "Apa diagnosis fraktur ulna proksimal dengan dislokasi kepala radius?",
        "narrative": "Perempuan 39 tahun mengalami cedera akibat kecelakaan mobil. X-ray lengan atas/siku menunjukkan fraktur ulna proksimal disertai dislokasi kepala radius. Diagnosis yang tepat adalah:",
    },
    63415: {
        "prompt": "Apa diagnosis ruam lipatan paha dengan pustula satelit dan pseudohifa pada KOH?",
        "narrative": "Pria 70 tahun yang tirah baring mengalami bercak merah di selangkangan dan paha bagian dalam dengan pustula satelit di sekitarnya. Pemeriksaan KOH menunjukkan ragi/pseudohifa. Apa diagnosisnya?",
    },
    63534: {
        "prompt": "Apa diagnosis ruam hipopigmentasi/hiperpigmentasi rekuren dengan pola spaghetti and meatballs pada KOH?",
        "narrative": "Pria 35 tahun mengeluh setiap musim panas muncul ruam putih dan coklat di tubuhnya. Pemeriksaan KOH menemukan pola spaghetti and meatballs. Pasien ini kemungkinan besar menderita:",
    },
    63967: {
        "prompt": "Pernyataan apa yang benar tentang lesi hati kistik yang mengobstruksi duktus biliaris kiri?",
        "narrative": "Pria 59 tahun datang dengan keluhan kembung. CT menunjukkan lesi kistik hepatobilier di sisi kiri/hilus hati yang menyebabkan dilatasi atau obstruksi saluran empedu kiri. Jaringan diangkat dengan laparoskopi. Pernyataan mana yang benar?",
    },
    64078: {
        "prompt": "Apa diagnosis lesi vesikular nyeri unilateral di dahi dengan sulit membuka mata?",
        "narrative": "Pria 85 tahun baru 2 hari mengalami lesi vesikular nyeri pada dahi kiri, disertai nyeri lokal dan sulit membuka mata. Apa diagnosis yang paling mungkin?",
    },
    64332: {
        "prompt": "Kelainan apa yang paling mungkin pada bayi dengan murmur sistolik, takipnea, retraksi, dan gagal tumbuh?",
        "narrative": "Bayi perempuan 3 bulan sejak lahir memiliki bising sistolik di tepi kiri sternum. Satu bulan kemudian ia menyusu lebih lama, berat badan naik lambat, bernapas sangat cepat saat berbaring, dan tampak retraksi. Foto dada/elektrokardiogram mendukung overload paru akibat shunt. Kelainan yang paling mungkin adalah:",
    },
    64477: {
        "prompt": "Apa diagnosis makula coklat berbintik lebih gelap yang stabil selama 2-3 tahun?",
        "narrative": "Pria 30 tahun memiliki lesi makula coklat di lengan bawah kiri sejak 2-3 tahun, berupa bercak dasar coklat muda dengan bintik-bintik lebih gelap di dalamnya. Diagnosis yang paling sesuai adalah:",
    },
    64527: {
        "prompt": "Apa diagnosis ruam bersisik di dada-punggung dengan KOH spaghetti and meatballs?",
        "narrative": "Pria 20 tahun mengalami ruam merah-coklat berulang setiap musim panas. Pemeriksaan menemukan banyak makula/plak bulat pipih bersisik berwarna merah muda di dada dan punggung, sebagian menyatu. KOH menunjukkan pola spaghetti and meatballs. Penyakit yang paling mungkin adalah:",
    },
    64686: {
        "prompt": "Pernyataan apa yang benar tentang alopecia areata pada anak?",
        "narrative": "Anak laki-laki 10 tahun tiba-tiba mengalami area kebotakan berbatas tegas di kulit kepala tanpa gatal atau nyeri, sesuai alopecia areata. Mengenai penyakit ini, pernyataan manakah yang benar?",
    },
    64706: {
        "prompt": "Apa diagnosis batuk 2 bulan, penurunan berat badan, dan massa paru pada rontgen dada?",
        "narrative": "Nyonya Lin mengalami batuk selama 2 bulan dan penurunan berat badan. Rontgen dada menunjukkan massa paru yang mencurigakan. Diagnosis yang paling mungkin adalah:",
    },
    63593: {
        "prompt": "Lesi serviks apa yang paling mungkin ditunjukkan oleh MRI pelvis pada wanita 65 tahun?",
        "narrative": "Wanita 65 tahun menjalani MRI pelvis. Pemeriksaan menunjukkan massa yang berasal dari serviks dan menggantikan jaringan serviks. Temuan tersebut paling mungkin menunjukkan:",
    },
    63837: {
        "prompt": "Apa diagnosis bayi dengan massa jaringan lunak vaskular, anemia, trombositopenia, schistocytes, dan D-dimer tinggi?",
        "narrative": "Bayi perempuan 14 minggu datang dengan pertumbuhan cepat jaringan lunak di kaki. Massa sangat lunak, disertai anemia ringan, trombositopenia, fragmen eritrosit pada apus darah, dan D-dimer meningkat. Penyakit yang paling mungkin adalah:",
    },
    63842: {
        "prompt": "Bagaimana interpretasi urodinamik dengan sensasi pertama 146 mL, strong desire 325 mL, dan kapasitas 474 mL?",
        "narrative": "Wanita 45 tahun mengeluh sering berkemih, urgensi, dan inkontinensia urin. Urodinamik menunjukkan dorongan berkemih pertama pada 146 mL, dorongan kuat pada 325 mL, estimasi kapasitas kandung kemih 474 mL, tanpa kontraksi detrusor patologis yang jelas. Hasil pemeriksaan ini seharusnya:",
    },
    64424: {
        "prompt": "Apa diagnosis lesi hati hiperekoik dengan enhancement perifer nodular dan fill-in pada CT dinamis?",
        "narrative": "Wanita 45 tahun menjalani USG hati saat pemeriksaan kesehatan dan ditemukan lesi hiperekoik di bagian posterior lobus kanan hati. CT dinamis menunjukkan enhancement perifer nodular dengan pengisian bertahap ke sentral. Diagnosis paling mungkin adalah:",
    },
    64427: {
        "prompt": "Pemeriksaan apa yang membantu diagnosis fenomena Raynaud dan nekrosis dingin pada pasien multiple myeloma?",
        "narrative": "Pria 74 tahun dengan multiple myeloma remisi mengalami jari tangan kiri menjadi putih lalu ungu saat musim dingin, kemudian kulit telinga kanan menjadi hitam dan nekrotik. Pemeriksaan apa yang paling membantu untuk diagnosis?",
    },
    64645: {
        "prompt": "Apa diagnosis psoriasis dengan jari sosis, DIP arthritis, dan kuku menebal rapuh?",
        "narrative": "Pasien 61 tahun dengan psoriasis selama 7 tahun mengalami pembengkakan kedua sisi jari seperti jari sosis, inflamasi sendi interphalangeal distal, serta kuku menebal dan rapuh. Diagnosis paling tepat adalah:",
    },
    64755: {
        "prompt": "Apa diagnosis tumor epifisis pada pria muda dengan lesi litik di sekitar lutut?",
        "narrative": "Pria 23 tahun tanpa riwayat khusus menjalani pemeriksaan karena cedera lutut kiri, dan secara tidak sengaja ditemukan tumor epifisis berupa lesi litik di sekitar lutut pada X-ray/CT. Diagnosis paling mungkin adalah:",
    },
    64776: {
        "prompt": "Apa diagnosis lesi betis yang hangat, nyeri, bengkak, dan disertai limfadenitis inguinal?",
        "narrative": "Pria 70 tahun mengalami lesi kulit nyeri pada betis kiri sejak 2 hari. Lesi terasa hangat, nyeri tekan, bengkak, dan disertai pembengkakan serta nyeri kelenjar getah bening inguinal kiri. Diagnosis yang paling mungkin adalah:",
    },
    63467: {
        "prompt": "Kondisi apa yang paling sesuai dengan cairan serebrospinal berisi banyak neutrofil/pus?",
        "narrative": "Pemeriksaan mikroskopik cairan serebrospinal menunjukkan banyak neutrofil dan gambaran purulen. Kondisi apa yang paling sesuai?",
    },
    63693: {
        "prompt": "Apa diagnosis anak dengan gait spastik abnormal?",
        "narrative": "Seorang anak berjalan dengan pola gait abnormal berupa kekakuan/spastisitas ekstremitas bawah. Diagnosis yang paling mungkin adalah:",
    },
    63696: {
        "prompt": "Masalah apa bila gambar rumah, bunga, dan jam pasien mengabaikan sisi kiri?",
        "narrative": "Pada tes menggambar rumah, bunga, dan jam, pasien menggambar terutama sisi kanan dan mengabaikan detail di sisi kiri kertas. Masalah apa yang dialami pasien ini?",
    },
    63861: {
        "prompt": "Lokasi lesi apa yang sesuai dengan gangguan pendengaran mendadak dan kelainan hanya pada latensi gelombang I ABR?",
        "narrative": "Pria 25 tahun mengalami penurunan pendengaran mendadak telinga kanan dan tinnitus frekuensi tinggi tanpa vertigo, otore, atau nyeri telinga. Audiometri menunjukkan gangguan sensorineural, dan auditory brainstem response saat stimulasi telinga kanan hanya menunjukkan kelainan latensi gelombang I, sedangkan latensi lain normal. Lokasi lesi paling mungkin adalah:",
    },
    63466: {
        "prompt": "Apa diagnosis panah USG pada perdarahan abnormal dengan benang IUD tidak tampak?",
        "narrative": "Wanita 26 tahun, para 3, mengalami perdarahan vagina abnormal. Ia memakai alat kontrasepsi dalam rahim selama 3 tahun. Pemeriksaan menunjukkan serviks halus, darah keluar dari kanalis serviks, benang IUD tidak tampak, rahim berukuran normal, dan USG transvaginal menunjukkan benda intrauterin. Panah paling sesuai dengan diagnosis:",
    },
    64237: {
        "prompt": "Pemeriksaan apa yang paling membantu memastikan endometriosis?",
        "narrative": "Wanita 32 tahun mengeluh dismenore yang makin berat selama beberapa tahun, nyeri saat berhubungan seksual, dan nyeri perut di luar masa haid. USG menunjukkan lesi yang mencurigakan endometriosis/endometrioma. Pemeriksaan apa yang paling membantu memastikan diagnosis?",
    },
    64441: {
        "prompt": "Apa diagnosis USG janin dengan ventrikel tunggal/fusi struktur garis tengah otak?",
        "narrative": "Wanita hamil 28 tahun G2P1 pada usia kehamilan 16 minggu menjalani USG. Temuan menunjukkan kelainan garis tengah otak dengan ventrikel tunggal/fusi struktur garis tengah. Diagnosis paling mungkin adalah:",
    },
    64447: {
        "prompt": "Apa diagnosis nyeri perut kanan bawah, perdarahan vagina, hCG positif, dan massa adneksa?",
        "narrative": "Wanita 23 tahun mengalami perdarahan vagina selama 7 hari, nyeri perut kanan bawah yang makin berat, nyeri tekan uterus dan adneksa kanan, massa adneksa kanan 3,5 x 3,8 cm pada USG, dan tes kehamilan urin positif. Laparoskopi menunjukkan kehamilan di luar kavum uteri. Diagnosis paling sesuai adalah:",
    },
    64748: {
        "prompt": "Apa diagnosis CT nonkontras dengan lesi adneksa berdensitas tinggi dan cairan pelvis berdensitas tinggi?",
        "narrative": "Wanita 25 tahun datang ke UGD karena nyeri perut hebat. CT tanpa kontras menunjukkan lesi berdensitas tinggi di sisi ovarium/tuba dan cairan pelvis berdensitas tinggi yang mengarah ke perdarahan intraperitoneal. Diagnosis paling mungkin adalah:",
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


def apply_fix(current: dict[str, Any], fix: dict[str, str], timestamp: str) -> dict[str, Any]:
    updated = deepcopy(current)
    updated["prompt"] = normalize_text(fix["prompt"])
    updated["title"] = normalize_text(fix["prompt"])

    vignette = updated.get("vignette")
    if isinstance(vignette, dict):
        vignette["narrative"] = normalize_text(fix["narrative"])
    else:
        updated["vignette"] = {"narrative": normalize_text(fix["narrative"])}

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
    meta["tw_medqa_release_at"] = timestamp
    with_quality_flag(meta, "tw_medqa_repaired")
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
