<script lang="ts">
  import { onDestroy } from 'svelte';
  import { sidebarState } from './sidebarStore';
  import { searchMarkdownFiles, type SearchResult } from './workspace';

  type Props = {
    onOpenFile: (path: string) => Promise<boolean>;
    onError: (message: string) => void;
  };

  let { onOpenFile, onError }: Props = $props();
  let query = $state('');
  let results = $state<SearchResult[]>([]);
  let searching = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  function scheduleSearch() {
    clearTimeout(timer);
    const currentGeneration = ++generation;
    const root = $sidebarState.workspacePath;
    const requestedQuery = query.trim();
    if (!root || !requestedQuery) {
      results = [];
      searching = false;
      return;
    }
    searching = true;
    timer = setTimeout(async () => {
      try {
        const matches = await searchMarkdownFiles(
          root,
          requestedQuery,
          () => currentGeneration === generation,
        );
        if (currentGeneration === generation) results = matches;
      } catch (cause) {
        if (currentGeneration === generation) {
          onError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (currentGeneration === generation) searching = false;
      }
    }, 300);
  }

  onDestroy(() => {
    generation += 1;
    clearTimeout(timer);
  });
</script>

<header class="sidebar-title">SEARCH</header>

{#if !$sidebarState.workspacePath}
  <div class="search-empty">Abra uma pasta no Explorer para pesquisar.</div>
{:else}
  <div class="search-box">
    <input
      bind:value={query}
      oninput={scheduleSearch}
      placeholder="Pesquisar em arquivos .md"
      aria-label="Pesquisar no workspace"
      spellcheck="false"
    />
  </div>
  {#if query.trim()}
    <div class="search-count">
      {#if searching}Pesquisando…{:else}{results.length} resultado{results.length === 1
          ? ''
          : 's'}{/if}
    </div>
  {/if}
  <div class="search-results">
    {#each results as result (result.path)}
      <button onclick={() => onOpenFile(result.path)} title={result.path}>
        <strong>{result.relativePath}</strong>
        <span>{result.snippet || '(linha vazia)'}</span>
      </button>
    {/each}
  </div>
{/if}
