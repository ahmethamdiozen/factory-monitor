/**
 * Derleme modu (sadece tarayıcı kodu içindir; sunucu tarafı bu dosyayı import etmez).
 * `vite --mode demo` ile .env.demo'daki VITE_DATA_MODE=demo okunur → web demosu.
 */
export const IS_DEMO = import.meta.env.VITE_DATA_MODE === 'demo'
