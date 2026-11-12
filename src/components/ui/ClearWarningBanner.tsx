import React from 'react';
import { DeleteConfirmModal, type DeleteConfirmModalProps } from './DeleteConfirmModal';

export interface ClearWarningBannerProps extends DeleteConfirmModalProps {}

/**
 * Modern modal replacement for legacy clear warning banner.
 * Displays a clean, non-displacing confirmation modal.
 */
export const ClearWarningBanner: React.FC<ClearWarningBannerProps> = (props) => {
  return <DeleteConfirmModal {...props} />;
};

export default ClearWarningBanner;
