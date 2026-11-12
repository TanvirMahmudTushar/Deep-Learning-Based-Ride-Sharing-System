"""BRTA (Bangladesh Road Transport Authority) vehicle registration specification.

Format: <A> <B>-<C>
where:
A: Region Specifier
B: BRTA Vehicle Class Letter Code
C: Six-digit plate number in XX-XXXX format
Example: DHAKA METRO HA-11-2408
"""

import re

# (CODE, BENGALI_PLATE_TEXT)
BRTA_REGIONS: list[tuple[str, str]] = [
    ("DHAKA METRO", "ঢাকা মেট্রো"),
    ("CHATTO METRO", "চট্ট মেট্রো"),
    ("RAJ METRO", "রাজ মেট্রো"),
    ("KHULNA METRO", "খুলনা মেট্রো"),
    ("SYLHET METRO", "সিলেট মেট্রো"),
    ("DHAKA", "ঢাকা"),
    ("GAZIPUR", "গাজীপুর"),
    ("NARAYANGANJ", "নারায়ণগঞ্জ"),
    ("NARSINGDI", "নরসিংদী"),
    ("TANGAIL", "টাঙ্গাইল"),
    ("KISHOREGANJ", "কিশোরগঞ্জ"),
    ("MANIKGANJ", "মানিকগঞ্জ"),
    ("MUNSHIGANJ", "মুন্সীগঞ্জ"),
    ("FARIDPUR", "ফরিদপুর"),
    ("GOPALGANJ", "গোপালগঞ্জ"),
    ("MADARIPUR", "মাদারীপুর"),
    ("RAJBARI", "রাজবাড়ী"),
    ("SHARIATPUR", "শরীয়তপুর"),
    ("CHATTOGRAM", "চট্টগ্রাম"),
    ("COXS_BAZAR", "কক্সবাজার"),
    ("CUMILLA", "কুমিল্লা"),
    ("FENI", "ফেনী"),
    ("BRAHMANBARIA", "ব্রাহ্মণবাড়িয়া"),
    ("NOAKHALI", "নোয়াখালী"),
    ("CHANDPUR", "চাঁদপুর"),
    ("LAKSHMIPUR", "লক্ষ্মীপুর"),
    ("KHAGRACHHARI", "খাগড়াছড়ি"),
    ("RANGAMATI", "রাঙ্গামাটি"),
    ("BANDARBAN", "বান্দরবান"),
    ("RAJSHAHI", "রাজশাহী"),
    ("BOGURA", "বগুড়া"),
    ("PABNA", "পাবনা"),
    ("SIRAJGANJ", "সিরাজগঞ্জ"),
    ("NAOGAON", "নওগাঁ"),
    ("NATORE", "নাটোর"),
    ("CHAPAINAWABGANJ", "চাঁপাইনবাবগঞ্জ"),
    ("JOYPURHAT", "জয়পুরহাট"),
    ("KHULNA", "খুলনা"),
    ("JASHORE", "যশোর"),
    ("KUSHTIA", "কুষ্টিয়া"),
    ("SATKHIRA", "সাতক্ষীরা"),
    ("BAGERHAT", "বাগেরহাট"),
    ("JHENAIDAH", "ঝিনাইদহ"),
    ("CHUADANGA", "চুয়াডাঙ্গা"),
    ("MAGURA", "মাগুরা"),
    ("MEHERPUR", "মেহেরপুর"),
    ("NARAIL", "নড়াইল"),
    ("BARISHAL", "বরিশাল"),
    ("BHOLA", "ভোলা"),
    ("PATUAKHALI", "পটুয়াখালী"),
    ("PIROJPUR", "পিরোজপুর"),
    ("BARGUNA", "বরগুনা"),
    ("JHALOKATI", "ঝালকাঠি"),
    ("SYLHET", "সিলেট"),
    ("MOULVIBAZAR", "মৌলভীবাজার"),
    ("HABIGANJ", "হবিগঞ্জ"),
    ("SUNAMGANJ", "সুনামগঞ্জ"),
    ("RANGPUR", "রংপুর"),
    ("DINAJPUR", "দিনাজপুর"),
    ("KURIGRAM", "কুড়িগ্রাম"),
    ("GAIBANDHA", "গাইবান্ধা"),
    ("NILPHAMARI", "নীলফামারী"),
    ("PANCHAGARH", "পঞ্চগড়"),
    ("THAKURGAON", "ঠাকুরগাঁও"),
    ("LALMONIRHAT", "লালমনিরহাট"),
    ("MYMENSINGH", "ময়মনসিংহ"),
    ("JAMALPUR", "জামালপুর"),
    ("NETROKONA", "নেত্রকোণা"),
    ("SHERPUR", "শেরপুর"),
]

BRTA_CLASS_CODES: dict[str, list[tuple[str, str]]] = {
    "bike": [
        ("E", "এ"),
        ("HA", "হ"),
        ("LA", "ল"),
    ],
    "car": [
        ("KA", "ক"),
        ("KHA", "খ"),
        ("GA", "গ"),
        ("BHA", "ভ"),
        ("GHA", "ঘ"),
        ("CHA", "চ"),
        ("CHHA", "ছ"),
        ("PA", "প"),
    ],
    "cng": [
        ("THA", "থ"),
        ("DA", "দ"),
    ],
}

REGION_MAP: dict[str, str] = {code: bn for code, bn in BRTA_REGIONS}

ALL_CLASS_CODES: dict[str, str] = {
    code: bn for items in BRTA_CLASS_CODES.values() for code, bn in items
}

# Sorted by length descending so longer region names match first
_SORTED_REGIONS = sorted(BRTA_REGIONS, key=lambda r: len(r[0]), reverse=True)


def parse_plate(raw: str) -> tuple[str, str, str] | None:
    """Parse a plate string into (region, class_code, formatted_number).

    Formatted number is XX-XXXX (6 digits).
    """
    clean = raw.strip().upper().replace("_", " ")
    for region_code, _ in _SORTED_REGIONS:
        normalized_reg = region_code.replace("_", " ")
        if clean.startswith(normalized_reg):
            remainder = clean[len(normalized_reg) :].strip(" -_")
            # remainder should be like: "HA-11-2408", "HA 11-2408", "HA 112408", or "HA-112408"
            match = re.match(r"^([A-Z]+)[\s\-_]*(\d{2})[\s\-_]*(\d{4})$", remainder)
            if match:
                class_code, p1, p2 = match.groups()
                return region_code, class_code, f"{p1}-{p2}"
    return None


def format_plate(region: str, class_code: str, number: str) -> str:
    """Combine into standard <A> <B>-<C> format."""
    digits = re.sub(r"\D", "", number)
    if len(digits) == 6:
        formatted_num = f"{digits[:2]}-{digits[2:]}"
    else:
        formatted_num = number.strip()
    return f"{region.strip().upper()} {class_code.strip().upper()}-{formatted_num}"


def normalize_plate(raw: str, vehicle_type: str | None = None) -> str:
    """Normalize any BRTA plate number to <A> <B>-<C> format.

    If parsing fails, returns cleaned upper-cased string.
    """
    parsed = parse_plate(raw)
    if parsed:
        region, class_code, num = parsed
        return f"{region} {class_code}-{num}"
    return raw.strip().upper()

