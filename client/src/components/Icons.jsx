/* Symbole.
 *
 * Vorher standen an einigen Stellen Emojis im Text: 📸 fuer das Bild, 💾 fuer
 * die Datei, 👁 fuer die Sichtbarkeit, ✕ zum Schliessen. Emojis sind Zeichen
 * und keine Symbole -- jedes System zeichnet sie anders, sie tragen ihre eigene
 * Farbe mitten in eine einfarbige Leiste, sie lassen sich nicht auf die
 * Schriftfarbe einfaerben und stehen nie ganz auf der Grundlinie.
 *
 * Deshalb dieselbe Machart wie in der Werkzeugleiste: viewBox 0 0 24 24, keine
 * Fuellung, Strich in currentColor. Groesse und Strichstaerke kommen aus dem
 * Stylesheet, damit ein Symbol im Menue anders wirken kann als eines in einem
 * Knopf, ohne dass hier etwas doppelt steht.
 */

const S = ({ children }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
);

export const IconBild = () => (
  <S>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="10" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </S>
);

export const IconStift = () => (
  <S>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </S>
);

export const IconBlatt = () => (
  <S>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <polyline points="14 3 14 8 19 8" />
  </S>
);

export const IconDrucker = () => (
  <S>
    <polyline points="6 9 6 3 18 3 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" rx="1" />
  </S>
);

export const IconSpeichern = () => (
  <S>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </S>
);

export const IconOeffnen = () => (
  <S>
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
  </S>
);

export const IconAuge = () => (
  <S>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </S>
);

export const IconAugeZu = () => (
  <S>
    <path d="M2 12s3.5-7 10-7c2 0 3.7.6 5.1 1.5M22 12s-3.5 7-10 7c-2 0-3.7-.6-5.1-1.5" />
    <line x1="3" y1="3" x2="21" y2="21" />
  </S>
);

export const IconKreuz = () => (
  <S>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </S>
);

export const IconSenden = () => (
  <S>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9" />
  </S>
);

export const IconKette = () => (
  <S>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </S>
);

export const IconDeckkraft = () => (
  <S>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
  </S>
);

export const IconPruefen = () => (
  <S>
    <polyline points="20 6 9 17 4 12" />
  </S>
);
