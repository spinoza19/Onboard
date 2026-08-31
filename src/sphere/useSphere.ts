import { useContext } from 'react';
import { SphereContext, type SphereContextValue } from './SphereProvider';

export function useSphere(): SphereContextValue {
  const ctx = useContext(SphereContext);
  if (!ctx) throw new Error('useSphere must be used inside <SphereProvider>');
  return ctx;
}
