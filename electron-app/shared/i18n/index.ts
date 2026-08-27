import nl from './nl.json';
import en from './en.json';

export type Lang = 'nl' | 'en';

const tables: Record<Lang, Record<string, string>> = { nl, en };

/** Kotlin `Strings.t` parity: active language → NL fallback → raw key. */
export function t(key: string, lang: Lang = 'nl'): string {
  return tables[lang][key] ?? tables.nl[key] ?? key;
}

/** Fill `{placeholder}` slots: format('subjApproval', {project: 'X', phase: '1. Y'}). */
export function format(
  key: string,
  params: Record<string, string | number>,
  lang: Lang = 'nl',
): string {
  let out = t(key, lang);
  for (const [name, value] of Object.entries(params)) {
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

export const availableKeys: string[] = Object.keys(nl);
