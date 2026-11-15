import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      className = '',
      ...props
    },
    ref
  ) => {
    const variantStyles = {
      primary:
        'bg-accent text-accent-contrast hover:bg-accent-hover border border-accent-border font-semibold',
      secondary:
        'bg-surface-subtle text-text-main hover:bg-surface-hover border border-surface-border font-medium',
      outline:
        'bg-transparent text-text-main hover:bg-surface-subtle border border-surface-border font-medium',
      ghost:
        'bg-transparent text-text-muted hover:text-text-main hover:bg-surface-subtle border border-transparent font-medium',
      danger:
        'bg-status-error-bg text-status-error hover:bg-status-error hover:text-white border border-status-error-border font-semibold',
    }[variant];

    const sizeStyles = {
      sm: 'min-h-[44px] text-xs px-3 py-2 rounded-control gap-1.5',
      md: 'min-h-[44px] text-sm px-4 py-2 rounded-control gap-2',
      lg: 'min-h-[48px] text-md px-5 py-2.5 rounded-control gap-2.5',
    }[size];

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`inline-flex items-center justify-center select-none transition-colors duration-fast ease-out cursor-pointer disabled:bg-surface-disabled disabled:text-text-disabled disabled:border-surface-border disabled:pointer-events-none disabled:cursor-not-allowed ${variantStyles} ${sizeStyles} ${className}`}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        ) : (
          leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
        )}
        <span>{children}</span>
        {!isLoading && rightIcon && (
          <span className="inline-flex shrink-0">{rightIcon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
