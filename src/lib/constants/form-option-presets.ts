export type DropdownPreset = {
  id: string;
  label: string;
  description?: string;
  options: string[];
};

export type LocalizedPresetOption = {
  value: string;
  label: string;
};

const COUNTRY_REGION_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR',
  'BS', 'BT', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM',
  'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD',
  'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME',
  'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV',
  'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU',
  'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW',
  'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI',
  'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD',
  'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG',
  'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'XK', 'YE',
  'YT', 'ZA', 'ZM', 'ZW',
] as const;

const regionFormatter =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

function getRegionName(code: string): string {
  if (!regionFormatter) return code;

  const name = regionFormatter.of(code);
  if (!name) return code;
  return name;
}

function normalizePresetLookupValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,()'/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const localeRegionFormatterCache = new Map<string, Intl.DisplayNames | null>();

function getLocaleRegionFormatter(locale: string): Intl.DisplayNames | null {
  if (localeRegionFormatterCache.has(locale)) {
    return localeRegionFormatterCache.get(locale) ?? null;
  }

  const formatter =
    typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames([locale], { type: 'region' })
      : null;

  localeRegionFormatterCache.set(locale, formatter);
  return formatter;
}

function getLocalizedRegionName(code: string, locale: string): string {
  const localized = getLocaleRegionFormatter(locale)?.of(code);
  return localized || getRegionName(code);
}

export const COUNTRY_PRESET_OPTIONS = COUNTRY_REGION_CODES
  .map((code) => getRegionName(code))
  .filter((name, idx, arr) => arr.indexOf(name) === idx)
  .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

const COUNTRY_PRESET_ENTRIES = COUNTRY_REGION_CODES
  .map((code) => ({ code, value: getRegionName(code) }))
  .filter((entry, idx, arr) => arr.findIndex((candidate) => candidate.value === entry.value) === idx)
  .sort((a, b) => a.value.localeCompare(b.value, 'en', { sensitivity: 'base' }));

export const COUNTRY_PRESET_OPTION_ENTRIES: LocalizedPresetOption[] = COUNTRY_PRESET_ENTRIES.map(
  ({ value }) => ({ value, label: value })
);

const COUNTRY_NAME_TO_CODE = new Map<string, string>(
  COUNTRY_PRESET_ENTRIES.map((entry) => [normalizePresetLookupValue(entry.value), entry.code])
);

