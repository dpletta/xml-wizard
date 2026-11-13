/// <reference types="vite/client" />
declare module "@core";
declare module "*.png" {
  const src: string;
  export default src;
}
declare const __APP_VERSION__: string;
