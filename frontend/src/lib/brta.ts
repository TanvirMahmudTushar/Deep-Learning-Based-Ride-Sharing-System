import type { VehicleType } from "@/lib/types";

export interface BrtaRegion {
  code: string;
  bengali: string;
}

export interface BrtaClassCode {
  code: string;
  bengali: string;
  vehicle_type: VehicleType;
}

export const BRTA_REGIONS: BrtaRegion[] = [
  { code: "DHAKA METRO", bengali: "ঢাকা মেট্রো" },
  { code: "CHATTO METRO", bengali: "চট্ট মেট্রো" },
  { code: "RAJ METRO", bengali: "রাজ মেট্রো" },
  { code: "KHULNA METRO", bengali: "খুলনা মেট্রো" },
  { code: "SYLHET METRO", bengali: "সিলেট মেট্রো" },
  { code: "DHAKA", bengali: "ঢাকা" },
  { code: "GAZIPUR", bengali: "গাজীপুর" },
  { code: "NARAYANGANJ", bengali: "নারায়ণগঞ্জ" },
  { code: "NARSINGDI", bengali: "নরসিংদী" },
  { code: "TANGAIL", bengali: "টাঙ্গাইল" },
  { code: "KISHOREGANJ", bengali: "কিশোরগঞ্জ" },
  { code: "MANIKGANJ", bengali: "মানিকগঞ্জ" },
  { code: "MUNSHIGANJ", bengali: "মুন্সীগঞ্জ" },
  { code: "FARIDPUR", bengali: "ফরিদপুর" },
  { code: "GOPALGANJ", bengali: "গোপালগঞ্জ" },
  { code: "MADARIPUR", bengali: "মাদারীপুর" },
  { code: "RAJBARI", bengali: "রাজবাড়ী" },
  { code: "SHARIATPUR", bengali: "শরীয়তপুর" },
  { code: "CHATTOGRAM", bengali: "চট্টগ্রাম" },
  { code: "COXS_BAZAR", bengali: "কক্সবাজার" },
  { code: "CUMILLA", bengali: "কুমিল্লা" },
  { code: "FENI", bengali: "ফেনী" },
  { code: "BRAHMANBARIA", bengali: "ব্রাহ্মণবাড়িয়া" },
  { code: "NOAKHALI", bengali: "নোয়াখালী" },
  { code: "CHANDPUR", bengali: "চাঁদপুর" },
  { code: "LAKSHMIPUR", bengali: "লক্ষ্মীপুর" },
  { code: "KHAGRACHHARI", bengali: "খাগড়াছড়ি" },
  { code: "RANGAMATI", bengali: "রাঙ্গামাটি" },
  { code: "BANDARBAN", bengali: "বান্দরবান" },
  { code: "RAJSHAHI", bengali: "রাজশাহী" },
  { code: "BOGURA", bengali: "বগুড়া" },
  { code: "PABNA", bengali: "পাবনা" },
  { code: "SIRAJGANJ", bengali: "সিরাজগঞ্জ" },
  { code: "NAOGAON", bengali: "নওগাঁ" },
  { code: "NATORE", bengali: "নাটোর" },
  { code: "CHAPAINAWABGANJ", bengali: "চাঁপাইনবাবগঞ্জ" },
  { code: "JOYPURHAT", bengali: "জয়পুরহাট" },
  { code: "KHULNA", bengali: "খুলনা" },
  { code: "JASHORE", bengali: "যশোর" },
  { code: "KUSHTIA", bengali: "কুষ্টিয়া" },
  { code: "SATKHIRA", bengali: "সাতক্ষীরা" },
  { code: "BAGERHAT", bengali: "বাগেরহাট" },
  { code: "JHENAIDAH", bengali: "ঝিনাইদহ" },
  { code: "CHUADANGA", bengali: "চুয়াডাঙ্গা" },
  { code: "MAGURA", bengali: "মাগুরা" },
  { code: "MEHERPUR", bengali: "মেহেরপুর" },
  { code: "NARAIL", bengali: "নড়াইল" },
  { code: "BARISHAL", bengali: "বরিশাল" },
  { code: "BHOLA", bengali: "ভোলা" },
  { code: "PATUAKHALI", bengali: "পটুয়াখালী" },
  { code: "PIROJPUR", bengali: "পিরোজপুর" },
  { code: "BARGUNA", bengali: "বরগুনা" },
  { code: "JHALOKATI", bengali: "ঝালকাঠি" },
  { code: "SYLHET", bengali: "সিলেট" },
  { code: "MOULVIBAZAR", bengali: "মৌলভীবাজার" },
  { code: "HABIGANJ", bengali: "হবিগঞ্জ" },
  { code: "SUNAMGANJ", bengali: "সুনামগঞ্জ" },
  { code: "RANGPUR", bengali: "রংপুর" },
  { code: "DINAJPUR", bengali: "দিনাজপুর" },
  { code: "KURIGRAM", bengali: "কুড়িগ্রাম" },
  { code: "GAIBANDHA", bengali: "গাইবান্ধা" },
  { code: "NILPHAMARI", bengali: "নীলফামারী" },
  { code: "PANCHAGARH", bengali: "পঞ্চগড়" },
  { code: "THAKURGAON", bengali: "ঠাকুরগাঁও" },
  { code: "LALMONIRHAT", bengali: "লালমনিরহাট" },
  { code: "MYMENSINGH", bengali: "ময়মনসিংহ" },
  { code: "JAMALPUR", bengali: "জামালপুর" },
  { code: "NETROKONA", bengali: "নেত্রকোণা" },
  { code: "SHERPUR", bengali: "শেরপুর" },
];

