'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  iconOnly?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantClasses = {
  primary: 'bg-oak-primary text-white hover:bg-oak-dark',
  secondary: 'bg-background-elevated text-text-primary border border-border-primary hover:bg-background-tertiary',
  ghost: 'bg-transparent text-text-primary hover:bg-background-tertiary',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

const sizeClasses = {
  xs: 'h-7 min-h-10 sm:min-h-7 px-3.5 text-xs',
  sm: 'h-8 min-h-10 sm:min-h-8 px-4 text-sm',
  md: 'h-9 min-h-10 sm:min-h-9 px-5 text-sm',
  lg: 'h-11 px-6 text-base',
};

const iconSizeClasses = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-4 h-4',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'sm',
      isLoading,
      iconOnly,
      leftIcon,
      rightIcon,
      children,
      className,
      disabled,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const iconSize = iconSizeClasses[size];

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          variantClasses[variant],
          iconOnly ? 'aspect-square px-0' : sizeClasses[size],
          className
        )}
        {...props}
      >
        {isLoading ? (
          <Loader2 className={cn(iconSize, 'animate-spin flex-shrink-0')} aria-hidden="true" />
        ) : (
          leftIcon && (
            <span className={cn(iconSize, 'flex flex-shrink-0 items-center justify-center')} aria-hidden={iconOnly ? undefined : true}>
              {leftIcon}
            </span>
          )
        )}
        {!iconOnly && children}
        {!isLoading && rightIcon && (
          <span className={cn(iconSize, 'flex flex-shrink-0 items-center justify-center')} aria-hidden="true">
            {rightIcon}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
