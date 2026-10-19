import { Decimal } from 'decimal.js';

// Isolated configuration: enough significant digits for bounded package/item
// quantities and six-decimal values, without changing another library's defaults.
export const QuoteDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export type { Decimal };
