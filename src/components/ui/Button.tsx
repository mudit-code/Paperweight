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
        'bg-accent text-accent-contrast hover:bg-accent-hover border border-accent shadow-sm active:translate-y-[1px]',
      secondary:
        'bg-surface-subtle text-text-main hover:bg-surface-hover border border-surface-border active:translate-y-[1px]',
      outline:
        'bg-transparent text-text-main hover:bg-surface-subtle border border-surface-border active:translate-y-[1px]',
      ghost:
        'bg-transparent text-text-muted hover:text-text-main hover:bg-surface-subtle active:translate-y-[1px]',
      danger:
        'bg-status-error-bg text-status-error hover:bg-status-error hover:text-white border border-status-error-border active:translate-y-[1px]',
    }[variant];

    const sizeStyles = {
      sm: 'text-xs px-2.5 py-1.5 rounded-sm gap-1.5 font-medium',
      md: 'text-sm px-3.5 py-2 rounded-md gap-2 font-medium',
      lg: 'text-base px-5 py-2.5 rounded-lg gap-2.5 font-medium',
    }[size];

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`inline-flex items-center justify-center select-none transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed ${variantStyles} ${sizeStyles} ${className}`}
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
