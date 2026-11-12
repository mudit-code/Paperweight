/**
 * Paperweight Feature Flags
 *
 * Controls visibility of experimental or unreleased capabilities.
 * Flags default to false unless explicitly overridden in the environment.
 */
export const FEATURE_FLAGS = {
  /**
   * Experimental client-side Office (Word .docx, Excel .xlsx, PowerPoint .pptx) to PDF converter.
   * Default: false (Hidden from UI, search, and shortcuts)
   * Planned for desktop build via a bundled LibreOffice sidecar.
   */
  ENABLE_OFFICE_CONVERTER:
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_ENABLE_OFFICE_CONVERTER === 'true',
} as const;

