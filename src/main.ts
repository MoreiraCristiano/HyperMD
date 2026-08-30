import { mount } from 'svelte';
import App from '@/app/App.svelte';
import './styles/index.css';
import { initializeDocumentSession } from '@/features/documents';
import { initializeSettings } from '@/features/settings';

async function start() {
  await Promise.all([initializeSettings(), initializeDocumentSession()]);
  mount(App, { target: document.getElementById('app')! });
  if (import.meta.env.VITE_HYPERMD_E2E === '1') {
    const { installE2eApi } = await import('@/app/e2eApi');
    installE2eApi();
  }
}

void start();
