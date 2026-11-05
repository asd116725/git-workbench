import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { SortEdge, SortScope } from '../lib/sidebar-order';

interface SortItem { scope: SortScope; id: string }
interface DropTarget extends SortItem { edge: SortEdge }
interface PointerDrag extends SortItem {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  handle: HTMLButtonElement;
  container: HTMLElement;
  active: boolean;
}

/** 只命中指针下同一列表的可见行；项目拖动可命中整个展开组。 */
function targetAt(drag: PointerDrag): DropTarget | null {
  let row = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('[data-sort-id]');
  while (row && row.dataset.sortScope !== (drag.scope ?? '')) row = row.parentElement?.closest<HTMLElement>('[data-sort-id]');
  if (!row || row.dataset.sortId === drag.id) return null;
  const bounds = row.getBoundingClientRect();
  return { scope: drag.scope, id: row.dataset.sortId!, edge: drag.y < bounds.top + bounds.height / 2 ? 'before' : 'after' };
}

/** 使用指针捕获完成同组拖放，避免依赖不同 WebView 的系统拖放事件。 */
export function useSidebarSorting(disabled: boolean, move: (scope: SortScope, source: string, target: string, edge: SortEdge) => void) {
  const source = useRef<PointerDrag | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const [dragging, setDragging] = useState<SortItem | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);

  const endDrag = useCallback(() => {
    const drag = source.current;
    source.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    setDragging(null);
    setTarget(null);
  }, []);

  useEffect(() => {
    /** 源行被刷新移除时，捕获丢失事件改发 document，仍需结束拖动和边缘滚动。 */
    function cancelOnCaptureLost(event: globalThis.PointerEvent) {
      if (event.pointerId === source.current?.pointerId) endDrag();
    }
    function cancelOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && source.current) {
        event.preventDefault();
        endDrag();
      }
    }
    window.addEventListener('keydown', cancelOnEscape, true);
    window.addEventListener('blur', endDrag);
    document.addEventListener('lostpointercapture', cancelOnCaptureLost);
    return () => {
      window.removeEventListener('keydown', cancelOnEscape, true);
      window.removeEventListener('blur', endDrag);
      document.removeEventListener('lostpointercapture', cancelOnCaptureLost);
      endDrag();
    };
  }, [endDrag]);

  function showTarget(drag: PointerDrag) {
    const next = targetAt(drag);
    setTarget(previous => previous?.scope === next?.scope && previous?.id === next?.id && previous?.edge === next?.edge ? previous : next);
  }

  /** 指针停在滚动区边缘时继续滚动，并按滚动后的真实行位置更新插入线。 */
  function scrollAtEdge() {
    const drag = source.current;
    if (!drag?.active) return;
    const bounds = drag.container.getBoundingClientRect();
    if (drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom) {
      const distance = drag.y < bounds.top + 28 ? drag.y - bounds.top - 28 : drag.y > bounds.bottom - 28 ? drag.y - bounds.bottom + 28 : 0;
      if (distance) {
        drag.container.scrollTop += Math.sign(distance) * Math.ceil(Math.abs(distance) / 4);
        showTarget(drag);
      }
    }
    scrollFrame.current = requestAnimationFrame(scrollAtEdge);
  }

  return {
    rowProps(scope: SortScope, id: string) {
      return {
        'data-sort-id': id,
        'data-sort-scope': scope ?? '',
        'data-sort-dragging': dragging?.scope === scope && dragging.id === id || undefined,
        'data-sort-edge': target?.scope === scope && target.id === id ? target.edge : undefined,
      };
    },
    handleProps(scope: SortScope, id: string, ids: string[]) {
      return {
        draggable: false,
        disabled: disabled || ids.length < 2,
        'aria-keyshortcuts': 'ArrowUp ArrowDown',
        onPointerDown(event: PointerEvent<HTMLButtonElement>) {
          if (disabled || ids.length < 2 || event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          const handle = event.currentTarget;
          handle.focus();
          handle.setPointerCapture(event.pointerId);
          source.current = { scope, id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, handle, container: handle.closest<HTMLElement>('.repositories')!, active: false };
        },
        onPointerMove(event: PointerEvent<HTMLButtonElement>) {
          const drag = source.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          drag.x = event.clientX;
          drag.y = event.clientY;
          if (!drag.active) {
            if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
            drag.active = true;
            setDragging({ scope, id });
            scrollFrame.current = requestAnimationFrame(scrollAtEdge);
          }
          showTarget(drag);
        },
        onPointerUp(event: PointerEvent<HTMLButtonElement>) {
          const drag = source.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          drag.x = event.clientX;
          drag.y = event.clientY;
          const destination = drag.active && !disabled ? targetAt(drag) : null;
          endDrag();
          if (destination) move(scope, id, destination.id, destination.edge);
        },
        onPointerCancel: endDrag,
        onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
          if (disabled || source.current || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const direction = event.key === 'ArrowUp' ? -1 : 1;
          const neighbor = ids[ids.indexOf(id) + direction];
          if (neighbor) {
            const handle = event.currentTarget;
            move(scope, id, neighbor, direction < 0 ? 'before' : 'after');
            requestAnimationFrame(() => handle.focus());
          }
        },
      };
    },
  };
}
