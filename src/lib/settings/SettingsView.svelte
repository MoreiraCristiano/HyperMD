<script lang="ts">
  import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
  import { settingsActions, settingsStore } from './settingsStore';

  const fontSuggestions = [
    'Inter, "Segoe UI", sans-serif',
    '"Segoe UI", sans-serif',
    '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
    '"Cascadia Code", Consolas, monospace',
    '"Fira Code", Consolas, monospace',
    'Consolas, monospace',
  ];

  function numericValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }

  function textValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value;
  }

  async function resetSettings() {
    const confirmed = await confirmDialog('Restaurar apenas as configurações desta tela?', {
      title: 'Restaurar configurações',
      kind: 'warning',
    });
    if (confirmed) settingsActions.reset();
  }
</script>

<div class="settings-view">
  <div class="settings-content">
    <header class="settings-header">
      <h1>Settings</h1>
      <p>Personalize a aparência e o comportamento do editor.</p>
    </header>

    <section class="settings-section" aria-labelledby="appearance-settings">
      <h2 id="appearance-settings">Appearance</h2>
      <label class="setting-row">
        <span><strong>UI Font</strong><small>Fonte usada na interface do aplicativo.</small></span>
        <input
          list="ui-font-suggestions"
          value={$settingsStore.appearance.uiFontFamily}
          oninput={(event) => settingsActions.updateAppearance({ uiFontFamily: textValue(event) })}
        />
      </label>
      <label class="setting-row">
        <span><strong>UI Font Size</strong><small>Entre 10 e 20 pixels.</small></span>
        <input
          class="numeric-input"
          type="number"
          min="10"
          max="20"
          step="1"
          value={$settingsStore.appearance.uiFontSize}
          onchange={(event) =>
            settingsActions.updateAppearance({ uiFontSize: numericValue(event) })}
        />
      </label>
    </section>

    <section class="settings-section" aria-labelledby="editor-settings">
      <h2 id="editor-settings">Editor</h2>
      <label class="setting-row">
        <span
          ><strong>Editor Font</strong><small>Use fontes instaladas e inclua fallbacks.</small
          ></span
        >
        <input
          list="editor-font-suggestions"
          value={$settingsStore.editor.fontFamily}
          oninput={(event) => settingsActions.updateEditor({ fontFamily: textValue(event) })}
        />
      </label>
      <label class="setting-row">
        <span><strong>Editor Font Size</strong><small>Entre 10 e 32 pixels.</small></span>
        <input
          class="numeric-input"
          type="number"
          min="10"
          max="32"
          step="1"
          value={$settingsStore.editor.fontSize}
          onchange={(event) => settingsActions.updateEditor({ fontSize: numericValue(event) })}
        />
      </label>
      <label class="setting-row">
        <span><strong>Line Height</strong><small>Entre 1.2 e 2.2.</small></span>
        <input
          class="numeric-input"
          type="number"
          min="1.2"
          max="2.2"
          step="0.1"
          value={$settingsStore.editor.lineHeight}
          onchange={(event) => settingsActions.updateEditor({ lineHeight: numericValue(event) })}
        />
      </label>
      <label class="setting-row">
        <span
          ><strong>Content Width</strong><small>Largura máxima somente do documento Markdown.</small
          ></span
        >
        <select
          value={String($settingsStore.editor.maxWidth ?? 'full')}
          onchange={(event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            settingsActions.updateEditor({ maxWidth: value === 'full' ? null : Number(value) });
          }}
        >
          <option value="600">600 px</option>
          <option value="700">700 px</option>
          <option value="800">800 px</option>
          <option value="900">900 px</option>
          <option value="1000">1000 px</option>
          <option value="1200">1200 px</option>
          <option value="1400">1400 px</option>
          <option value="1600">1600 px</option>
          <option value="full">Full Width</option>
        </select>
      </label>
      <label class="setting-row setting-toggle">
        <span
          ><strong>Word Wrap</strong><small
            >Quebra linhas de texto; blocos de código permanecem intactos.</small
          ></span
        >
        <input
          type="checkbox"
          role="switch"
          checked={$settingsStore.editor.wordWrap}
          onchange={(event) =>
            settingsActions.updateEditor({
              wordWrap: (event.currentTarget as HTMLInputElement).checked,
            })}
        />
      </label>
      <div class="settings-preview" aria-label="Prévia do editor">
        <strong># Markdown</strong>
        <code>const hello = "world";</code>
        <span>Some <b>formatted text</b>.</span>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="file-settings">
      <h2 id="file-settings">Files</h2>
      <label class="setting-row setting-toggle">
        <span
          ><strong>Auto Save</strong><small
            >Salva arquivos alterados após 1 segundo sem digitação.</small
          ></span
        >
        <input
          type="checkbox"
          role="switch"
          checked={$settingsStore.files.autoSave}
          onchange={(event) =>
            settingsActions.updateFiles({
              autoSave: (event.currentTarget as HTMLInputElement).checked,
            })}
        />
      </label>
    </section>

    <section class="settings-section settings-advanced" aria-labelledby="advanced-settings">
      <h2 id="advanced-settings">Advanced</h2>
      <button class="reset-settings" onclick={resetSettings}>Reset to Defaults</button>
    </section>
  </div>

  <datalist id="ui-font-suggestions">
    {#each fontSuggestions as font}<option value={font}></option>{/each}
  </datalist>
  <datalist id="editor-font-suggestions">
    {#each fontSuggestions as font}<option value={font}></option>{/each}
  </datalist>
</div>
