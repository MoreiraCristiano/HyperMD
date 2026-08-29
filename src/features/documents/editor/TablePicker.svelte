<script lang="ts">
  import { tick } from 'svelte';

  type Props = {
    open: boolean;
    onSelect: (rows: number, columns: number) => void;
    onClose: () => void;
  };

  const MAX_ROWS = 10;
  const MAX_COLUMNS = 10;
  const cells = Array.from({ length: MAX_ROWS * MAX_COLUMNS }, (_, index) => ({
    row: Math.floor(index / MAX_COLUMNS) + 1,
    column: (index % MAX_COLUMNS) + 1,
  }));

  let { open, onSelect, onClose }: Props = $props();
  let grid = $state<HTMLDivElement>();
  let activeRow = $state(1);
  let activeColumn = $state(1);

  const dimensionLabel = $derived(
    `${activeColumn} ${activeColumn === 1 ? 'column' : 'columns'} × ${activeRow} ${activeRow === 1 ? 'row' : 'rows'}`,
  );

  $effect(() => {
    if (!open) return;
    activeRow = 1;
    activeColumn = 1;
    void tick().then(focusActiveCell);
  });

  function focusActiveCell() {
    grid
      ?.querySelector<HTMLButtonElement>(`[data-row="${activeRow}"][data-column="${activeColumn}"]`)
      ?.focus();
  }

  function setActive(row: number, column: number, focus = false) {
    activeRow = Math.max(1, Math.min(MAX_ROWS, row));
    activeColumn = Math.max(1, Math.min(MAX_COLUMNS, column));
    if (focus) void tick().then(focusActiveCell);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(activeRow, activeColumn);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      focusActiveCell();
      return;
    }

    const movement = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    setActive(activeRow + movement[0], activeColumn + movement[1], true);
  }
</script>

{#if open}
  <div
    class="table-picker-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    <div
      class="table-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-picker-title"
      tabindex="-1"
      onkeydown={handleKeydown}
    >
      <div class="table-picker-heading">
        <strong id="table-picker-title">Insert Table</strong>
        <span aria-live="polite">{dimensionLabel}</span>
      </div>
      <div
        bind:this={grid}
        class="table-picker-grid"
        role="grid"
        aria-label="Table dimensions"
        aria-rowcount={MAX_ROWS}
        aria-colcount={MAX_COLUMNS}
      >
        {#each cells as cell (`${cell.row}-${cell.column}`)}
          <button
            type="button"
            role="gridcell"
            class:highlighted={cell.row <= activeRow && cell.column <= activeColumn}
            aria-selected={cell.row === activeRow && cell.column === activeColumn}
            aria-label={`${cell.column} ${cell.column === 1 ? 'column' : 'columns'} by ${cell.row} ${cell.row === 1 ? 'row' : 'rows'}`}
            tabindex={cell.row === activeRow && cell.column === activeColumn ? 0 : -1}
            data-row={cell.row}
            data-column={cell.column}
            onmouseenter={() => setActive(cell.row, cell.column)}
            onfocus={() => setActive(cell.row, cell.column)}
            onclick={() => onSelect(cell.row, cell.column)}
          ></button>
        {/each}
      </div>
    </div>
  </div>
{/if}
