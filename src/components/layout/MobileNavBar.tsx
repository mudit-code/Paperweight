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
  isScanningOrEditing?: boolean;
}

interface NavTabItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Exact tab order requested: compress, resize, scans, convert, merge
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
  isScanningOrEditing = false,
}) => {
  // If currently scanning or in document editor, hide taskbar to eliminate overlaps
  if (isScanningOrEditing) {
    return null;
  }

  return (
    <nav
      aria-label="Mobile Navigation Bar"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-panel/95 backdrop-blur-md border-t border-surface-border pl-[max(0.25rem,var(--safe-area-left))] pr-[max(0.25rem,var(--safe-area-right))] pt-1 pb-[max(0.6rem,var(--safe-area-bottom))] flex items-center justify-between select-none shadow-md overscroll-none transition-[padding] duration-150"
    >
      {NAV_TABS.map((tab) => {
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
            className={`flex-1 min-h-[48px] flex flex-col items-center justify-center py-1 px-1 rounded-xl cursor-pointer transition-colors active:scale-95 ${
              isActive
                ? 'text-accent font-semibold'
                : 'text-text-muted hover:text-text-main'
            }`}
            aria-label={tab.label}
          >
            <Icon className={`w-5 h-5 ${tab.id === 'scans' ? 'stroke-[2.25]' : ''}`} />
            <span className="text-[10px] tracking-tight mt-0.5">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
