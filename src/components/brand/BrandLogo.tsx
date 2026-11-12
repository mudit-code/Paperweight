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
      className={`shrink-0 drop-shadow-xs ${className}`}
    >
      <defs>
        <linearGradient id="brandPwBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3D3C49" />
          <stop offset="1" stopColor="#1A1922" />
        </linearGradient>
      </defs>
      {/* 1. Amber Squircle Background */}
      <rect width="32" height="32" rx="7" fill="#B45309" />

      {/* 2. Stacked Paper Sheets */}
      <rect x="4" y="17.5" width="24" height="9.5" rx="1.5" fill="#E6D3B5" transform="rotate(-2 16 22)" />
      <rect x="4.5" y="18.5" width="23" height="8.5" rx="1.5" fill="#FFFDF8" />
      <rect x="6.5" y="20.5" width="4.5" height="4.5" rx="1" fill="#D97706" />
      <rect x="13" y="21" width="12" height="1.5" rx="0.75" fill="#D2C4AE" />
      <rect x="13" y="23.5" width="8" height="1.5" rx="0.75" fill="#D2C4AE" />

      {/* 3. Cast-Iron Paperweight */}
      <ellipse cx="16" cy="18.5" rx="11" ry="1.5" fill="#181412" opacity="0.45" />
      <path d="M12 12V8.5C12 6.6 13.8 5 16 5C18.2 5 20 6.6 20 8.5V12" fill="none" stroke="#26252F" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M13.5 8C14.2 6.8 15.1 6.2 16 6.2C16.9 6.2 17.8 6.8 18.5 8" fill="none" stroke="#636272" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9.5 12H22.5L26 18.5H6L9.5 12Z" fill="url(#brandPwBody)" stroke="#1A1922" strokeWidth="0.75" strokeLinejoin="round" />
      <line x1="10" y1="12.5" x2="22" y2="12.5" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M14 14.5L16 16.5L18 14.5" fill="none" stroke="#FFEBD1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="16" y1="13.5" x2="16" y2="15" stroke="#FFEBD1" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};

export default BrandLogo;

