import React from 'react';
import {
  Minimize2,
  Crop,
  Plus,
  ArrowRightLeft,
  Layers,
} from 'lucide-react';

export interface MobileNavBarProps {
  activeToolId: string;
  onSelectTool: (toolId: string) => void;
  onOpenScan: () => void;
  isOnlineMode?: boolean;
  isScanningOrEditing?: boolean;
  isKeyboardOpen?: boolean;
  className?: string;
}

interface NavTabItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_TABS: NavTabItem[] = [
  { id: 'image-resizer', label: 'Compress', icon: Minimize2 },
  { id: 'resizer', label: 'Resize', icon: Crop },
  { id: 'scans', label: 'Scans', icon: Plus },
  { id: 'converter', label: 'Convert', icon: ArrowRightLeft },
  { id: 'pdf-merge', label: 'Merge', icon: Layers },
];

export const MobileNavBar: React.FC<MobileNavBarProps> = ({
  activeToolId,
  onSelectTool,
  onOpenScan,
  isOnlineMode = false,
  isScanningOrEditing = false,
  isKeyboardOpen = false,
  className = '',
}) => {
  if (isScanningOrEditing) {
    return null;
  }

  const tabs = isOnlineMode
    ? NAV_TABS.filter((tab) => tab.id !== 'scans')
    : NAV_TABS;

  return (
    <nav
      aria-label="Mobile Navigation Bar"
      className={`lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-panel border-t border-surface-border pl-[max(0.25rem,var(--safe-area-left))] pr-[max(0.25rem,var(--safe-area-right))] pb-[max(0.5rem,var(--safe-area-bottom))] flex items-center justify-between select-none overscroll-none transition-transform duration-150 ease-out ${
        isKeyboardOpen ? 'translate-y-full pointer-events-none' : 'translate-y-0'
      } ${className}`}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeToolId === tab.id;

        const handleClick = () => {
          if (tab.id === 'scans') {
            if (activeToolId === 'scans') {
              onOpenScan();
            } else {
              onSelectTool('scans');
            }
          } else {
            onSelectTool(tab.id);
          }
        };

        return (
          <button
            key={tab.id}
            type="button"
            onClick={handleClick}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex-1 min-h-[52px] flex flex-col items-center justify-center py-1.5 px-1 rounded-control cursor-pointer transition-colors duration-fast ease-out ${
              isActive
                ? 'text-text-main font-bold before:content-[""] before:absolute before:top-0 before:left-3 before:right-3 before:h-[3px] before:rounded-b-control before:bg-accent'
                : 'text-text-muted hover:text-text-main font-medium'
            }`}
            aria-label={tab.label}
          >
            <Icon className="w-5 h-5" />
            <span className="text-xs tracking-tight mt-0.5">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
