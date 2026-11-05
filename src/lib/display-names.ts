import { create } from 'zustand';

/** 按仓库和工作区的稳定 ID 保存别名，独立于会被 Git 刷新替换的元数据。 */
interface DisplayNameState {
  names: Record<string, string>;
  /** null 删除别名，恢复当前语言与 Git 元数据决定的默认名称。 */
  setName: (id: string, name: string | null) => void;
}

const storageKey = 'git-workbench.display-names';

function readNames(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim())));
  } catch { return {}; }
}

/** 先持久化再通知界面，存储失败时保留原名称，由编辑弹窗提示重试。 */
export const useDisplayNames = create<DisplayNameState>((set, get) => ({
  names: readNames(),
  setName: (id, name) => {
    const nextName = name?.trim() ?? null;
    if (nextName === '') throw new Error('名称不能为空');
    const names = { ...get().names };
    if (nextName === null) delete names[id];
    else names[id] = nextName;
    localStorage.setItem(storageKey, JSON.stringify(names));
    set({ names });
  },
}));