const NATIONALITY_ALIAS_TO_REGION_CODE: Record<string, string> = {
  afghan: 'AF',
  alandish: 'AX',
  albanian: 'AL',
  algerian: 'DZ',
  american: 'US',
  'american islander': 'UM',
  'american samoan': 'AS',
  andorran: 'AD',
  angolan: 'AO',
  anguillian: 'AI',
  'antiguan barbudan': 'AG',
  argentine: 'AR',
  armenian: 'AM',
  aruban: 'AW',
  australian: 'AU',
  austrian: 'AT',
  azerbaijani: 'AZ',
  bahamian: 'BS',
  bahraini: 'BH',
  bangladeshi: 'BD',
  barbadian: 'BB',
  belarusian: 'BY',
  belgian: 'BE',
  belizean: 'BZ',
  beninese: 'BJ',
  bermudian: 'BM',
  bhutanese: 'BT',
  bolivian: 'BO',
  'bosnian herzegovinian': 'BA',
  brazilian: 'BR',
  british: 'GB',
  bruneian: 'BN',
  bulgarian: 'BG',
  burkinabe: 'BF',
  burmese: 'MM',
  burundian: 'BI',
  cambodian: 'KH',
  cameroonian: 'CM',
  canadian: 'CA',
  'cape verdian': 'CV',
  caymanian: 'KY',
  'central african': 'CF',
  chadian: 'TD',
  'channel islander': 'JE',
  chilean: 'CL',
  chinese: 'CN',
  'christmas islander': 'CX',
  'cocos islander': 'CC',
  colombian: 'CO',
  comoran: 'KM',
  congolese: 'CG',
  'cook islander': 'CK',
  'costa rican': 'CR',
  croatian: 'HR',
  cuban: 'CU',
  curacaoan: 'CW',
  cypriot: 'CY',
  czech: 'CZ',
  danish: 'DK',
  djibouti: 'DJ',
  dominican: 'DO',
  dutch: 'NL',
  'east timorese': 'TL',
  ecuadorean: 'EC',
  egyptian: 'EG',
  emirati: 'AE',
  'equatorial guinean': 'GQ',
  eritrean: 'ER',
  estonian: 'EE',
  ethiopian: 'ET',
  'falkland islander': 'FK',
  faroese: 'FO',
  fijian: 'FJ',
  filipino: 'PH',
  finnish: 'FI',
  french: 'FR',
  'french polynesian': 'PF',
  gabonese: 'GA',
  gambian: 'GM',
  georgian: 'GE',
  german: 'DE',
  ghanaian: 'GH',
  gibraltar: 'GI',
  greek: 'GR',
  greenlandic: 'GL',
  grenadian: 'GD',
  guadeloupian: 'GP',
  guamanian: 'GU',
  guatemalan: 'GT',
  guianan: 'GF',
  'guinea bissauan': 'GW',
  guinean: 'GN',
  guyanese: 'GY',
  haitian: 'HT',
  honduran: 'HN',
  'hong konger': 'HK',
  hungarian: 'HU',
  'i kiribati': 'KI',
  icelander: 'IS',
  indian: 'IN',
  indonesian: 'ID',
  iranian: 'IR',
  iraqi: 'IQ',
  irish: 'IE',
  israeli: 'IL',
  italian: 'IT',
  ivorian: 'CI',
  jamaican: 'JM',
  japanese: 'JP',
  jordanian: 'JO',
  kazakhstani: 'KZ',
  kenyan: 'KE',
  kirghiz: 'KG',
  'kittitian or nevisian': 'KN',
  kosovar: 'XK',
  kuwaiti: 'KW',
  laotian: 'LA',
  latvian: 'LV',
  lebanese: 'LB',
  liberian: 'LR',
  libyan: 'LY',
  liechtensteiner: 'LI',
  lithuanian: 'LT',
  luxembourger: 'LU',
  macanese: 'MO',
  macedonian: 'MK',
  mahoran: 'YT',
  malagasy: 'MG',
  malawian: 'MW',
  malaysian: 'MY',
  maldivan: 'MV',
  malian: 'ML',
  maltese: 'MT',
  manx: 'IM',
  marshallese: 'MH',
  martinican: 'MQ',
  mauritanian: 'MR',
  mauritian: 'MU',
  mexican: 'MX',
  micronesian: 'FM',
  moldovan: 'MD',
  monegasque: 'MC',
  mongolian: 'MN',
  montenegrin: 'ME',
  montserratian: 'MS',
  moroccan: 'MA',
  mosotho: 'LS',
  motswana: 'BW',
  mozambican: 'MZ',
  namibian: 'NA',
  nauruan: 'NR',
  nepalese: 'NP',
  'new caledonian': 'NC',
  'new zealander': 'NZ',
  'ni vanuatu': 'VU',
  nicaraguan: 'NI',
  nigerian: 'NG',
  nigerien: 'NE',
  niuean: 'NU',
  'norfolk islander': 'NF',
  'north korean': 'KP',
  norwegian: 'NO',
  omani: 'OM',
  pakistani: 'PK',
  palauan: 'PW',
  palestinian: 'PS',
  panamanian: 'PA',
  'papua new guinean': 'PG',
  paraguayan: 'PY',
  peruvian: 'PE',
  'pitcairn islander': 'PN',
  polish: 'PL',
  portuguese: 'PT',
  'puerto rican': 'PR',
  qatari: 'QA',
  reunionese: 'RE',
  romanian: 'RO',
  russian: 'RU',
  rwandan: 'RW',
  'saint barthelemy islander': 'BL',
  'saint helenian': 'SH',
  'saint lucian': 'LC',
  'saint martin islander': 'MF',
  'saint vincentian': 'VC',
  'saint pierrais miquelonnais': 'PM',
  salvadoran: 'SV',
  sammarinese: 'SM',
  samoan: 'WS',
  'sao tomean': 'ST',
  'saudi arabian': 'SA',
  senegalese: 'SN',
  serbian: 'RS',
  seychellois: 'SC',
  'sierra leonean': 'SL',
  singaporean: 'SG',
  slovak: 'SK',
  slovene: 'SI',
  'solomon islander': 'SB',
  somali: 'SO',
  'south african': 'ZA',
  'south korean': 'KR',
  'south sudanese': 'SS',
  spanish: 'ES',
  'sri lankan': 'LK',
  'st maartener': 'SX',
  sudanese: 'SD',
  surinamer: 'SR',
  swazi: 'SZ',
  swedish: 'SE',
  swiss: 'CH',
  syrian: 'SY',
  tadzhik: 'TJ',
  taiwanese: 'TW',
  tanzanian: 'TZ',
  thai: 'TH',
  togolese: 'TG',
  tokelauan: 'TK',
  tongan: 'TO',
  trinidadian: 'TT',
  tunisian: 'TN',
  turkish: 'TR',
  turkmen: 'TM',
  'turks and caicos islander': 'TC',
  tuvaluan: 'TV',
  ugandan: 'UG',
  ukrainian: 'UA',
  uruguayan: 'UY',
  uzbekistani: 'UZ',
  vatican: 'VA',
  venezuelan: 'VE',
  vietnamese: 'VN',
  'virgin islander': 'VI',
  'wallis and futuna islander': 'WF',
  yemeni: 'YE',
  zambian: 'ZM',
  zimbabwean: 'ZW',
};

