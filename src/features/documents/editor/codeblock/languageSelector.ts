import {
  canonicalLanguageValue,
  codeLanguageOptions,
  filterCodeLanguages,
  languageLabel,
  type CodeLanguageOption,
} from './languages';

let selectorSequence = 0;

export class CodeLanguageSelector {
  readonly dom: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly onSelect: (language: string | null) => void;
  private currentLanguage: string | null;
  private panel: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private visibleOptions: readonly CodeLanguageOption[] = codeLanguageOptions;
  private activeIndex = 0;
  private readonly listId = `code-language-list-${++selectorSequence}`;

  constructor(language: string | null, onSelect: (language: string | null) => void) {
    this.currentLanguage = language;
    this.onSelect = onSelect;
    this.dom = document.createElement('div');
    this.dom.className = 'code-language-toolbar';
    this.dom.contentEditable = 'false';

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'code-language-trigger';
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.addEventListener('click', this.toggle);
    this.dom.append(this.trigger);
    this.update(language);
  }

  update(language: string | null): void {
    this.currentLanguage = language;
    this.trigger.replaceChildren(document.createTextNode(languageLabel(language)), createChevron());
    this.trigger.title = `Language: ${languageLabel(language)}`;
  }

  destroy(): void {
    this.close(false);
    this.trigger.removeEventListener('click', this.toggle);
  }

  private readonly toggle = (): void => {
    if (this.panel) this.close(false);
    else this.open();
  };

  private open(): void {
    const panel = document.createElement('div');
    panel.className = 'code-language-dropdown';

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'code-language-search';
    input.placeholder = 'Search languages…';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', this.listId);
    input.addEventListener('input', this.handleSearch);
    input.addEventListener('keydown', this.handleKeydown);

    const list = document.createElement('div');
    list.id = this.listId;
    list.className = 'code-language-list';
    list.setAttribute('role', 'listbox');

    panel.append(input, list);
    this.dom.append(panel);
    this.panel = panel;
    this.input = input;
    this.visibleOptions = codeLanguageOptions;
    this.activeIndex = Math.max(
      0,
      this.visibleOptions.findIndex(
        (option) => option.value === canonicalLanguageValue(this.currentLanguage),
      ),
    );
    this.trigger.setAttribute('aria-expanded', 'true');
    this.renderOptions(true);
    document.addEventListener('pointerdown', this.handleOutsidePointer, true);
    queueMicrotask(() => input.focus());
  }

  private close(focusTrigger: boolean): void {
    if (!this.panel) return;
    document.removeEventListener('pointerdown', this.handleOutsidePointer, true);
    this.input?.removeEventListener('input', this.handleSearch);
    this.input?.removeEventListener('keydown', this.handleKeydown);
    this.panel.remove();
    this.panel = null;
    this.input = null;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) this.trigger.focus();
  }

  private readonly handleOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.dom.contains(event.target)) this.close(false);
  };

  private readonly handleSearch = (): void => {
    this.visibleOptions = filterCodeLanguages(this.input?.value ?? '');
    this.activeIndex = 0;
    this.renderOptions();
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.visibleOptions.length === 0) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex =
        (this.activeIndex + direction + this.visibleOptions.length) % this.visibleOptions.length;
      this.renderOptions(true);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = this.visibleOptions[this.activeIndex];
      if (option) this.select(option);
    }
  };

  private renderOptions(scrollActive = false): void {
    const list = this.panel?.querySelector<HTMLElement>('.code-language-list');
    if (!list) return;
    list.replaceChildren();

    if (this.visibleOptions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'code-language-empty';
      empty.textContent = 'No languages found';
      list.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    this.visibleOptions.forEach((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'code-language-option';
      item.textContent = option.label;
      item.tabIndex = -1;
      item.setAttribute('role', 'option');
      const selected = option.value === canonicalLanguageValue(this.currentLanguage);
      item.setAttribute('aria-selected', String(selected));
      if (index === this.activeIndex) item.classList.add('keyboard-active');
      if (selected) item.classList.add('selected');
      item.addEventListener('click', () => this.select(option));
      fragment.append(item);
    });
    list.append(fragment);

    if (scrollActive) {
      list.querySelector<HTMLElement>('.keyboard-active')?.scrollIntoView({ block: 'nearest' });
    }
  }

  private select(option: CodeLanguageOption): void {
    if (option.value !== this.currentLanguage) this.onSelect(option.value);
    this.close(false);
  }
}

function createChevron(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 10 6');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M1 1l4 4 4-4');
  svg.append(path);
  return svg;
}
