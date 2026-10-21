import type { editor } from 'monaco-editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiffContentUpdater } from './diff-content';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function createEditor() {
  const container = new EventTarget();
  const makeModel = () => {
    let value = '';
    return { getValue: () => value, setValue: vi.fn((next: string) => { value = next; }) };
  };
  const models = { original: makeModel(), modified: makeModel() };
  const viewState = { original: { cursorState: [{ position: { lineNumber: 120, column: 8 } }], viewState: { scrollTop: 2000 } }, modified: { cursorState: [{ position: { lineNumber: 121, column: 8 } }], viewState: { scrollTop: 2020 } } } as editor.IDiffEditorViewState;
  const instance = {
    getContainerDomNode: () => container,
    saveViewState: vi.fn(() => viewState),
    restoreViewState: vi.fn(),
  };
  const calculation = deferred();
  const viewModel = { model: models, waitForDiff: vi.fn(() => calculation.promise) };
  const updater = createDiffContentUpdater(instance as unknown as editor.IStandaloneDiffEditor, viewModel as unknown as editor.IDiffEditorViewModel);
  return { container, models, instance, viewModel, viewState, calculation, updater };
}

describe('同文件 Diff 内容刷新', () => {
  let frames: Map<number, FrameRequestCallback>;
  beforeEach(() => {
    frames = new Map();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  });
  afterEach(() => vi.unstubAllGlobals());

  function paint() {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(0));
  }

  it('首次加载沿用初始视图；内容不变时不写入模型，也不读取或恢复视图', () => {
    const { updater, models, instance, viewModel } = createEditor();
    updater.update('base', 'working');
    updater.update('base', 'working');
    expect(models.original.setValue).toHaveBeenCalledTimes(1);
    expect(models.modified.setValue).toHaveBeenCalledTimes(1);
    expect(instance.saveViewState).not.toHaveBeenCalled();
    expect(instance.restoreViewState).not.toHaveBeenCalled();
    expect(viewModel.waitForDiff).not.toHaveBeenCalled();
  });

  it('只更新变化的一侧，立即保留选择与滚动，并在异步 Diff 布局后恢复一次', async () => {
    const { updater, models, instance, viewState, calculation } = createEditor();
    updater.update('base', 'working');
    updater.update('base', 'updated');
    expect(models.original.setValue).toHaveBeenCalledTimes(1);
    expect(models.modified.setValue).toHaveBeenCalledTimes(2);
    expect(instance.restoreViewState).toHaveBeenCalledExactlyOnceWith(viewState);
    calculation.resolve();
    await Promise.resolve();
    expect(instance.restoreViewState).toHaveBeenCalledTimes(1);
    paint();
    expect(instance.restoreViewState).toHaveBeenCalledTimes(2);
    expect(instance.restoreViewState).toHaveBeenLastCalledWith(viewState);
  });

  it.each(['wheel', 'pointerdown', 'keydown'])('等待 Diff 时的 %s 操作优先于旧视图，后续计算不会把用户拉回', async event => {
    const { updater, container, instance, calculation } = createEditor();
    updater.update('base', 'working');
    updater.update('base', 'updated');
    container.dispatchEvent(new Event(event));
    calculation.resolve();
    await Promise.resolve();
    paint();
    expect(instance.restoreViewState).toHaveBeenCalledTimes(1);
  });

  it('Diff 已算完但尚未绘制时，新的滚轮操作仍能取消延迟恢复', async () => {
    const { updater, container, instance, calculation } = createEditor();
    updater.update('base', 'working');
    updater.update('base', 'updated');
    calculation.resolve();
    await Promise.resolve();
    container.dispatchEvent(new Event('wheel'));
    paint();
    expect(instance.restoreViewState).toHaveBeenCalledTimes(1);
  });

  it('连续刷新只保留最新视图快照，不重放前一次等待中的位置', async () => {
    const { updater, instance, calculation } = createEditor();
    updater.update('base', 'working');
    updater.update('base', 'updated');
    const latest = { modified: { viewState: { scrollTop: 4000 } } } as editor.IDiffEditorViewState;
    instance.saveViewState.mockReturnValue(latest);
    updater.update('base', 'newest');
    calculation.resolve();
    await Promise.resolve();
    paint();
    expect(instance.restoreViewState).toHaveBeenCalledTimes(3);
    expect(instance.restoreViewState).toHaveBeenLastCalledWith(latest);
  });

  it.each(['cancelPendingRestore', 'dispose'] as const)('%s 阻止后续恢复，供变更块导航与文件卸载清理使用', async method => {
    const { updater, instance, calculation } = createEditor();
    updater.update('base', 'working');
    updater.update('base', 'updated');
    updater[method]();
    calculation.resolve();
    await Promise.resolve();
    paint();
    expect(instance.restoreViewState).toHaveBeenCalledTimes(1);
  });
});
