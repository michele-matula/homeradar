import { exportFileName, toCsv, toExportRows, toXlsx } from '@/core/export';
import type { LeadView } from '@/shared/types';
import { downloadBlob } from './download';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function ExportBar({ leads, download = downloadBlob }: { leads: LeadView[]; download?: (b: Blob, name: string) => void }) {
  const rows = () => toExportRows(leads);
  return (
    <footer className="export">
      <button type="button" onClick={() => download(new Blob([toXlsx(rows()) as BlobPart], { type: XLSX_TYPE }), exportFileName('xlsx', Date.now()))}>
        ⬇ Esporta XLSX
      </button>
      <button type="button" onClick={() => download(new Blob([toCsv(rows())], { type: 'text/csv;charset=utf-8' }), exportFileName('csv', Date.now()))}>
        ⬇ CSV
      </button>
      <span className="export__hint">Esporta la vista corrente</span>
    </footer>
  );
}
