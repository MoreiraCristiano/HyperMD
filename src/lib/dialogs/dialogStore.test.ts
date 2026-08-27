import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { dialogService, dialogState, resolveDialog } from './dialogStore';

describe('dialog service', () => {
  it('queues prompts, confirms, and choices in FIFO order', async () => {
    const prompt = dialogService.prompt({
      title: 'Name',
      label: 'File name',
      value: 'note',
      required: true,
    });
    const confirm = dialogService.confirm({
      title: 'Delete',
      message: 'Delete it?',
      tone: 'danger',
    });
    const choice = dialogService.choose({
      title: 'Save',
      message: 'Choose',
      actions: [{ id: 'discard', label: 'Discard' }],
    });

    expect(get(dialogState)).toMatchObject({
      id: 1,
      kind: 'prompt',
      input: { value: 'note', required: true },
    });
    resolveDialog('renamed');
    await expect(prompt).resolves.toBe('renamed');
    expect(get(dialogState)).toMatchObject({
      id: 2,
      kind: 'confirm',
      tone: 'danger',
      actions: expect.arrayContaining([
        expect.objectContaining({ id: 'confirm', variant: 'danger' }),
      ]),
    });
    resolveDialog('confirm');
    await expect(confirm).resolves.toBe(true);
    expect(get(dialogState)).toMatchObject({ id: 3, kind: 'choice' });
    resolveDialog(null);
    await expect(choice).resolves.toBeNull();
    expect(get(dialogState)).toBeNull();
    resolveDialog('ignored');
  });
});
