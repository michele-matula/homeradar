import { createRoot } from 'react-dom/client';
import { Onboarding } from '@/ui/onboarding/Onboarding';
import { defaultApi } from '@/ui/sidepanel/api';
import { Logo } from '@/ui/sidepanel/Icons';
import '@/ui/sidepanel/styles.css';

// Scheda aperta dal background all'installazione (e dopo un aggiornamento dell'informativa).
createRoot(document.getElementById('root')!).render(
  <main className="onboarding-page">
    <header className="panel__header">
      <div className="brand">
        <Logo size={28} />
        <div>
          <div className="brand__name">HomeRadar</div>
          <div className="brand__sub">Benvenuto</div>
        </div>
      </div>
    </header>
    <Onboarding api={defaultApi} mode="confirm" />
  </main>,
);
