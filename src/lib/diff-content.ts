import type { editor } from 'monaco-editor';

/** 同文件更新只替换变化的模型，并在异步差异布局后保留阅读位置。 */
export function createDiffContentUpdater(instance: editor.IStandaloneDiffEditor, viewModel: editor.IDiffEditorViewModel) {
  let initialized = false;
  let cancelPendingRestore = () => {};

  function update(original: string, modified: string) {
    const models = viewModel.model;
    const originalChanged = models.original.getValue() !== original;
    const modifiedChanged = models.modified.getValue() !== modified;
    const preserveView = initialized;
    initialized = true;
    if (!originalChanged && !modifiedChanged) return;

    cancelPendingRestore();
    const state = preserveView ? instance.saveViewState() : null;
    if (originalChanged) models.original.setValue(original);
    if (modifiedChanged) models.modified.setValue(modified);
    if (!state) return;
    instance.restoreViewState(state);

    const container = instance.getContainerDomNode();
    let cancelled = false;
    let frame: number | undefined;
    /** 用户开始滚动、选择或键盘导航后，旧视图快照不得再次覆盖新操作。 */
    function cancel() {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      container.removeEventListener('wheel', cancel, true);
      container.removeEventListener('pointerdown', cancel, true);
      container.removeEventListener('keydown', cancel, true);
    }
    container.addEventListener('wheel', cancel, { capture: true, passive: true });
    container.addEventListener('pointerdown', cancel, true);
    container.addEventListener('keydown', cancel, true);
    cancelPendingRestore = cancel;

    /** setValue 后 Diff 工作线程还会重排占位行，等待计算完成再恢复一次。 */
    void viewModel.waitForDiff().then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        if (!cancelled) instance.restoreViewState(state);
        cancel();
      });
    }, cancel);
  }

  return {
    update,
    cancelPendingRestore: () => cancelPendingRestore(),
    dispose: () => cancelPendingRestore(),
  };
}
