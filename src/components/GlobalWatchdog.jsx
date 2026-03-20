import { useEffect } from 'react';
import { installGlobalRuntimeWatchdog } from '../lib/runtimeWatchdog';

export default function GlobalWatchdog() {
  useEffect(() => {
    installGlobalRuntimeWatchdog();
  }, []);

  return null;
}
