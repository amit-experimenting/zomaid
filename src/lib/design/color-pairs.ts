export type ColorPair = {
  /** Hex foreground (e.g. "#111111"). */
  fg: string;
  /** Hex background (e.g. "#FAF7F2"). */
  bg: string;
  /** WCAG ratio required. 4.5 = AA body, 3.0 = AA large text / non-text. */
  min: 4.5 | 3.0;
  /** Human label used in failure messages. */
  label: string;
};

export const colorPairs: ColorPair[] = [];
