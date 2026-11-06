import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.8V21h13V9.8" />
    </IconBase>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </IconBase>
  );
}

export function IconCamera(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
    </IconBase>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="9" r="2.5" />
      <circle cx="16" cy="9" r="2.5" />
      <path d="M3.5 18a4.5 4.5 0 0 1 9 0" />
      <path d="M11.5 18a4.5 4.5 0 0 1 9 0" />
    </IconBase>
  );
}

export function IconMusicNote(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 18a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" transform="translate(0 -2)" />
      <path d="M11.5 7.5v8" />
      <path d="M11.5 7.5 19 6v8" />
      <path d="M16.5 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" transform="translate(0 -2)" />
    </IconBase>
  );
}

export function IconArrowForward(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </IconBase>
  );
}

export function IconExternalLink(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </IconBase>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </IconBase>
  );
}

export function IconSpotify(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5.8 9.9c4-1.2 8.7-1 12 .8" />
      <path d="M6.8 12.4c3.2-1 6.8-.8 9.4.7" />
      <path d="M7.9 14.9c2.3-.7 4.8-.5 6.7.4" />
    </IconBase>
  );
}

export function IconAppleMusic(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 7.5v8" />
      <path d="m10 7.5 6.6-1.2v7.5" />
      <circle cx="8.2" cy="17" r="2" />
      <circle cx="14.8" cy="15.8" r="2" />
    </IconBase>
  );
}

export function IconDeezer(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <rect x="3" y="15.5" width="2.4" height="5.5" rx="0.6" />
      <rect x="6.3" y="13" width="2.4" height="8" rx="0.6" />
      <rect x="9.6" y="10.5" width="2.4" height="10.5" rx="0.6" />
      <rect x="12.9" y="8" width="2.4" height="13" rx="0.6" />
      <rect x="16.2" y="11.5" width="2.4" height="9.5" rx="0.6" />
      <rect x="19.5" y="14" width="1.5" height="7" rx="0.5" />
    </svg>
  );
}

export function IconTidal(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="m12 4 3 3-3 3-3-3 3-3Zm-5.5 5.5 3 3-3 3-3-3 3-3Zm11 0 3 3-3 3-3-3 3-3Zm-5.5 5.5 3 3-3 3-3-3 3-3Z" />
    </svg>
  );
}

export function IconInstagram(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconYouTube(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.2 2.8 12 2.8 12 2.8s-4.2 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.2.7 11.5v2.1c0 2.3.3 4.5.3 4.5s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.5 22.2 12 22.2 12 22.2s4.2 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.2.3-4.5v-2.1C23.3 9.2 23 7 23 7zM9.7 15.5V8.3l8.1 3.6-8.1 3.6z" />
    </svg>
  );
}

export function IconGoogleCalendar(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8.5 16l2.5-3 2 2.5 3-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFacebook(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

/* --- Intern hub icons (tool "logos") --- */

export function IconKanban(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3.5" width="4.8" height="17" rx="1.4" />
      <rect x="9.6" y="3.5" width="4.8" height="12" rx="1.4" />
      <rect x="16.2" y="3.5" width="4.8" height="8" rx="1.4" />
    </IconBase>
  );
}

export function IconWaveform(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 12h1.5" />
      <path d="M7 8v8" />
      <path d="M10.5 5v14" />
      <path d="M14 9v6" />
      <path d="M17.5 6.5v11" />
      <path d="M21 12h-0.001" />
    </IconBase>
  );
}

export function IconGallery(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m3.5 17.5 4.7-4.6a2 2 0 0 1 2.8 0l3.6 3.5" />
      <path d="m13 15.5 2.2-2.1a2 2 0 0 1 2.8 0l3 2.9" />
    </IconBase>
  );
}

export function IconScore(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3.5h9.5L19 7v13.5H6z" />
      <path d="M15 3.5V7h4" />
      <path d="M8.5 15.5a1.4 1.4 0 1 0 1.4 1.4V10.4" />
      <path d="M9.9 10.4l3.2-.7v5.2" />
      <path d="M13.1 15a1.4 1.4 0 1 0 1.4 1.4" />
    </IconBase>
  );
}

export function IconDocs(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 8.2A1.7 1.7 0 0 1 4.7 6.5h4.1l1.6 2h7.9A1.7 1.7 0 0 1 20 10.2v8.3A1.7 1.7 0 0 1 18.3 20H4.7A1.7 1.7 0 0 1 3 18.3z" />
      <path d="M7.2 13.4h9.6" />
      <path d="M7.2 16.4h6" />
    </IconBase>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8v5.4" />
      <path d="M12 7.7h.01" />
    </IconBase>
  );
}
