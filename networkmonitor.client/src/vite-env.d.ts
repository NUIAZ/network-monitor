/// <reference types="vite/client" />

/**
 * Static image imports resolve to their bundled URL. Declared here because the
 * sidebar imports the product logo directly from src/.
 */
declare module '*.png' {
  const src: string;
  export default src;
}
