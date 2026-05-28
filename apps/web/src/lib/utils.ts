import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Round to 2 decimal places */
export const round2 = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** Format as money string: 1234.5 → "1,234.50" */
export function fmtMoney(n: number): string {
  return n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Country code → flag emoji */
export const countryFlag: Record<string, string> = {
  FI: '🇫🇮', EE: '🇪🇪', LV: '🇱🇻', LT: '🇱🇹',
  DE: '🇩🇪', SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰',
  PL: '🇵🇱', FR: '🇫🇷', NL: '🇳🇱', GB: '🇬🇧',
};
export const getFlag = (cc: string) => countryFlag[cc.toUpperCase()] ?? '🏳️';
