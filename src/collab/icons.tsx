// Stroke-based 20px inline icons (currentColor).
import type { ReactNode } from "react";

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconClose = () => (
  <Svg>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
export const IconCopy = () => (
  <Svg>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Svg>
);
export const IconCheck = () => (
  <Svg>
    <path d="m5 12 5 5 9-10" />
  </Svg>
);
export const IconShare = () => (
  <Svg>
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" />
  </Svg>
);
export const IconUsers = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
  </Svg>
);
export const IconLink = () => (
  <Svg>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </Svg>
);
export const IconMic = ({ off }: { off?: boolean }) => (
  <Svg>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    {off && <path d="M3 3l18 18" />}
  </Svg>
);
export const IconHeadphones = () => (
  <Svg>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <rect x="3" y="14" width="4.5" height="6.5" rx="1.5" />
    <rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5" />
  </Svg>
);
export const IconScreen = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);
export const IconEye = () => (
  <Svg>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const IconMinimize = () => (
  <Svg>
    <path d="M5 12h14" />
  </Svg>
);
export const IconMaximize = () => (
  <Svg>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
export const IconRestore = () => (
  <Svg>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </Svg>
);
export const IconCode = () => (
  <Svg>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </Svg>
);
export const IconLock = () => (
  <Svg size={16}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const IconWifiOff = () => (
  <Svg size={16}>
    <path d="M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5-2.7M14.5 10.3a10 10 0 0 1 4.5 2.6M2 8.8a15 15 0 0 1 4.3-2.6M10.7 5.1A15 15 0 0 1 22 8.8" />
    <circle cx="12" cy="20" r="0.8" fill="currentColor" />
  </Svg>
);
export const IconPhoneOff = () => (
  <Svg>
    <path d="M4 15.5c4.4-4.6 11.6-4.6 16 0l-1.9 2.4a1.2 1.2 0 0 1-1.5.3l-2.4-1.3a1.2 1.2 0 0 1-.6-1.2l.2-1.6a9 9 0 0 0-3.6 0l.2 1.6a1.2 1.2 0 0 1-.6 1.2l-2.4 1.3a1.2 1.2 0 0 1-1.5-.3Z" />
  </Svg>
);
