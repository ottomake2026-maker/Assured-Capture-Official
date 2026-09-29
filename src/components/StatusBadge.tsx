import React from 'react';
import { ReportStatus } from '../types';

interface StatusBadgeProps {
  status: ReportStatus;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const STATUS_CONFIG: Record<
  ReportStatus,
  { bg: string; text: string; border: string; label: string; dot: string }
> = {
  Draft: {
    bg: 'bg-[#F4F6F8]',
    text: 'text-[#0E1E2B]/70',
    border: 'border-[#C6CBD1]',
    dot: 'bg-[#C6CBD1]',
    label: 'Draft',
  },
  'In Progress': {
    bg: 'bg-[#B2E5F6]/30',
    text: 'text-[#0E1E2B]',
    border: 'border-[#B2E5F6]',
    dot: 'bg-[#628EF7]',
    label: 'In Progress',
  },
  'Awaiting Review': {
    bg: 'bg-[#B2E5F6]/50',
    text: 'text-[#0E1E2B]',
    border: 'border-[#628EF7]/40',
    dot: 'bg-[#628EF7]',
    label: 'Awaiting Review',
  },
  Completed: {
    bg: 'bg-[#8CBFAE]/25',
    text: 'text-[#0E1E2B]',
    border: 'border-[#8CBFAE]',
    dot: 'bg-[#4F7F70]',
    label: 'Completed',
  },
  'Sent to Client': {
    bg: 'bg-[#8CBFAE]/35',
    text: 'text-[#0E1E2B]',
    border: 'border-[#8CBFAE]',
    dot: 'bg-[#2D6151]',
    label: 'Sent to Client',
  },
};

export const ALL_REPORT_STATUSES: ReportStatus[] = [
  'Draft',
  'In Progress',
  'Awaiting Review',
  'Completed',
  'Sent to Client',
];

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  className = '',
}) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.Draft;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[11px] font-semibold',
    md: 'px-2.5 py-0.5 text-xs font-semibold',
    lg: 'px-3 py-1 text-xs font-semibold',
  }[size];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border ${config.bg} ${config.text} ${config.border} ${sizeClasses} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`} />
      <span className="whitespace-nowrap tracking-tight">{config.label}</span>
    </span>
  );
};
