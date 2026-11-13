import { Download, RefreshCw, WifiOff } from 'lucide-react';
import { usePwa, retryOffline } from '@/lib/pwa';
import { autosave } from '@/lib/session';
import { isDesktop } from '@/lib/platform';
import { Button } from './ui/button';
export function AppAvailability() {
  const {ready, failed, update, install} = usePwa();
  if (isDesktop || !import.meta.env.PROD) return null;
  return <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground" aria-live="polite">
    <span className="inline-flex items-center gap-1"><WifiOff className="size-3.5" />{failed ? 'Offline setup failed' : ready ? 'Available offline' : 'Preparing offline use…'}</span>
    {failed ? <Button size="sm" onClick={() => retryOffline()}>Retry</Button> : null}
    {install ? <Button size="sm" onClick={async () => { await install.prompt(); usePwa.setState({ install: null }); }}><Download />Install app</Button> : null}
    {update ? <Button size="sm" onClick={async () => {
      if (!(await autosave())) return;
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {once: true});
      update.postMessage('ACTIVATE_UPDATE');
    }}><RefreshCw />Update app</Button> : null}
  </div>;
}
