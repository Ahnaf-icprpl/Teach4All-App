import van from 'vanjs-core';

const svg = van.tags('http://www.w3.org/2000/svg');
const paths = {
  mountain: ['M3 17 10 5l11 16H3l4-7 5 7', 'm8 9 3 3 3-2', 'M19 3v5m-2.5-2.5h5'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M21 21l-4.5-4.5', 'M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  compose: ['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'],
  panel: ['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1', 'M9 3v18'],
  panelClose: ['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1', 'M9 3v18', 'm16 9-3 3 3 3'],
  arrow: ['M12 19V5m-6 6 6-6 6 6'],
  arrowRight: ['M5 12h14m-6-6 6 6-6 6'],
  chevron: ['m8 10 4 4 4-4'],
  bulb: ['M9 18h6m-5 3h4', 'M8.5 14.5a6 6 0 1 1 7 0L15 17H9Z', 'M12 2V1M4 5 3 4m17 1 1-1'],
  plan: ['M9 5H6a2 2 0 0 0-2 2v13h16V7a2 2 0 0 0-2-2h-3', 'M9 3h6v4H9ZM8 12h8m-8 4h5'],
  play: ['M6 4l15 8-15 8z'],
  spark: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z', 'M20 2v4m-2-2h4'],
  book: ['M12 5v16', 'M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2'],
  globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18'],
  leaf: ['M19 3C9 2 3 7 5 14c3 8 15 3 14-11Z', 'M4 21 15 9'],
  check: ['m5 12 4 4L19 6'],
  chat: ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3l1.5-5A8.5 8.5 0 1 1 21 11.5Z'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  close: ['m6 6 12 12M6 18 18 6'],
  sun: ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'],
  moon: ['M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z'],
  settings: ['M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  copy: ['M8 8h12v13H8Z', 'M16 8V3H3v13h5'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'],
  download: ['M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 11v6m0-10h.01'],
  offline: ['m3 3 18 18M2 8a16 16 0 0 1 3-2m4-1a16 16 0 0 1 13 3M5 12a11 11 0 0 1 4-2m5 0a11 11 0 0 1 5 2m-11 4a6 6 0 0 1 8 0m-4 4h.01'],
};

export function icon(name, className = '') {
  const iconPaths = paths[name] || [];
  return svg.svg({
    viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none',
    stroke: 'currentColor', 'stroke-width': name === 'more' ? 3 : 1.65,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', class: `icon ${className}`,
  }, iconPaths.map(d => svg.path({ d })));
}

export function landscape() {
  return svg.svg({ viewBox: '0 0 220 68', fill: 'none', 'aria-hidden': 'true', class: 'landscape' },
    svg.circle({ cx: 171, cy: 17, r: 9, fill: '#e4b97d', opacity: '.6' }),
    svg.path({ d: 'M-5 68 45 17 91 66 132 28 186 68Z', fill: '#dce4d9' }),
    svg.path({ d: 'm49 68 62-64 62 64Zm102 0 40-38 38 38Z', fill: '#b7c9ba' }),
    svg.path({ d: 'm93 23 18-19 20 21-13-4-7 6-8-8Z', fill: '#f5f7ee' }),
    svg.path({ d: 'M0 60c35-12 54 6 90 0s70-3 130 4v4H0Z', fill: '#94ae99' }),
  );
}
