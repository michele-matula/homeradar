import { z } from 'zod';

// Gli oggetti zod scartano le chiavi non dichiarate: questa è la lista dei campi ammessi.
// Telefoni, nomi e descrizioni non sono dichiarati e quindi non escono mai; della foto resta solo l'URL piccolo della copertina.
export const LoweredPriceSchema = z.object({
  originalPrice: z.string(),
  currentPrice: z.string(),
  discountPercentage: z.string(),
  date: z.string(),
});

export const PriceSchema = z.object({
  visible: z.boolean().optional(),
  value: z.number().nullish(),
  loweredPrice: LoweredPriceSchema.nullish(),
});

export const LocationSchema = z.object({
  address: z.string().nullish(),
  city: z.string().nullish(),
  macrozone: z.string().nullish(),
  microzone: z.string().nullish(),
});

export const PropertySchema = z.object({
  surface: z.string().nullish(),
  rooms: z.string().nullish(),
  typology: z.object({ name: z.string() }).nullish(),
  location: LocationSchema.nullish(),
  // Copertina: solo l'URL piccolo. Una forma inattesa diventa null e non scarta la proprietà.
  photo: z.object({ urls: z.object({ small: z.string() }) }).nullish().catch(null),
});

export const AdvertiserSchema = z.object({
  agency: z.object({ type: z.string() }).nullish(),
  supervisor: z.object({ type: z.string() }).nullish(),
});

export const RealEstateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  contract: z.string(),
  price: PriceSchema,
  properties: z.array(PropertySchema).min(1),
  advertiser: AdvertiserSchema.nullish(),
  createdAt: z.number().nullish(),
});

export const SearchResultSchema = z.object({
  realEstate: RealEstateSchema,
  seo: z.object({ url: z.string() }).nullish(),
});

export type RealEstate = z.infer<typeof RealEstateSchema>;
