import {dictionaries} from './locales.js';
export function canonicalLocale(value) {
  try {return new Intl.Locale(value || 'en').baseName;} catch {return 'en';}
}
export function localeCandidates(value) {
  const locale = new Intl.Locale(canonicalLocale(value));
  const candidates = [locale.baseName];
  if (locale.language === 'zh') candidates.push(locale.maximize().script === 'Hant' ? 'zh-TW' : 'zh-CN');
  if (locale.script) candidates.push(locale.language + '-' + locale.script);
  candidates.push(locale.language, 'en');
  return [...new Set(candidates)];
}
export function direction(locale) {
  return ['ar','he','fa','ur','ps','dv','yi','sd','ug'].includes(new Intl.Locale(canonicalLocale(locale)).language) ? 'rtl' : 'ltr';
}
export async function loadDictionary(locale, files = {}) {
  for (const candidate of localeCandidates(locale)) {
    if (Object.hasOwn(dictionaries, candidate)) return {locale:candidate, messages:{...dictionaries.en,...dictionaries[candidate]}};
    const file = files[candidate];
    if (typeof file !== 'string' || !/^languages\/[A-Za-z0-9-]+\.[a-f0-9]{16}\.json$/.test(file)) continue;
    try {
      const response = await fetch('/commentnest/' + file, {credentials:'omit', redirect:'error'});
      if (!response.ok) continue;
      const pack = await response.json();
      if (!pack || Array.isArray(pack) || Object.entries(pack).some(([key,value]) => !Object.hasOwn(dictionaries.en,key) || typeof value !== 'string' || value.length > 2000)) continue;
      return {locale:candidate, messages:{...dictionaries.en,...pack}};
    } catch { /* A failed language pack falls back without disabling the widget. */ }
  }
  return {locale:'en',messages:dictionaries.en};
}
