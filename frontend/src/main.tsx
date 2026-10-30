import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { installJourney } from './journey';
import './index.css';
import { configureToastDeduplication } from './toastSetup.ts';

configureToastDeduplication();
installJourney();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
