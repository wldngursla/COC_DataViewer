import type { ViewId } from './AppNav';
const paths: Partial<Record<ViewId, string>> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  graphs: 'M3 4v16h18 M6 14l4-6 5 5 5-8',
  vehicle: 'M5 9l2-5h10l2 5 M4 9h16v10H4z M7 13h1 M16 13h1 M7 19v2 M17 19v2',
  battery: 'M4 7h15v10H4z M21 10v4 M8 10v4 M12 10v4',
  data: 'M4 4h16v16H4z M4 10h16 M4 15h16 M10 4v16',
  health: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
};
export function NavigationIcon({ view }: { view: ViewId }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[view] ?? paths.data}/></svg>;
}
