/**
 * NANP (US / Canada / territories) area code -> IANA time zone.
 * Used to pick a lead's time zone when the list did not provide one, so calling
 * hours are respected per lead. Where an area code straddles zones the zone of
 * the larger population is used. Toll-free codes map to null.
 */
const NY = 'America/New_York';
const CH = 'America/Chicago';
const DEN = 'America/Denver';
const PHX = 'America/Phoenix';
const LA = 'America/Los_Angeles';
const ANC = 'America/Anchorage';
const HNL = 'Pacific/Honolulu';
const TOR = 'America/Toronto';
const WPG = 'America/Winnipeg';
const REG = 'America/Regina';
const EDM = 'America/Edmonton';
const VAN = 'America/Vancouver';
const HFX = 'America/Halifax';
const STJ = 'America/St_Johns';
const PR = 'America/Puerto_Rico';

const groups: Record<string, number[]> = {
  [NY]: [
    201, 202, 203, 207, 212, 215, 216, 220, 223, 229, 231, 234, 239, 240, 248, 267, 269, 272, 276, 301,
    302, 304, 305, 313, 315, 321, 326, 330, 331, 332, 336, 339, 347, 351, 352, 380, 386, 401, 404, 407,
    410, 412, 413, 419, 440, 443, 445, 470, 475, 478, 484, 502, 508, 513, 516, 517, 518, 540, 551, 561,
    567, 570, 571, 585, 586, 603, 607, 609, 610, 614, 616, 617, 631, 646, 656, 667, 678, 680, 681, 689,
    703, 704, 706, 716, 717, 718, 724, 727, 732, 734, 740, 743, 754, 757, 762, 770, 772, 774, 781, 786,
    802, 804, 810, 812, 813, 814, 828, 838, 843, 845, 848, 850, 854, 856, 857, 859, 860, 862, 863, 864,
    878, 904, 908, 910, 912, 914, 917, 919, 929, 934, 937, 941, 947, 954, 959, 973, 978, 980, 984, 989,
  ],
  [CH]: [
    205, 210, 214, 217, 218, 224, 225, 228, 251, 254, 256, 262, 270, 281, 309, 312, 314, 316, 318, 319,
    320, 325, 334, 337, 346, 361, 364, 402, 405, 409, 414, 417, 430, 432, 469, 479, 501, 504, 507, 512,
    515, 531, 563, 573, 580, 601, 605, 608, 612, 615, 618, 620, 630, 636, 641, 651, 660, 662, 682, 701,
    708, 712, 713, 715, 726, 731, 737, 763, 769, 773, 779, 785, 806, 815, 816, 817, 830, 832, 847, 870,
    872, 901, 903, 913, 918, 920, 936, 938, 940, 945, 952, 956, 972, 979, 985,
  ],
  [DEN]: [303, 307, 385, 406, 435, 505, 575, 719, 720, 801, 970, 983, 986],
  [PHX]: [480, 520, 602, 623, 928],
  [LA]: [
    206, 209, 213, 253, 279, 310, 323, 341, 360, 408, 415, 424, 442, 458, 503, 509, 510, 530, 541, 559,
    562, 619, 626, 628, 650, 657, 661, 669, 702, 707, 714, 725, 747, 760, 775, 805, 818, 820, 831, 858,
    909, 916, 925, 949, 951, 971,
  ],
  [ANC]: [907],
  [HNL]: [808],
  [TOR]: [226, 249, 263, 289, 343, 354, 365, 367, 382, 416, 418, 437, 438, 450, 468, 514, 519, 548, 579, 581, 613, 647, 705, 742, 807, 819, 873, 905],
  [WPG]: [204, 431, 584],
  [REG]: [306, 639, 474],
  [EDM]: [403, 587, 780, 825, 368],
  [VAN]: [236, 250, 604, 672, 778],
  [HFX]: [506, 782, 902],
  [STJ]: [709],
  [PR]: [787, 939, 340, 284, 441, 649, 664, 721, 758, 767, 784, 809, 829, 849, 868, 869, 876],
};

const AREA_CODE_TZ = new Map<number, string>();
for (const [tz, codes] of Object.entries(groups)) {
  for (const code of codes) AREA_CODE_TZ.set(code, tz);
}

/** Returns the IANA zone for an E.164 NANP number (+1XXX…) or null if unknown. */
export function timezoneForPhone(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('1')) return null;
  const area = Number(digits.slice(1, 4));
  return AREA_CODE_TZ.get(area) ?? null;
}
