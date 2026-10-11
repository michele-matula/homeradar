import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { send } from '@/shared/messages';

afterEach(() => vi.restoreAllMocks());

// Nei typings WXT sendMessage restituisce Promise<void>; le risposte reali sono Response<T>.
const runtime = browser.runtime as unknown as { sendMessage: (msg: unknown) => Promise<unknown> };

describe('send', () => {
  it('restituisce i dati della risposta', async () => {
    vi.spyOn(runtime, 'sendMessage').mockResolvedValue({ ok: true, data: 42 });
    await expect(send({ type: 'listLeads' })).resolves.toBe(42);
  });

  it('trasforma gli errori del background in eccezioni', async () => {
    vi.spyOn(runtime, 'sendMessage').mockResolvedValue({ ok: false, error: 'Annuncio non trovato' });
    await expect(send({ type: 'listLeads' })).rejects.toThrow('Annuncio non trovato');
  });

  it('ritenta una volta se il service worker non risponde', async () => {
    const spy = vi.spyOn(runtime, 'sendMessage')
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ ok: true, data: 'ok' });
    await expect(send({ type: 'listLeads' })).resolves.toBe('ok');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
