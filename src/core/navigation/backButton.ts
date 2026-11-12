import { App as CapApp } from '@capacitor/app';

type BackHandler = () => boolean;

const handlerStack: BackHandler[] = [];
let isInitialized = false;

/**
 * Register a back button handler. Returns an unregister function.
 * Handlers are executed in LIFO order (last registered runs first).
 * If a handler returns true, the back event is considered handled and propagation stops.
 */
export function registerBackHandler(handler: BackHandler): () => void {
  handlerStack.push(handler);
  initBackButtonListener();

  return () => {
    const index = handlerStack.lastIndexOf(handler);
    if (index !== -1) {
      handlerStack.splice(index, 1);
    }
  };
}

/**
 * Trigger the back action manually. Returns true if handled by a registered handler.
 */
export function triggerBackAction(): boolean {
  for (let i = handlerStack.length - 1; i >= 0; i--) {
    const handler = handlerStack[i];
    try {
      const handled = handler();
      if (handled) {
        return true;
      }
    } catch (err) {
      console.warn('Error in back handler:', err);
    }
  }
  return false;
}

function initBackButtonListener(): void {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  // 0. Native MainActivity OnBackPressedDispatcher bridge event (captures both nav bar & edge gestures)
  window.addEventListener(
    'hardwareBackPress',
    (e: Event) => {
      if (e.defaultPrevented) return;
      const handled = triggerBackAction();
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true }
  );

  // 1. Capacitor native Android back button event
  try {
    CapApp.addListener('backButton', ({ canGoBack }) => {
      const handled = triggerBackAction();
      if (handled) {
        return;
      }

      // If nothing in the handler stack handled it, dispatch global event for AppShell
      const customEvent = new CustomEvent('paperweight:back', {
        cancelable: true,
        detail: { canGoBack },
      });
      const allowed = window.dispatchEvent(customEvent);

      if (!allowed) {
        // AppShell handled it
        return;
      }

      // If top level and cannot go back, minimize or exit app
      if (!canGoBack) {
        CapApp.minimizeApp().catch(() => {});
      } else {
        window.history.back();
      }
    });
  } catch {
    // Capacitor not active or running in web browser
  }

  // 2. Fallback for mobile browser and Cordova/webview backbutton event
  document.addEventListener('backbutton', (e: Event) => {
    const handled = triggerBackAction();
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const customEvent = new CustomEvent('paperweight:back', { cancelable: true });
    const allowed = window.dispatchEvent(customEvent);
    if (!allowed) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // 3. Fallback for browser popstate
  window.addEventListener('popstate', (e: PopStateEvent) => {
    const handled = triggerBackAction();
    if (handled) {
      e.preventDefault();
    }
  });
}
