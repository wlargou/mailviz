import { useEffect, useRef } from 'react';
import { useTaskStore } from '../store/taskStore';

/**
 * Run `reload` whenever a task is written anywhere in the app.
 *
 * For views that keep their own copy of the task list. Two of them do — the
 * Kanban board and By Company — because neither can be derived from the
 * store's `tasks`: By Company reads a different endpoint that returns grouped
 * rows with their own counts, and Kanban deliberately ignores the store's
 * filters and paging. So they hold local state, and without this they never
 * hear about an edit. Carbon keeps inactive `TabPanel`s mounted (only the
 * `hidden` attribute toggles), so switching tabs does not remount them either
 * — which is why the symptom was "you have to refresh the page".
 *
 * Two details that look incidental and are not:
 *
 *  - **The seen-ref, rather than putting the version in the fetch callback's
 *    dependencies.** A version in those deps changes the callback's identity,
 *    so every *filter* change would fire the load twice. This fires only on an
 *    actual change, and never on mount — `seen` is seeded with the current
 *    value, so a remount does not duplicate the fetch the view already does.
 *  - **`reload` through a ref.** The effect depends on the version alone. If
 *    the callback were a dependency, the effect would re-run whenever the
 *    caller re-created it, which is every filter change again.
 *
 * Callers should reload in the background — no skeleton. The rows on screen
 * are still valid; replacing them with a shimmer to change one title reads as
 * a page reload.
 */
export function useTaskChanges(reload: () => void) {
  const tasksVersion = useTaskStore((s) => s.tasksVersion);
  const seen = useRef(tasksVersion);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (seen.current === tasksVersion) return;
    seen.current = tasksVersion;
    reloadRef.current();
  }, [tasksVersion]);
}
