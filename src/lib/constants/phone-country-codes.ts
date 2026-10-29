export type PhoneCountryCodeOption = {
  value: string;
  label: string;
};

type PhoneCountryCodeDefinition = {
  value: string;
  regions: string[];
  fallbackLabel: string;
};

const PHONE_COUNTRY_CODE_DEFINITIONS: PhoneCountryCodeDefinition[] = [
  { value: '+1', regions: ['US', 'CA'], fallbackLabel: 'United States / Canada' },
  { value: '+7', regions: ['RU', 'KZ'], fallbackLabel: 'Russia / Kazakhstan' },
  { value: '+20', regions: ['EG'], fallbackLabel: 'Egypt' },
  { value: '+27', regions: ['ZA'], fallbackLabel: 'South Africa' },
  { value: '+30', regions: ['GR'], fallbackLabel: 'Greece' },
  { value: '+31', regions: ['NL'], fallbackLabel: 'Netherlands' },
  { value: '+32', regions: ['BE'], fallbackLabel: 'Belgium' },
  { value: '+33', regions: ['FR'], fallbackLabel: 'France' },
  { value: '+34', regions: ['ES'], fallbackLabel: 'Spain' },
  { value: '+36', regions: ['HU'], fallbackLabel: 'Hungary' },
  { value: '+39', regions: ['IT'], fallbackLabel: 'Italy' },
  { value: '+40', regions: ['RO'], fallbackLabel: 'Romania' },
  { value: '+41', regions: ['CH'], fallbackLabel: 'Switzerland' },
  { value: '+43', regions: ['AT'], fallbackLabel: 'Austria' },
  { value: '+44', regions: ['GB'], fallbackLabel: 'United Kingdom' },
  { value: '+45', regions: ['DK'], fallbackLabel: 'Denmark' },
  { value: '+46', regions: ['SE'], fallbackLabel: 'Sweden' },
  { value: '+47', regions: ['NO'], fallbackLabel: 'Norway' },
  { value: '+48', regions: ['PL'], fallbackLabel: 'Poland' },
  { value: '+49', regions: ['DE'], fallbackLabel: 'Germany' },
  { value: '+52', regions: ['MX'], fallbackLabel: 'Mexico' },
  { value: '+54', regions: ['AR'], fallbackLabel: 'Argentina' },
  { value: '+55', regions: ['BR'], fallbackLabel: 'Brazil' },
  { value: '+56', regions: ['CL'], fallbackLabel: 'Chile' },
  { value: '+57', regions: ['CO'], fallbackLabel: 'Colombia' },
  { value: '+60', regions: ['MY'], fallbackLabel: 'Malaysia' },
  { value: '+61', regions: ['AU'], fallbackLabel: 'Australia' },
  { value: '+62', regions: ['ID'], fallbackLabel: 'Indonesia' },
  { value: '+63', regions: ['PH'], fallbackLabel: 'Philippines' },
  { value: '+64', regions: ['NZ'], fallbackLabel: 'New Zealand' },
  { value: '+65', regions: ['SG'], fallbackLabel: 'Singapore' },
  { value: '+66', regions: ['TH'], fallbackLabel: 'Thailand' },
  { value: '+81', regions: ['JP'], fallbackLabel: 'Japan' },
  { value: '+82', regions: ['KR'], fallbackLabel: 'South Korea' },
  { value: '+84', regions: ['VN'], fallbackLabel: 'Vietnam' },
  { value: '+86', regions: ['CN'], fallbackLabel: 'China' },
  { value: '+90', regions: ['TR'], fallbackLabel: 'Turkey' },
  { value: '+91', regions: ['IN'], fallbackLabel: 'India' },
  { value: '+92', regions: ['PK'], fallbackLabel: 'Pakistan' },
  { value: '+93', regions: ['AF'], fallbackLabel: 'Afghanistan' },
  { value: '+94', regions: ['LK'], fallbackLabel: 'Sri Lanka' },
  { value: '+95', regions: ['MM'], fallbackLabel: 'Myanmar' },
  { value: '+98', regions: ['IR'], fallbackLabel: 'Iran' },
  { value: '+212', regions: ['MA'], fallbackLabel: 'Morocco' },
  { value: '+213', regions: ['DZ'], fallbackLabel: 'Algeria' },
  { value: '+216', regions: ['TN'], fallbackLabel: 'Tunisia' },
  { value: '+218', regions: ['LY'], fallbackLabel: 'Libya' },
  { value: '+220', regions: ['GM'], fallbackLabel: 'Gambia' },
  { value: '+221', regions: ['SN'], fallbackLabel: 'Senegal' },
  { value: '+223', regions: ['ML'], fallbackLabel: 'Mali' },
  { value: '+225', regions: ['CI'], fallbackLabel: 'Ivory Coast' },
  { value: '+227', regions: ['NE'], fallbackLabel: 'Niger' },
  { value: '+229', regions: ['BJ'], fallbackLabel: 'Benin' },
  { value: '+230', regions: ['MU'], fallbackLabel: 'Mauritius' },
  { value: '+231', regions: ['LR'], fallbackLabel: 'Liberia' },
  { value: '+232', regions: ['SL'], fallbackLabel: 'Sierra Leone' },
  { value: '+233', regions: ['GH'], fallbackLabel: 'Ghana' },
  { value: '+234', regions: ['NG'], fallbackLabel: 'Nigeria' },
  { value: '+241', regions: ['GA'], fallbackLabel: 'Gabon' },
  { value: '+242', regions: ['CG'], fallbackLabel: 'Republic of the Congo' },
  { value: '+243', regions: ['CD'], fallbackLabel: 'DR Congo' },
  { value: '+251', regions: ['ET'], fallbackLabel: 'Ethiopia' },
  { value: '+254', regions: ['KE'], fallbackLabel: 'Kenya' },
  { value: '+255', regions: ['TZ'], fallbackLabel: 'Tanzania' },
  { value: '+256', regions: ['UG'], fallbackLabel: 'Uganda' },
  { value: '+260', regions: ['ZM'], fallbackLabel: 'Zambia' },
  { value: '+263', regions: ['ZW'], fallbackLabel: 'Zimbabwe' },
  { value: '+351', regions: ['PT'], fallbackLabel: 'Portugal' },
  { value: '+352', regions: ['LU'], fallbackLabel: 'Luxembourg' },
  { value: '+353', regions: ['IE'], fallbackLabel: 'Ireland' },
  { value: '+355', regions: ['AL'], fallbackLabel: 'Albania' },
  { value: '+356', regions: ['MT'], fallbackLabel: 'Malta' },
  { value: '+358', regions: ['FI'], fallbackLabel: 'Finland' },
  { value: '+359', regions: ['BG'], fallbackLabel: 'Bulgaria' },
  { value: '+370', regions: ['LT'], fallbackLabel: 'Lithuania' },
  { value: '+371', regions: ['LV'], fallbackLabel: 'Latvia' },
  { value: '+372', regions: ['EE'], fallbackLabel: 'Estonia' },
  { value: '+380', regions: ['UA'], fallbackLabel: 'Ukraine' },
  { value: '+385', regions: ['HR'], fallbackLabel: 'Croatia' },
  { value: '+386', regions: ['SI'], fallbackLabel: 'Slovenia' },
  { value: '+420', regions: ['CZ'], fallbackLabel: 'Czech Republic' },
  { value: '+421', regions: ['SK'], fallbackLabel: 'Slovakia' },
  { value: '+852', regions: ['HK'], fallbackLabel: 'Hong Kong' },
  { value: '+853', regions: ['MO'], fallbackLabel: 'Macau' },
  { value: '+855', regions: ['KH'], fallbackLabel: 'Cambodia' },
  { value: '+856', regions: ['LA'], fallbackLabel: 'Laos' },
  { value: '+880', regions: ['BD'], fallbackLabel: 'Bangladesh' },
  { value: '+886', regions: ['TW'], fallbackLabel: 'Taiwan' },
  { value: '+960', regions: ['MV'], fallbackLabel: 'Maldives' },
  { value: '+962', regions: ['JO'], fallbackLabel: 'Jordan' },
  { value: '+963', regions: ['SY'], fallbackLabel: 'Syria' },
  { value: '+964', regions: ['IQ'], fallbackLabel: 'Iraq' },
  { value: '+965', regions: ['KW'], fallbackLabel: 'Kuwait' },
  { value: '+966', regions: ['SA'], fallbackLabel: 'Saudi Arabia' },
  { value: '+971', regions: ['AE'], fallbackLabel: 'United Arab Emirates' },
  { value: '+972', regions: ['IL'], fallbackLabel: 'Israel' },
  { value: '+974', regions: ['QA'], fallbackLabel: 'Qatar' },
  { value: '+975', regions: ['BT'], fallbackLabel: 'Bhutan' },
  { value: '+976', regions: ['MN'], fallbackLabel: 'Mongolia' },
  { value: '+977', regions: ['NP'], fallbackLabel: 'Nepal' },
  { value: '+998', regions: ['UZ'], fallbackLabel: 'Uzbekistan' },
];

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

function getRegionDisplayNames(locale: string): Intl.DisplayNames | null {
  if (displayNamesCache.has(locale)) return displayNamesCache.get(locale) ?? null;

  const formatter = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([locale], { type: 'region' })
    : null;

  displayNamesCache.set(locale, formatter);
  return formatter;
}

function getLocalizedRegionName(regionCode: string, locale: string): string {
  const localized = getRegionDisplayNames(locale)?.of(regionCode);
  return localized || regionCode;
}

export function getPhoneCountryCodeOptions(locale = 'en'): PhoneCountryCodeOption[] {
  return PHONE_COUNTRY_CODE_DEFINITIONS.map((entry) => {
    const regionLabel = entry.regions
      .map((regionCode) => getLocalizedRegionName(regionCode, locale))
      .filter((label, index, labels) => labels.indexOf(label) === index)
      .join(' / ');

    return {
      value: entry.value,
      label: `${regionLabel || entry.fallbackLabel} (${entry.value})`,
    };
  });
}

export const PHONE_COUNTRY_CODE_OPTIONS = getPhoneCountryCodeOptions('en');
export const DEFAULT_PHONE_COUNTRY_CODE = '+65';
