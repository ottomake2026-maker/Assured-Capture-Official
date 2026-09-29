import React from 'react';
import { ASSURED_LOGO_DATA_URI } from '../assets/assuredLogoData';

interface AssuredLogoProps {
  className?: string;
  alt?: string;
}

/**
 * Assured Logo
 * Uses the client's official brand wordmark image asset directly.
 * Preserves exact letterforms, proportions, and transparent background.
 */
export const AssuredLogo: React.FC<AssuredLogoProps> = ({
  className = 'h-7 sm:h-8',
  alt = 'assured',
}) => {
  return (
    <div className={`inline-flex items-center shrink-0 select-none ${className}`}>
      <img
        src={ASSURED_LOGO_DATA_URI}
        alt={alt}
        className="h-full w-auto max-h-full object-contain block max-w-none"
        loading="eager"
        decoding="sync"
        draggable={false}
      />
    </div>
  );
};
