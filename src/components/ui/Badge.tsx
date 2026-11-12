import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'neutral' | 'accent' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md';
  className?: string;
  icon?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
  icon,
}) => {
  const variantStyles = {
    neutral: 'bg-surface-subtle text-text-muted border-surface-border',
    accent: 'bg-accent-subtle text-accent border-accent-border',
    success: 'bg-status-offline-bg text-status-offline border-status-offline-border',
    warning: 'bg-status-warning-bg text-status-warning border-status-warning-border',
    error: 'bg-status-error-bg text-status-error border-status-error-border',
  }[variant];

  const sizeStyles = {
    sm: 'text-[11px] px-1.5 py-0.5 tracking-tight',
    md: 'text-xs px-2.5 py-1',
  }[size];

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium border rounded-sm transition-colors ${variantStyles} ${sizeStyles} ${className}`}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};
