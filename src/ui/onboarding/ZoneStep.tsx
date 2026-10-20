import { useState } from 'react';
import type { SearchArea, Settings } from '@/shared/types';
import type { Api } from '@/ui/sidepanel/api';
import { ZoneEditor } from '@/ui/sidepanel/ZoneEditor';

const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;

/** Dopo la conferma dell'informativa: comuni e categorie, salvati a ogni modifica. Si può saltare. */
export function ZoneStep({ api, initial }: { api: Pick<Api, 'saveSettings'>; initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function change(searchArea: SearchArea) {
    try {
      setSettings(await api.saveSettings({ ...settings, searchArea }));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="card">
      <h2 className="onboarding__h">La tua zona</h2>
      <p>
        Scegli i comuni in cui lavori: quando premi «Cerca» nel pannello, HomeRadar apre le loro ricerche e aggiorna i lead.
        Puoi farlo anche dopo, dalle impostazioni.
      </p>
      {error && <p className="banner banner--error"><span>{error}</span></p>}
      <ZoneEditor value={settings.searchArea} onChange={(a) => void change(a)} />
    </section>
  );
}
