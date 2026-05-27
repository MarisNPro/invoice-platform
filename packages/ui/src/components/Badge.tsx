import type { ReactNode } from 'react';

export interface BadgeProps {
  color?: 'blue' | 'green' | 'red' | 'orange' | 'gray';
  children: ReactNode;
}

const colors: Record<NonNullable<BadgeProps['color']>, { bg: string; text: string }> = {
  blue:   { bg: '#e7f5ff', text: '#1971c2' },
  green:  { bg: '#ebfbee', text: '#2f9e44' },
  red:    { bg: '#fff5f5', text: '#c92a2a' },
  orange: { bg: '#fff4e6', text: '#d9480f' },
  gray:   { bg: '#f8f9fa', text: '#495057' },
};

export function Badge({ color = 'gray', children }: BadgeProps) {
  const { bg, text } = colors[color];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: bg,
        color: text,
      }}
    >
      {children}
    </span>
  );
}
