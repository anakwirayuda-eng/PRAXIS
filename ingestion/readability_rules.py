from __future__ import annotations

import re
from typing import Any


EXPLICIT_IMAGE_DEPENDENT_RE = re.compile(
    r"\b(?:"
    r"see image|see picture|see figure|"
    r"linked to image|question linked to image|"
    r"shown in (?:the )?image(?: [A-Z0-9])?|"
    r"shown in (?:the )?figure(?: [A-Z0-9])?|"
    r"pictured in (?:the )?image(?: [A-Z0-9])?|"
    r"depicted in (?:the )?image(?: [A-Z0-9])?|"
    r"image below|picture below|figure below|"
    r"following image|following figure|"
    r"electrocardiogram is shown below|ecg is shown below|ekg is shown below|"
    r"radiograph is shown below|x-?ray is shown below|"
    r"lesion in the picture|spirometry in image|"
    r"gambar\s+(?:berikut|di\s+bawah|seperti\s+berikut|di\s+samping)|"
    r"foto\s+(?:berikut|di\s+bawah|seperti\s+berikut|di\s+samping)|"
    r"pada\s+gambar(?:\s+berikut|\s+di\s+bawah|\s+di\s+samping)?|"
    r"seperti\s+(?:pada|di)\s+gambar|"
    r"seperti\s+(?:pada|di)\s+foto|"
    r"lihat gambar|lihat foto"
    r")\b",
    re.IGNORECASE,
)


def normalize_compact_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\r\n", "\n").replace("\r", "\n").split()).strip()


def is_explicit_image_dependent(*parts: Any) -> bool:
    combined = "\n".join(normalize_compact_text(part) for part in parts if normalize_compact_text(part))
    if not combined:
        return False
    return EXPLICIT_IMAGE_DEPENDENT_RE.search(combined) is not None
