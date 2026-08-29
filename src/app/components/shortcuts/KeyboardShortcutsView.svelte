<script lang="ts">
  import { shortcutEntries } from '../../commands';

  const categories = [...new Set(shortcutEntries.map((entry) => entry.category))];
</script>

<section class="shortcuts-view" aria-labelledby="shortcuts-title">
  <div class="shortcuts-content">
    <header class="shortcuts-header">
      <p>Preferences</p>
      <h1 id="shortcuts-title">Keyboard Shortcuts</h1>
      <span>Commands and editor shortcuts available in HyperMD.</span>
    </header>

    {#each categories as category}
      <section class="shortcuts-group" aria-labelledby={`shortcut-${category}`}>
        <h2 id={`shortcut-${category}`}>{category}</h2>
        <div class="shortcuts-list">
          {#each shortcutEntries.filter((entry) => entry.category === category) as entry}
            <div class="shortcut-row">
              <div>
                <strong>{entry.label}</strong>
                <span>{entry.description}</span>
              </div>
              {#if entry.when}<small>{entry.when}</small>{/if}
              <kbd>{entry.shortcut}</kbd>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</section>
