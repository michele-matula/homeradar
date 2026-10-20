import { normalize } from '@/core/lead-filters';
import type { PropertyCategory } from '@/shared/types';

// Parole della tipologia come la scrivono i portali, su testo normalizzato (minuscole, senza accenti né punteggiatura).
// Prima le categorie non residenziali: "Terreni e rustici" è un terreno, "Rustico - Casale" una casa.
// "locale" da solo è un locale commerciale; "bilocale" e simili restano case perché la parola è un'altra.
const RULES: [RegExp, PropertyCategory][] = [
  [/\b(box|garage|posto auto|posti auto|autorimessa)\b/, 'garage'],
  [/\b(terreno|terreni)\b/, 'land'],
  [/\b(negozi|negozio|uffici|ufficio|locale|locali|capannone|capannoni|laboratorio|laboratori|magazzino|magazzini|deposito|depositi|coworking)\b/, 'commercial'],
  [/\b(appartamento|appartamenti|attico|mansarda|villa|ville|villetta|villette|casa|case|casale|rustico|loft|monolocale|bilocale|trilocale|quadrilocale|plurilocale|pentalocale|palazzo|edificio|stanza)\b/, 'residential'],
];

/** Categoria dalla tipologia del portale; null se la tipologia manca o non la dice. */
export function categoryFromTypology(typology: string | null | undefined): PropertyCategory | null {
  if (!typology) return null;
  const t = normalize(typology);
  for (const [re, category] of RULES) if (re.test(t)) return category;
  return null;
}
