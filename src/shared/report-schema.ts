// Schema del report e del feedback per la misura del pilota.
// Copiato identico in worker/src/schema.ts: un test fallisce se i due file divergono.
import { z } from 'zod';

export const PILOT_CODE_RE = /^[A-Z0-9-]{4,32}$/;
export const FEEDBACK_MAX = 2000;

const portal = z.enum(['immobiliare', 'idealista', 'subito', 'casadaprivato']);
const priority = z.enum(['high', 'medium', 'verify', 'none']);
const status = z.enum(['new', 'to_contact', 'contacted', 'discarded']);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);
const pilotCode = z.string().regex(PILOT_CODE_RE);
const version = z.string().min(1).max(32);

// Gli schemi sono la lista dei campi ammessi: z.object scarta tutto ciò che non è dichiarato.
export const UsageReportSchema = z.object({
  formatVersion: z.literal(1),
  installId: z.uuid(),
  pilotCode,
  version,
  sentAt: z.number().int(),
  timezoneOffset: z.number().int().min(-900).max(900),
  enabledPortals: z.array(portal).max(4),
  usage: z.object({
    browsingDays: z.array(day).max(400),
    panelDays: z.array(day).max(400),
    statusChanges: z.partialRecord(status, count),
    recallsSet: count,
    notesWritten: count,
    exports: z.object({ xlsx: count, csv: count }),
    firstActiveDay: day.nullable(),
    lastActiveDay: day.nullable(),
  }),
  leads: z.object({
    total: count,
    byPortal: z.record(portal, count),
    byPriority: z.record(priority, count),
    newLast7Days: count,
  }),
  technical: z.object({
    counters: z.record(z.string().max(40), count),
    adapterWarning: z.array(portal).max(3),
    errors: z.array(z.object({ at: z.number().int(), message: z.string().max(200) })).max(20),
  }),
});
export type UsageReport = z.infer<typeof UsageReportSchema>;

export const FeedbackSchema = z.object({
  id: z.uuid(),
  installId: z.uuid(),
  pilotCode,
  version,
  text: z.string().trim().min(1).max(FEEDBACK_MAX),
  createdAt: z.number().int(),
});
export type FeedbackPayload = z.infer<typeof FeedbackSchema>;
