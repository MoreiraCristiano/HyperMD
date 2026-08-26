<script lang="ts">
  import { workspaceImageUrl } from '../images/localImage';
  import { sidebarState } from '../sidebar/sidebarStore';

  type Props = {
    path: string;
    missing?: boolean;
  };

  let { path, missing = false }: Props = $props();
  let source = $state('');
  let loadError = $state('');
  let fit = $state(true);
  let zoom = $state(1);
  let naturalWidth = $state(0);
  let naturalHeight = $state(0);
  let requestId = 0;

  const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];

  function actualSize() {
    fit = false;
    zoom = 1;
  }

  function fitWindow() {
    fit = true;
  }

  function changeZoom(direction: number) {
    const current = fit ? 1 : zoom;
    const next =
      direction > 0
        ? (ZOOM_LEVELS.find((level) => level > current) ?? 5)
        : ([...ZOOM_LEVELS].reverse().find((level) => level < current) ?? 0.1);
    fit = false;
    zoom = next;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      changeZoom(1);
    } else if (event.key === '-') {
      event.preventDefault();
      changeZoom(-1);
    } else if (event.key === '0') {
      event.preventDefault();
      fitWindow();
    }
  }

  $effect(() => {
    const workspace = $sidebarState.workspacePath;
    const currentPath = path;
    const currentRequest = ++requestId;
    source = '';
    loadError = '';
    fit = true;
    zoom = 1;
    naturalWidth = 0;
    naturalHeight = 0;
    if (!workspace) {
      loadError = 'Abra novamente o workspace para visualizar esta imagem.';
    } else if (missing) {
      loadError = 'O arquivo não existe mais no workspace.';
    } else {
      void workspaceImageUrl(currentPath)
        .then((url) => {
          if (requestId === currentRequest) source = url;
        })
        .catch((cause) => {
          if (requestId === currentRequest) {
            loadError = cause instanceof Error ? cause.message : String(cause);
          }
        });
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="image-viewer" aria-label={`Visualizador de ${path}`}>
  <div class="image-toolbar">
    <button onclick={() => changeZoom(-1)} title="Diminuir zoom" aria-label="Diminuir zoom"
      >−</button
    >
    <button class:active={fit} onclick={fitWindow}>Ajustar</button>
    <button class:active={!fit && zoom === 1} onclick={actualSize}>100%</button>
    <span>{fit ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
    <button onclick={() => changeZoom(1)} title="Aumentar zoom" aria-label="Aumentar zoom">+</button
    >
  </div>

  <div class="image-viewport">
    {#if loadError}
      <div class="image-error">{loadError}</div>
    {:else if source}
      <div class="image-canvas" class:fit>
        <img
          src={source}
          alt=""
          draggable="false"
          style:width={!fit && naturalWidth ? `${naturalWidth * zoom}px` : undefined}
          style:height={!fit && naturalHeight ? `${naturalHeight * zoom}px` : undefined}
          onload={(event) => {
            const image = event.currentTarget as HTMLImageElement;
            naturalWidth = image.naturalWidth;
            naturalHeight = image.naturalHeight;
          }}
          onerror={() => (loadError = 'Não foi possível carregar esta imagem.')}
        />
      </div>
    {:else}
      <div class="image-loading">Carregando imagem…</div>
    {/if}
  </div>
</section>
