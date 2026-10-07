import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  width: 20,
  height: 20,
};

export const IconArrowLeft = (p: P) => (
  <svg {...base} {...p}><path d="M15 18l-6-6 6-6" /></svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...base} {...p}><path d="M9 18l6-6-6-6" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconX = (p: P) => (
  <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconClock = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></svg>
);
export const IconCalendar = (p: P) => (
  <svg {...base} {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>
);
export const IconPin = (p: P) => (
  <svg {...base} {...p}><path d="M12 21s-7-5.6-7-11a7 7 0 1114 0c0 5.4-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
export const IconPhone = (p: P) => (
  <svg {...base} {...p}><path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 006.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 01-1.6 1.5A16 16 0 013.5 5.6 1.5 1.5 0 015 4z" /></svg>
);
export const IconUsers = (p: P) => (
  <svg {...base} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.6a3.5 3.5 0 010 6.8M18 14a6.5 6.5 0 013.5 6" /></svg>
);
export const IconSparkle = (p: P) => (
  <svg {...base} {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" /></svg>
);
export const IconRepeat = (p: P) => (
  <svg {...base} {...p}><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 01-4 4H4" /></svg>
);
export const IconChat = (p: P) => (
  <svg {...base} {...p}><path d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4.2A8 8 0 1120 12z" /></svg>
);
export const IconSettings = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconQr = (p: P) => (
  <svg {...base} {...p}><rect x="3.5" y="3.5" width="6" height="6" rx="1" /><rect x="14.5" y="3.5" width="6" height="6" rx="1" /><rect x="3.5" y="14.5" width="6" height="6" rx="1" /><path d="M14.5 14.5h2.5v2.5M20.5 14.5v.01M14.5 20.5h.01M17.5 20.5h3v-3" /></svg>
);
export const IconLogout = (p: P) => (
  <svg {...base} {...p}><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l-4-4 4-4M6 12h10" /></svg>
);
export const IconWhatsApp = (p: P) => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden {...p}>
    <path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 000-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.8 11.9 11.9 0 004.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 001.8-1.3 2.3 2.3 0 00.2-1.3c-.1-.1-.3-.2-.5-.3z" />
  </svg>
);
