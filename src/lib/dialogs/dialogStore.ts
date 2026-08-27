import { writable } from 'svelte/store';

export type DialogTone = 'default' | 'warning' | 'danger';
export type DialogActionVariant = 'primary' | 'secondary' | 'danger';

export type DialogAction = {
  id: string;
  label: string;
  variant?: DialogActionVariant;
};

export type DialogRequest = {
  id: number;
  kind: 'prompt' | 'confirm' | 'choice';
  title: string;
  message?: string;
  tone: DialogTone;
  actions: readonly DialogAction[];
  input?: {
    label: string;
    value: string;
    placeholder?: string;
    required: boolean;
  };
};

type PromptOptions = {
  title: string;
  message?: string;
  label: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  required?: boolean;
};

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

type ChoiceOptions = {
  title: string;
  message: string;
  actions: readonly DialogAction[];
  tone?: DialogTone;
};

type PendingDialog = {
  request: DialogRequest;
  resolve: (value: string | null) => void;
};

const state = writable<DialogRequest | null>(null);
const queue: PendingDialog[] = [];
let active: PendingDialog | null = null;
let sequence = 0;

export const dialogState = { subscribe: state.subscribe };

function enqueue(request: Omit<DialogRequest, 'id'>): Promise<string | null> {
  return new Promise((resolve) => {
    queue.push({ request: { ...request, id: ++sequence }, resolve });
    showNext();
  });
}

function showNext(): void {
  if (active) return;
  active = queue.shift() ?? null;
  state.set(active?.request ?? null);
}

export function resolveDialog(value: string | null): void {
  if (!active) return;
  const completed = active;
  active = null;
  completed.resolve(value);
  showNext();
}

export const dialogService = {
  async prompt(options: PromptOptions): Promise<string | null> {
    return enqueue({
      kind: 'prompt',
      title: options.title,
      message: options.message,
      tone: 'default',
      input: {
        label: options.label,
        value: options.value ?? '',
        placeholder: options.placeholder,
        required: options.required ?? false,
      },
      actions: [
        { id: 'cancel', label: 'Cancel', variant: 'secondary' },
        { id: 'confirm', label: options.confirmLabel ?? 'OK', variant: 'primary' },
      ],
    });
  },

  async confirm(options: ConfirmOptions): Promise<boolean> {
    const result = await enqueue({
      kind: 'confirm',
      title: options.title,
      message: options.message,
      tone: options.tone ?? 'default',
      actions: [
        { id: 'cancel', label: options.cancelLabel ?? 'Cancel', variant: 'secondary' },
        {
          id: 'confirm',
          label: options.confirmLabel ?? 'Confirm',
          variant: options.tone === 'danger' ? 'danger' : 'primary',
        },
      ],
    });
    return result === 'confirm';
  },

  choose(options: ChoiceOptions): Promise<string | null> {
    return enqueue({
      kind: 'choice',
      title: options.title,
      message: options.message,
      tone: options.tone ?? 'default',
      actions: options.actions,
    });
  },
};
