import React, { useState, useRef, useEffect, useId } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface AssuredSelectProps {
  id?: string;
  name?: string;
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
  'aria-label'?: string;
  placeholder?: string;
}

interface ParsedOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

function parseOptionsFromChildren(children: React.ReactNode): ParsedOption[] {
  const options: ParsedOption[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      const props = (child.props || {}) as Record<string, any>;
      if (child.type === 'option' || 'value' in props) {
        const val = props.value !== undefined ? String(props.value) : String(props.children || '');
        const label = props.children !== undefined && props.children !== null ? props.children : val;
        const disabled = Boolean(props.disabled);
        const className = props.className as string | undefined;
        options.push({ value: val, label, disabled, className });
      } else if (child.type === React.Fragment && props.children) {
        options.push(...parseOptionsFromChildren(props.children));
      }
    }
  });

  return options;
}

export const AssuredSelect: React.FC<AssuredSelectProps> = ({
  id,
  name,
  value,
  onChange,
  disabled = false,
  className = '',
  children,
  'aria-label': ariaLabel,
  placeholder = 'Select...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const generatedId = useId();
  const selectId = id || generatedId;

  const parsedOptions = parseOptionsFromChildren(children);
  const stringVal = value !== undefined && value !== null ? String(value) : '';
  const selectedOption = parsedOptions.find((opt) => String(opt.value) === stringVal);
  const displayLabel = selectedOption ? selectedOption.label : (parsedOptions[0]?.label || stringVal || placeholder);

  // Close when clicking or touching outside
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDownOutside = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('touchstart', handlePointerDownOutside);
    document.addEventListener('keydown', handleKeyDownOutside);

    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('touchstart', handlePointerDownOutside);
      document.removeEventListener('keydown', handleKeyDownOutside);
    };
  }, [isOpen]);

  // Determine if dropdown should open upward or downward based on viewport space
  const toggleDropdown = () => {
    if (disabled) return;
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 220);

      const selectedIdx = parsedOptions.findIndex((opt) => String(opt.value) === stringVal);
      setFocusedIndex(selectedIdx >= 0 ? selectedIdx : 0);
    }
    setIsOpen((prev) => !prev);
  };

  const handleSelectOption = (opt: ParsedOption, e?: React.SyntheticEvent) => {
    if (e) e.stopPropagation();
    if (opt.disabled) return;

    setIsOpen(false);

    if (onChange) {
      const syntheticEvent = {
        target: {
          name,
          id: selectId,
          value: opt.value,
        },
        currentTarget: {
          name,
          id: selectId,
          value: opt.value,
        },
        stopPropagation: () => {},
        preventDefault: () => {},
      } as unknown as React.ChangeEvent<HTMLSelectElement>;

      onChange(syntheticEvent);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        toggleDropdown();
        return;
      }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      let nextIdx = focusedIndex + dir;
      if (nextIdx < 0) nextIdx = parsedOptions.length - 1;
      if (nextIdx >= parsedOptions.length) nextIdx = 0;

      while (parsedOptions[nextIdx]?.disabled && nextIdx !== focusedIndex) {
        nextIdx = (nextIdx + dir + parsedOptions.length) % parsedOptions.length;
      }
      setFocusedIndex(nextIdx);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isOpen && focusedIndex >= 0 && parsedOptions[focusedIndex]) {
        handleSelectOption(parsedOptions[focusedIndex]);
      } else {
        toggleDropdown();
      }
    }
  };

  useEffect(() => {
    if (isOpen && menuRef.current && focusedIndex >= 0) {
      const optionNode = menuRef.current.children[focusedIndex] as HTMLElement;
      if (optionNode) {
        optionNode.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex, isOpen]);

  return (
    <div ref={containerRef} className="relative inline-block w-full">
      {/* Hidden native select for form compatibility */}
      <select
        aria-hidden="true"
        tabIndex={-1}
        name={name}
        id={`${selectId}-native`}
        value={stringVal}
        onChange={() => {}}
        className="sr-only hidden"
      >
        {children}
      </select>

      {/* Visible Custom Select Trigger */}
      <button
        ref={triggerRef}
        type="button"
        id={selectId}
        disabled={disabled}
        onClick={toggleDropdown}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={`w-full flex items-center justify-between gap-2 bg-white border border-[#0E1E2B]/20 rounded-lg px-3.5 sm:px-4 py-3 text-xs sm:text-sm font-semibold text-[#0E1E2B] hover:border-[#0E1E2B]/35 focus:outline-none focus:ring-2 focus:ring-[#628EF7]/50 focus:border-[#628EF7] disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed transition-all cursor-pointer min-h-[52px] text-left select-none ${className}`}
      >
        <span className="truncate pr-1">{displayLabel}</span>
        <ChevronDown
          className={`w-4 h-4 text-[#0E1E2B]/60 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[#628EF7]' : ''
          }`}
        />
      </button>

      {/* Floating Scrollable Options Menu Panel */}
      {isOpen && (
        <div
          ref={menuRef}
          role="listbox"
          tabIndex={-1}
          className={`absolute left-0 right-0 z-50 bg-white rounded-xl border border-[#0E1E2B]/15 shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100 overflow-y-auto overscroll-contain touch-pan-y ${
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } max-h-48 sm:max-h-56 lg:max-h-64`}
          style={{
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {parsedOptions.length === 0 ? (
            <div className="px-3.5 py-2.5 text-xs text-[#0E1E2B]/50 font-medium italic">
              No options available
            </div>
          ) : (
            parsedOptions.map((opt, idx) => {
              const isSelected = String(opt.value) === stringVal;
              const isFocused = idx === focusedIndex;

              return (
                <div
                  key={`${opt.value}-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  onClick={(e) => handleSelectOption(opt, e)}
                  onMouseEnter={() => !opt.disabled && setFocusedIndex(idx)}
                  className={`w-full px-3.5 py-2.5 text-xs font-semibold flex items-center justify-between gap-2 transition-colors cursor-pointer min-h-[44px] select-none touch-manipulation ${
                    opt.disabled
                      ? 'text-gray-400 bg-gray-50/50 cursor-not-allowed'
                      : isSelected
                      ? 'bg-[#EDF8FA] text-[#0E1E2B] font-bold'
                      : isFocused
                      ? 'bg-[#F4F6F8] text-[#0E1E2B]'
                      : 'text-[#0E1E2B]/80 hover:bg-[#F4F6F8] active:bg-[#EDF8FA] hover:text-[#0E1E2B]'
                  } ${opt.className || ''}`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && (
                    <Check className="w-4 h-4 text-[#628EF7] shrink-0 stroke-[2.5]" />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
