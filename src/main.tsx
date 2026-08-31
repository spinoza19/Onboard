import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { SphereProvider } from './sphere/SphereProvider';
import './styles/globals.css';

// Buffer is referenced by parts of the Unicity stack that were written for Node.
import { Buffer } from 'buffer';
if (!(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SphereProvider>
      <App />
    </SphereProvider>
  </StrictMode>,
);
