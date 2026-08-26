import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css';
import { initializeSettings } from './lib/settings/settingsStore';

async function start() {
  await initializeSettings();
  mount(App, { target: document.getElementById('app')! });
}

void start();
