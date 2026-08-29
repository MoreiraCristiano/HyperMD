import { mount } from 'svelte';
import App from '@/app/App.svelte';
import './styles/index.css';
import { initializeSettings } from '@/features/settings';

async function start() {
  await initializeSettings();
  mount(App, { target: document.getElementById('app')! });
}

void start();
