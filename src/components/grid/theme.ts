import { themeQuartz } from 'ag-grid-community'

/** AG Grid teması: renkler CSS değişkenlerinden gelir, açık/koyu temada otomatik uyar. */
export const gridTheme = themeQuartz.withParams({
  browserColorScheme: 'inherit',
  backgroundColor: 'var(--card)',
  foregroundColor: 'var(--fg)',
  headerBackgroundColor: 'var(--card)',
  headerTextColor: 'var(--fg-2)',
  borderColor: 'var(--border)',
  rowHoverColor: 'var(--wash)',
  accentColor: 'var(--series-1)',
  chromeBackgroundColor: 'var(--card)',
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  wrapperBorderRadius: 12,
  inputBackgroundColor: 'var(--card)',
  menuBackgroundColor: 'var(--card)',
})

export { AG_GRID_LOCALE_TR as gridLocale } from '@ag-grid-community/locale'
