/*
 * Ready-made locale lists for the `locales` option, e.g. `locales: [...locales.EUROPE]`.
 * Codes are BCP 47 language tags. Each list is a plain array: spread it to avoid mutating the shared export.
 */

/** European Union: the 23 official languages (English dropped after Brexit). */
const EU: string[] = [
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "et",
  "fi",
  "fr",
  "ga",
  "hr",
  "hu",
  "it",
  "lt",
  "lv",
  "mt",
  "nl",
  "pl",
  "pt",
  "ro",
  "sk",
  "sl",
  "sv",
];
/** Nordic countries: Danish, Finnish, Icelandic, Norwegian, Swedish. */
const NORDIC: string[] = ["da", "fi", "is", "no", "sv"];
/** Baltic states: Estonian, Latvian, Lithuanian. */
const BALTIC: string[] = ["et", "lv", "lt"];
/** Balkans: Albanian, Bosnian, Bulgarian, Croatian, Greek, Macedonian, Romanian, Serbian, Slovenian. */
const BALKANS: string[] = ["bg", "bs", "el", "hr", "mk", "ro", "sq", "sr", "sl"];
/** Benelux: Dutch, French, Luxembourgish. */
const BENELUX: string[] = ["nl", "fr", "lb"];
/** Europe: EU languages plus the major non-EU languages of the continent. */
const EUROPE: string[] = [...new Set([...EU, "no", "is", "sq", "bs", "mk", "sr", "uk", "ru", "be", "ca"])];

/** Eastern Asia: Chinese, Japanese, Korean, Mongolian. */
const EAST_ASIA: string[] = ["zh", "ja", "ko", "mn"];
/** South Asia: Hindi, Bengali, Urdu, Punjabi, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Nepali, Sinhala. */
const SOUTH_ASIA: string[] = ["hi", "bn", "ur", "pa", "ta", "te", "mr", "gu", "kn", "ml", "ne", "si"];
/** Southeast Asia: Indonesian, Malay, Burmese, Khmer, Lao, Filipino, Thai, Vietnamese. */
const SOUTHEAST_ASIA: string[] = ["id", "ms", "my", "km", "lo", "fil", "th", "vi"];
/** Central Asia: Kazakh, Kyrgyz, Tajik, Turkmen, Uzbek. */
const CENTRAL_ASIA: string[] = ["kk", "ky", "tg", "tk", "uz"];
/** Caucasus: Armenian, Azerbaijani, Georgian. */
const CAUCASUS: string[] = ["hy", "az", "ka"];
/** Asia: East, South, Southeast, Central Asia and the Caucasus. */
const ASIA: string[] = [...new Set([...EAST_ASIA, ...SOUTH_ASIA, ...SOUTHEAST_ASIA, ...CENTRAL_ASIA, ...CAUCASUS])];

/** Middle East: Arabic, Persian, Hebrew, Turkish, Kurdish. */
const MIDDLE_EAST: string[] = ["ar", "fa", "he", "tr", "ku"];
/** Africa: major official and widely spoken languages. */
const AFRICA: string[] = ["ar", "fr", "pt", "sw", "am", "ha", "yo", "ig", "zu", "xh", "af", "so", "rw", "wo"];

/** North America: English, French (Canada), Spanish (Mexico, US). */
const NORTH_AMERICA: string[] = ["en", "fr", "es"];
/** Central America and the Caribbean: Spanish, English, French, Haitian Creole, Dutch. */
const CENTRAL_AMERICA_CARIBBEAN: string[] = ["es", "en", "fr", "ht", "nl"];
/** South America: Spanish, Portuguese, Quechua, Guarani, Aymara. */
const SOUTH_AMERICA: string[] = ["es", "pt", "qu", "gn", "ay"];
/** Americas: North, Central, Caribbean and South America. */
const AMERICAS: string[] = [...new Set([...NORTH_AMERICA, ...CENTRAL_AMERICA_CARIBBEAN, ...SOUTH_AMERICA])];

/** Oceania: English, Maori, Samoan, Tongan. */
const OCEANIA: string[] = ["en", "mi", "sm", "to"];

/** ASEAN: Indonesian, Malay, Burmese, Khmer, Lao, Filipino, Thai, Vietnamese, plus English as working language. */
const ASEAN: string[] = ["id", "ms", "my", "km", "lo", "fil", "th", "vi", "en"];
/** Mercosur: Spanish, Portuguese, Guarani. */
const MERCOSUR: string[] = ["es", "pt", "gn"];
/** Gulf Cooperation Council: Arabic and English, the working language of most member states. */
const GCC: string[] = ["ar", "en"];
/** Commonwealth of Independent States: Russian, Belarusian, Armenian, Azerbaijani, Kazakh, Kyrgyz, Tajik, Uzbek. */
const CIS: string[] = ["ru", "be", "hy", "az", "kk", "ky", "tg", "uz"];
/** G7 official languages: English, French, German, Italian, Japanese. */
const G7: string[] = ["en", "fr", "de", "it", "ja"];
/** Francophonie: French and major French-speaking African and Caribbean languages. */
const FRANCOPHONE: string[] = ["fr", "ht", "wo", "ln", "rw"];

/** Most widely spoken languages worldwide by total speakers. */
const WORLDWIDE_POPULAR: string[] = [
  "en",
  "zh",
  "hi",
  "es",
  "ar",
  "bn",
  "pt",
  "ru",
  "ja",
  "de",
  "fr",
  "ko",
  "it",
  "tr",
  "vi",
  "id",
  "ur",
];

/** Ready-made locale lists for the `locales` option, grouped by region or organization: `locales: [...locales.EUROPE]`. */
export const locales = {
  EU,
  EUROPE,
  NORDIC,
  BALTIC,
  BALKANS,
  BENELUX,
  EAST_ASIA,
  SOUTH_ASIA,
  SOUTHEAST_ASIA,
  CENTRAL_ASIA,
  CAUCASUS,
  ASIA,
  MIDDLE_EAST,
  AFRICA,
  NORTH_AMERICA,
  CENTRAL_AMERICA_CARIBBEAN,
  SOUTH_AMERICA,
  AMERICAS,
  OCEANIA,
  ASEAN,
  MERCOSUR,
  GCC,
  CIS,
  G7,
  FRANCOPHONE,
  WORLDWIDE_POPULAR,
};
