// Inline stroke icons (20px, currentColor) used by the io + library modules.
import type { ReactNode } from "react";

const Icon = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const CloseIcon = () => <Icon><path d="M18 6 6 18M6 6l12 12" /></Icon>;
export const DownloadIcon = () => <Icon><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></Icon>;
export const UploadIcon = () => <Icon><path d="M12 19V8m0 0-4 4m4-4 4 4M5 5h14" /></Icon>;
export const CopyIcon = () => <Icon><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></Icon>;
export const ImageIcon = () => <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></Icon>;
export const FileIcon = () => <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>;
export const PdfIcon = () => <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-3zm0 3v2" /></Icon>;
export const ChevronLeft = () => <Icon><path d="m15 6-6 6 6 6" /></Icon>;
export const ChevronRight = () => <Icon><path d="m9 6 6 6-6 6" /></Icon>;
export const LaserIcon = () => <Icon><path d="M4 20 14 10" /><circle cx="17" cy="7" r="3" /><path d="M17 2v1M22 7h-1M20.5 3.5l-.7.7" /></Icon>;
export const ExitIcon = () => <Icon><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 16l4-4-4-4M19 12H9" /></Icon>;
export const TrashIcon = () => <Icon><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Icon>;
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
export const CheckIcon = () => <Icon><path d="m5 12 5 5 9-10" /></Icon>;
export const MoreIcon = () => <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>;
export const SearchIcon = () => <Icon><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></Icon>;
export const LibraryIcon = () => <Icon><rect x="4" y="4" width="6" height="16" rx="1" /><rect x="12" y="4" width="4" height="16" rx="1" /><path d="m18 5 3 14" /></Icon>;
export const ExternalIcon = () => <Icon><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Icon>;
export const SelectIcon = () => <Icon><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Icon>;
export const ResetIcon = () => <Icon><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" /></Icon>;
export const OfflineIcon = () => <Icon><path d="M2 8.5a15 15 0 0 1 4-2.6M9.5 5.2A15 15 0 0 1 22 8.5M5 12a10 10 0 0 1 4-2M14.5 9.8A10 10 0 0 1 19 12M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18" /></Icon>;
