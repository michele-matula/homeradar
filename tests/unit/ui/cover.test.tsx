import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Cover } from '@/ui/sidepanel/Cover';

afterEach(cleanup);
const HREF = 'https://www.immobiliare.it/annunci/1/';
const A = 'https://pwm.im-cdn.it/image/1/xxs-c.jpg';
const B = 'https://img4.idealista.it/2.jpg';

describe('Cover', () => {
  it("mostra la prima copertina, pigra e senza referrer, dentro il link all'annuncio", () => {
    const { container } = render(<Cover covers={[A, B]} href={HREF} />);
    const link = screen.getByRole('link', { name: "Apri l'annuncio" });
    expect(link.getAttribute('href')).toBe(HREF);
    expect(link.getAttribute('rel')).toBe('noreferrer');
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(A);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('se la foto non si carica passa alla successiva, poi al riquadro neutro', () => {
    const { container } = render(<Cover covers={[A, B]} href={HREF} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')!.getAttribute('src')).toBe(B);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.cover--empty svg')).not.toBeNull();
  });

  it('senza copertine: riquadro neutro', () => {
    const { container } = render(<Cover covers={[]} href={HREF} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.cover--empty')).not.toBeNull();
  });
});
