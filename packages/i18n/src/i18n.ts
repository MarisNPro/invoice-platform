export type Locale = 'en' | 'fi' | 'et' | 'lv' | 'lt';

type Translations = Record<string, string>;
type Catalog = Record<Locale, Translations>;

const catalog: Catalog = {
  en: {
    'invoice.title': 'Invoice',
    'invoice.credit_note': 'Credit Note',
    'invoice.debit_note': 'Debit Note',
    'invoice.number': 'Invoice Number',
    'invoice.issued_at': 'Issue Date',
    'invoice.due_at': 'Due Date',
    'invoice.subtotal': 'Subtotal',
    'invoice.tax': 'VAT',
    'invoice.total': 'Total Due',
    'invoice.from': 'From',
    'invoice.to': 'To',
    'invoice.line.description': 'Description',
    'invoice.line.quantity': 'Qty',
    'invoice.line.unit_price': 'Unit Price',
    'invoice.line.total': 'Line Total',
  },
  fi: {
    'invoice.title': 'Lasku',
    'invoice.credit_note': 'Hyvityslasku',
    'invoice.number': 'Laskunumero',
    'invoice.issued_at': 'Laskupäivä',
    'invoice.due_at': 'Eräpäivä',
    'invoice.subtotal': 'Välisumma',
    'invoice.tax': 'ALV',
    'invoice.total': 'Yhteensä',
    'invoice.from': 'Lähettäjä',
    'invoice.to': 'Vastaanottaja',
    'invoice.line.description': 'Kuvaus',
    'invoice.line.quantity': 'Määrä',
    'invoice.line.unit_price': 'Yksikköhinta',
    'invoice.line.total': 'Yhteensä',
  },
  et: {
    'invoice.title': 'Arve',
    'invoice.credit_note': 'Kreeditarve',
    'invoice.number': 'Arve number',
    'invoice.issued_at': 'Väljastamise kuupäev',
    'invoice.due_at': 'Maksetähtaeg',
    'invoice.subtotal': 'Vahesumma',
    'invoice.tax': 'KM',
    'invoice.total': 'Kokku',
    'invoice.from': 'Saatja',
    'invoice.to': 'Saaja',
    'invoice.line.description': 'Kirjeldus',
    'invoice.line.quantity': 'Kogus',
    'invoice.line.unit_price': 'Ühikuhind',
    'invoice.line.total': 'Kokku',
  },
  lv: {
    'invoice.title': 'Rēķins',
    'invoice.credit_note': 'Kredītrēķins',
    'invoice.number': 'Rēķina numurs',
    'invoice.issued_at': 'Izrakstīšanas datums',
    'invoice.due_at': 'Apmaksas termiņš',
    'invoice.subtotal': 'Starpkopā',
    'invoice.tax': 'PVN',
    'invoice.total': 'Kopā',
    'invoice.from': 'No',
    'invoice.to': 'Kam',
    'invoice.line.description': 'Apraksts',
    'invoice.line.quantity': 'Daudzums',
    'invoice.line.unit_price': 'Vienības cena',
    'invoice.line.total': 'Kopā',
  },
  lt: {
    'invoice.title': 'Sąskaita',
    'invoice.credit_note': 'Kreditinė sąskaita',
    'invoice.number': 'Sąskaitos numeris',
    'invoice.issued_at': 'Išrašymo data',
    'invoice.due_at': 'Apmokėjimo terminas',
    'invoice.subtotal': 'Tarpinė suma',
    'invoice.tax': 'PVM',
    'invoice.total': 'Suma',
    'invoice.from': 'Nuo',
    'invoice.to': 'Kam',
    'invoice.line.description': 'Aprašymas',
    'invoice.line.quantity': 'Kiekis',
    'invoice.line.unit_price': 'Vieneto kaina',
    'invoice.line.total': 'Iš viso',
  },
};

export type TranslationKey = keyof typeof catalog['en'];

let currentLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: TranslationKey, locale?: Locale): string {
  const l = locale ?? currentLocale;
  return catalog[l]?.[key] ?? catalog['en'][key] ?? key;
}
