export { documentManager, DocumentManager } from './documentManager';
export { documentNotice, documentNoticeActions } from './documentNotice';
export { initializeDocumentSession } from './documentSession';
export { default as TablePicker } from './editor/TablePicker.svelte';
export type { EditorApi, EditorCommand, StoredSelection } from './documentTypes';
export { activeTab, isMarkdownTab, tabsState } from './tabs/tabStore';
export type { EditorTab, MarkdownTab, TabsState } from './documentTypes';
export type {
  ImageReferenceFailure,
  ImageReferenceProgress,
  ImageReferenceRenamePlan,
  ImageReferenceWriteResult,
} from './documentImages';
export { default as TabBar } from './tabs/TabBar.svelte';
export { default as ImageViewer } from './viewers/ImageViewer.svelte';
