import { z } from 'zod';

// Gli oggetti zod scartano le chiavi non dichiarate: questa è la lista dei campi ammessi.
// Di advertiser restano solo company e type: nome, telefono, userId e negozio non escono mai.
// body (descrizione) e immagini non sono dichiarati.
const ValuesSchema = z.array(z.object({ key: z.string() }));
const GeoValueSchema = z.object({ value: z.string() }).nullish();

export const CommonAdSchema = z.object({
  urn: z.string().regex(/:list:\d+$/),
  type: z.object({ key: z.string() }),
  subject: z.string(),
  advertiser: z.object({ company: z.boolean(), type: z.number().nullish() }),
  geo: z.object({ town: GeoValueSchema, zone: GeoValueSchema }).nullish(),
  urls: z.object({ default: z.string() }),
});

/** Annuncio in __NEXT_DATA__: features indicizzate per uri, data di rinnovo in date. */
export const NextAdSchema = CommonAdSchema.extend({
  category: z.object({ label: z.string() }),
  date: z.string().nullish(),
  features: z.record(z.string(), z.object({ values: ValuesSchema })).nullish(),
});

/** Annuncio nella risposta di hades: features in array, data di rinnovo in dates.display. */
// Anche la categoria ha un'altra forma: { key, value, macrocategory_id } invece di { id, label, parentId }.
export const ApiAdSchema = CommonAdSchema.extend({
  category: z.object({ value: z.string() }),
  dates: z.object({ display: z.string() }).nullish(),
  features: z.array(z.object({ uri: z.string(), values: ValuesSchema })).nullish(),
});

export type CommonAd = z.infer<typeof CommonAdSchema>;
