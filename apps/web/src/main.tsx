// Fonts are bundled with the app (no requests to Google): Manrope for
// English (one variable file covers weights 400 to 800) and Noto Kufi Arabic
// 400 and 700 for Arabic. The browser only downloads the letters a page uses.
import '@fontsource-variable/manrope';
import '@fontsource/noto-kufi-arabic/400.css';
import '@fontsource/noto-kufi-arabic/700.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { I18nProvider } from './i18n.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
