import { create } from 'zustand';
import { isDesktop } from './platform';
interface InstallEvent extends Event { prompt(): Promise<{outcome: string}> }
interface PwaState { ready: boolean; failed: boolean; update: ServiceWorker | null; install: InstallEvent | null }
export const usePwa = create<PwaState>(() => ({ ready: false, failed: false, update: null, install: null }));
let registration: Promise<ServiceWorkerRegistration> | null = null;
export function startPwa() {
  if (isDesktop || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); usePwa.setState({ install: event as InstallEvent });
  });
  window.addEventListener('appinstalled', () => usePwa.setState({ install: null }));
  registration = navigator.serviceWorker.register(new URL('service-worker.js', document.baseURI), { updateViaCache: 'none' });
  void registration.then((reg) => {
    const inspect = () => {
      usePwa.setState({ update: reg.active && navigator.serviceWorker.controller ? reg.waiting : null });
    };
    inspect();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        inspect();
        if (worker.state === 'redundant') usePwa.setState({ failed: true });
      });
    });
    void navigator.serviceWorker.ready.then(() => { usePwa.setState({ ready: true }); inspect(); });
    navigator.serviceWorker.addEventListener("controllerchange", inspect);
  }).catch(() => usePwa.setState({ failed: true }));
}
export async function retryOffline() {
  usePwa.setState({ failed: false });
  try { await (await registration)?.update(); }
  catch { usePwa.setState({ failed: true }); }
}
