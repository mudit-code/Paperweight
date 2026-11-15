import React from 'react';

export interface BrandLogoProps {
  className?: string;
  size?: number;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ className = 'w-6 h-6', size = 24 }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label="Paperweight Logo"
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id="brandPwBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--logo-iron-top)" />
          <stop offset="1" stopColor="var(--logo-iron-bottom)" />
        </linearGradient>
      </defs>
      {/* 1. Highlighter Squircle Background */}
      <rect
        width="32"
        height="32"
        rx="7"
        fill="var(--logo-bg)"
        stroke="var(--logo-bg-stroke)"
        strokeWidth="0.75"
      />

      {/* 2. Stacked Paper Sheets */}
      <rect
        x="4"
        y="17.5"
        width="24"
        height="9.5"
        rx="1.5"
        fill="var(--logo-sheet-back)"
        transform="rotate(-2 16 22)"
      />
      <rect
        x="4.5"
        y="18.5"
        width="23"
        height="8.5"
        rx="1.5"
        fill="var(--logo-sheet-front)"
      />
      <rect x="6.5" y="20.5" width="4.5" height="4.5" rx="1" fill="var(--logo-sheet-mark)" />
      <rect x="13" y="21" width="12" height="1.5" rx="0.75" fill="var(--logo-sheet-lines)" />
      <rect x="13" y="23.5" width="8" height="1.5" rx="0.75" fill="var(--logo-sheet-lines)" />

      {/* 3. Cast-Iron Paperweight */}
      <ellipse cx="16" cy="18.5" rx="11" ry="1.5" fill="var(--logo-iron-bottom)" opacity="0.45" />
      <path
        d="M12 12V8.5C12 6.6 13.8 5 16 5C18.2 5 20 6.6 20 8.5V12"
        fill="none"
        stroke="var(--logo-handle)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M13.5 8C14.2 6.8 15.1 6.2 16 6.2C16.9 6.2 17.8 6.8 18.5 8"
        fill="none"
        stroke="var(--logo-handle-highlight)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M9.5 12H22.5L26 18.5H6L9.5 12Z"
        fill="url(#brandPwBody)"
        stroke="var(--logo-iron-stroke)"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
      <line
        x1="10"
        y1="12.5"
        x2="22"
        y2="12.5"
        stroke="#FFFFFF"
        strokeOpacity="0.25"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
      <path
        d="M14 14.5L16 16.5L18 14.5"
        fill="none"
        stroke="var(--logo-chevron)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="16"
        y1="13.5"
        x2="16"
        y2="15"
        stroke="var(--logo-chevron)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default BrandLogo;