function inferNationalityRegionCode(nationality: string): string | null {
  const normalized = normalizePresetLookupValue(nationality);
  const directMatch = NATIONALITY_ALIAS_TO_REGION_CODE[normalized];
  if (directMatch) return directMatch;

  const candidates = [
    normalized,
    normalized.replace(/ian$|ean$|ese$|ish$|i$|an$|er$|ar$/u, ''),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (COUNTRY_NAME_TO_CODE.has(candidate)) {
      return COUNTRY_NAME_TO_CODE.get(candidate) || null;
    }
    if (COUNTRY_NAME_TO_CODE.has(`${candidate}ia`)) {
      return COUNTRY_NAME_TO_CODE.get(`${candidate}ia`) || null;
    }
    if (COUNTRY_NAME_TO_CODE.has(`${candidate}land`)) {
      return COUNTRY_NAME_TO_CODE.get(`${candidate}land`) || null;
    }
  }

  return null;
}

export function getLocalizedCountryPresetOptions(locale: string): LocalizedPresetOption[] {
  return COUNTRY_PRESET_ENTRIES.map((entry) => ({
    value: entry.value,
    label: getLocalizedRegionName(entry.code, locale),
  }));
}

// English demonym values used for nationality fields.
export const NATIONALITY_PRESET_OPTIONS = [
  'Afghan',
  'Alandish',
  'Albanian',
  'Algerian',
  'American',
  'American Islander',
  'American Samoan',
  'Andorran',
  'Angolan',
  'Anguillian',
  'Antiguan, Barbudan',
  'Argentine',
  'Armenian',
  'Aruban',
  'Australian',
  'Austrian',
  'Azerbaijani',
  'Bahamian',
  'Bahraini',
  'Bangladeshi',
  'Barbadian',
  'Belarusian',
  'Belgian',
  'Belizean',
  'Beninese',
  'Bermudian',
  'Bhutanese',
  'Bolivian',
  'Bosnian, Herzegovinian',
  'Brazilian',
  'British',
  'Bruneian',
  'Bulgarian',
  'Burkinabe',
  'Burmese',
  'Burundian',
  'Cambodian',
  'Cameroonian',
  'Canadian',
  'Cape Verdian',
  'Caymanian',
  'Central African',
  'Chadian',
  'Channel Islander',
  'Chilean',
  'Chinese',
  'Christmas Islander',
  'Cocos Islander',
  'Colombian',
  'Comoran',
  'Congolese',
  'Cook Islander',
  'Costa Rican',
  'Croatian',
  'Cuban',
  'Curacaoan',
  'Cypriot',
  'Czech',
  'Danish',
  'Djibouti',
  'Dominican',
  'Dutch',
  'East Timorese',
  'Ecuadorean',
  'Egyptian',
  'Emirati',
  'Equatorial Guinean',
  'Eritrean',
  'Estonian',
  'Ethiopian',
  'Falkland Islander',
  'Faroese',
  'Fijian',
  'Filipino',
  'Finnish',
  'French',
  'French Polynesian',
  'Gabonese',
  'Gambian',
  'Georgian',
  'German',
  'Ghanaian',
  'Gibraltar',
  'Greek',
  'Greenlandic',
  'Grenadian',
  'Guadeloupian',
  'Guamanian',
  'Guatemalan',
  'Guianan',
  'Guinea-Bissauan',
  'Guinean',
  'Guyanese',
  'Haitian',
  'Honduran',
  'Hong Konger',
  'Hungarian',
  'I-Kiribati',
  'Icelander',
  'Indian',
  'Indonesian',
  'Iranian',
  'Iraqi',
  'Irish',
  'Israeli',
  'Italian',
  'Ivorian',
  'Jamaican',
  'Japanese',
  'Jordanian',
  'Kazakhstani',
  'Kenyan',
  'Kirghiz',
  'Kittitian or Nevisian',
  'Kosovar',
  'Kuwaiti',
  'Laotian',
  'Latvian',
  'Lebanese',
  'Liberian',
  'Libyan',
  'Liechtensteiner',
  'Lithuanian',
  'Luxembourger',
  'Macanese',
  'Macedonian',
  'Mahoran',
  'Malagasy',
  'Malawian',
  'Malaysian',
  'Maldivan',
  'Malian',
  'Maltese',
  'Manx',
  'Marshallese',
  'Martinican',
  'Mauritanian',
  'Mauritian',
  'Mexican',
  'Micronesian',
  'Moldovan',
  'Monegasque',
  'Mongolian',
  'Montenegrin',
  'Montserratian',
  'Moroccan',
  'Mosotho',
  'Motswana',
  'Mozambican',
  'Namibian',
  'Nauruan',
  'Nepalese',
  'New Caledonian',
  'New Zealander',
  'Ni-Vanuatu',
  'Nicaraguan',
  'Nigerian',
  'Nigerien',
  'Niuean',
  'Norfolk Islander',
  'North Korean',
  'Norwegian',
  'Omani',
  'Pakistani',
  'Palauan',
  'Palestinian',
  'Panamanian',
  'Papua New Guinean',
  'Paraguayan',
  'Peruvian',
  'Pitcairn Islander',
  'Polish',
  'Portuguese',
  'Puerto Rican',
  'Qatari',
  'Reunionese',
  'Romanian',
  'Russian',
  'Rwandan',
  'Saint Barthelemy Islander',
  'Saint Helenian',
  'Saint Lucian',
  'Saint Martin Islander',
  'Saint Vincentian',
  'Saint-Pierrais, Miquelonnais',
  'Salvadoran',
  'Sammarinese',
  'Samoan',
  'Sao Tomean',
  'Saudi Arabian',
  'Senegalese',
  'Serbian',
  'Seychellois',
  'Sierra Leonean',
  'Singaporean',
  'Slovak',
  'Slovene',
  'Solomon Islander',
  'Somali',
  'South African',
  'South Korean',
  'South Sudanese',
  'Spanish',
  'Sri Lankan',
  'St. Maartener',
  'Sudanese',
  'Surinamer',
  'Swazi',
  'Swedish',
  'Swiss',
  'Syrian',
  'Tadzhik',
  'Taiwanese',
  'Tanzanian',
  'Thai',
  'Togolese',
  'Tokelauan',
  'Tongan',
  'Trinidadian',
  'Tunisian',
  'Turkish',
  'Turkmen',
  'Turks and Caicos Islander',
  'Tuvaluan',
  'Ugandan',
  'Ukrainian',
  'Uruguayan',
  'Uzbekistani',
  'Vatican',
  'Venezuelan',
  'Vietnamese',
  'Virgin Islander',
  'Wallis and Futuna Islander',
  'Yemeni',
  'Zambian',
  'Zimbabwean',
] as const;

export const NATIONALITY_PRESET_OPTION_ENTRIES: LocalizedPresetOption[] =
  NATIONALITY_PRESET_OPTIONS.map((value) => ({ value, label: value }));

export function getLocalizedNationalityPresetOptions(locale: string): LocalizedPresetOption[] {
  return NATIONALITY_PRESET_OPTIONS.map((value) => {
    const regionCode = inferNationalityRegionCode(value);
    return {
      value,
      label: regionCode ? getLocalizedRegionName(regionCode, locale) : value,
    };
  });
}

export const DROPDOWN_PRESETS: DropdownPreset[] = [
  {
    id: 'countries',
    label: 'Countries',
    description: 'Countries and territories (ISO region names).',
    options: COUNTRY_PRESET_OPTIONS,
  },
  {
    id: 'nationalities',
    label: 'Nationalities',
    description: 'Nationality / demonym values (e.g. Singaporean, Malaysian).',
    options: [...NATIONALITY_PRESET_OPTIONS],
  },
];
