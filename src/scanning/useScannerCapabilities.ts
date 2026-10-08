import { useEffect, useState } from 'react';
import { getScanCapabilities } from './native';
import type { ScanCapabilities } from './contract';

const unavailable: ScanCapabilities = {
  supported: false,
  platform: 'web',
  reason: 'Guided 3D scanning is available only on supported mobile devices.',
};

export function useScannerCapabilities(): ScanCapabilities {
  const [capabilities, setCapabilities] = useState<ScanCapabilities>(unavailable);
  useEffect(() => {
    let active = true;
    getScanCapabilities().then((value) => { if (active) setCapabilities(value); }).catch(() => {
      if (active) setCapabilities({ ...unavailable, reason: 'This device cannot start guided 3D scanning. You can enter or measure the dimensions here.' });
    });
    return () => { active = false; };
  }, []);
  return capabilities;
}
