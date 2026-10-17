/**
 * Versione dell'informativa. Si alza solo se cambia cosa viene salvato o come viene usato
 * (es. nuovi dati del lead): l'agente deve riconfermare. Refusi e legenda non la alzano.
 */
export const ONBOARDING_VERSION = 5;

/** Voci del riquadro "Cosa è cambiato", per versione dell'informativa. */
export const ONBOARDING_CHANGES: Record<number, string[]> = {
  2: ['HomeRadar ora salva la data di ricontatto che imposti su un lead: resta sul tuo browser, come stati e note.'],
  3: ['HomeRadar ora riconosce lo stesso immobile pubblicato su più portali e lo mostra come un solo lead. Se separi due annunci uniti per errore, la scelta resta salvata sul tuo browser.'],
  4: ["HomeRadar ora riconosce un annuncio tolto e ripubblicato sullo stesso portale: il lead tiene età, storico prezzi, stato e note dell'annuncio precedente, che resta salvato finché rivedi la ripubblicazione."],
  5: [
    "HomeRadar ora invia ogni giorno al gestore del pilota statistiche d'uso anonime ed errori tecnici, con il codice pilota della tua agenzia: mai annunci, indirizzi, prezzi o note. Puoi spegnere l'invio dalle impostazioni, dove trovi anche il modulo per mandare un feedback.",
  ],
};

/** Vero se l'informativa non è mai stata confermata o è stata confermata in una versione precedente. */
export function needsOnboarding(acceptedVersion: number | null, current = ONBOARDING_VERSION): boolean {
  return acceptedVersion === null || acceptedVersion < current;
}

/** Novità delle versioni successive a quella confermata; vuoto alla prima conferma. */
export function changesSince(acceptedVersion: number | null, changes = ONBOARDING_CHANGES, current = ONBOARDING_VERSION): string[] {
  if (acceptedVersion === null) return [];
  const out: string[] = [];
  for (let v = acceptedVersion + 1; v <= current; v++) out.push(...(changes[v] ?? []));
  return out;
}
