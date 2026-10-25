const paths: Record<string, string> = {
  refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1',
  clock:'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  chat: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 3-2M7 9h10M7 13h6',
  subtitle: 'M4 5h16v14H4zM7 9h3M14 9h3M7 14h10',
  markdown: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5',
  html: 'M3 5h18v14H3zM9 9l-3 3 3 3M15 9l3 3-3 3',
  scribble: 'm5 16 11-12 4 4L9 20H4zM13 7l4 4M3 22h16',
  library: 'M3 4h5v16H3zM10 4h5v16h-5zM17 5l4-1 3 15-4 1z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  online: 'M4 12h16M12 4c4 4 4 12 0 16-4-4-4-12 0-16M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16',
  export: 'M12 3v11m-4-7 4-4 4 4M5 13v6h14v-6',
  sliders: 'M4 7h10m4 0h2M4 17h2m4 0h10M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M8 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  init: 'M12 3v6m0 6v6M3 12h6m6 0h6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  edit: 'M4 20h4L20 8l-4-4L4 16zM13 7l4 4',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  arrow: 'M17 12H5m6-6-6 6 6 6', plus: 'M12 5v14M5 12h14', send: 'M12 19V5m-6 6 6-6 6 6', chevron: 'm8 10 4 4 4-4'
};
export function Icon({ name }: { name: string }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.chat}/></svg>; }
