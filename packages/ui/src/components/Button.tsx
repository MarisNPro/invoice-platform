import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}

const variantStyles: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:   'background:#3b5bdb;color:#fff;border:none;',
  secondary: 'background:#f1f3f5;color:#212529;border:1px solid #dee2e6;',
  danger:    'background:#fa5252;color:#fff;border:none;',
  ghost:     'background:transparent;color:#3b5bdb;border:none;',
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'padding:4px 12px;font-size:13px;border-radius:4px;',
  md: 'padding:8px 18px;font-size:14px;border-radius:6px;',
  lg: 'padding:12px 24px;font-size:16px;border-radius:8px;',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled ?? loading}
      style={{
        cursor: loading || disabled ? 'not-allowed' : 'pointer',
        opacity: loading || disabled ? 0.7 : 1,
        fontFamily: 'inherit',
        ...Object.fromEntries(
          variantStyles[variant]
            .split(';')
            .filter(Boolean)
            .map((s) => s.split(':') as [string, string]),
        ),
        ...Object.fromEntries(
          sizeStyles[size]
            .split(';')
            .filter(Boolean)
            .map((s) => s.split(':') as [string, string]),
        ),
        ...style,
      }}
    >
      {loading ? '…' : children}
    </button>
  );
}
