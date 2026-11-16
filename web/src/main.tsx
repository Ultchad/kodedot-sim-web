import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';
import { HostProvider } from './state/host';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <HostProvider>
      <App />
    </HostProvider>
  </I18nProvider>,
);