export const BRTA_CLASS_CODES: Record<VehicleType, { code: string; bengali: string }[]> = {
  bike: [
    { code: "E", bengali: "এ" },
    { code: "HA", bengali: "হ" },
    { code: "LA", bengali: "ল" },
  ],
  car: [
    { code: "KA", bengali: "ক" },
    { code: "KHA", bengali: "খ" },
    { code: "GA", bengali: "গ" },
    { code: "BHA", bengali: "ভ" },
    { code: "GHA", bengali: "ঘ" },
    { code: "CHA", bengali: "চ" },
    { code: "CHHA", bengali: "ছ" },
    { code: "PA", bengali: "প" },
  ],
  cng: [
    { code: "THA", bengali: "থ" },
    { code: "DA", bengali: "দ" },
  ],
};

const SORTED_REGIONS = [...BRTA_REGIONS].sort((a, b) => b.code.length - a.code.length);

/** Parses any plate string into { region, classCode, number6 } */
export function parsePlate(
  raw: string,
  vehicleType: VehicleType = "bike",
): { region: string; classCode: string; number6: string } {
  const clean = raw.trim().toUpperCase().replace(/_/g, " ");
  const fallbackClass = BRTA_CLASS_CODES[vehicleType]?.[0]?.code ?? "HA";

  for (const r of SORTED_REGIONS) {
    const regNorm = r.code.replace(/_/g, " ");
    if (clean.startsWith(regNorm)) {
      const rest = clean.slice(regNorm.length).trim().replace(/^[ -]+/, "");
      const match = rest.match(/^([A-Z]+)[\s-_]*(\d{2})[\s-_]*(\d{4})$/);
      if (match) {
        return {
          region: r.code,
          classCode: match[1],
          number6: `${match[2]}-${match[3]}`,
        };
      }
      // Partial or digits without hyphen
      const digitsOnly = rest.replace(/\D/g, "").slice(0, 6);
      const lettersOnly = rest.replace(/[^A-Z]/g, "");
      const matchedClass =
        BRTA_CLASS_CODES[vehicleType]?.find((c) => c.code === lettersOnly)?.code ||
        lettersOnly ||
        fallbackClass;
      const formattedNum =
        digitsOnly.length > 2 ? `${digitsOnly.slice(0, 2)}-${digitsOnly.slice(2)}` : digitsOnly;
      return {
        region: r.code,
        classCode: matchedClass,
        number6: formattedNum,
      };
    }
  }

  return {
    region: "DHAKA METRO",
    classCode: fallbackClass,
    number6: "",
  };
}

/** Formats into standard <A> <B>-<C> */
export function formatPlate(region: string, classCode: string, number6: string): string {
  const digits = number6.replace(/\D/g, "").slice(0, 6);
  const formattedNum = digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
  if (!formattedNum) return "";
  return `${region.trim().toUpperCase()} ${classCode.trim().toUpperCase()}-${formattedNum}`;
}

