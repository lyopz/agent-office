import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store/store';
import './styles/app.css';

// dev builds expose the store for browser tests and debugging
if (import.meta.env.DEV) (window as unknown as { __office: typeof useStore }).__office = useStore;

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
