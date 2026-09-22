import { useState, useCallback, useRef } from 'react';

let idCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const showToast = useCallback((message, variant = 'success') => {
    const id = ++idCounter;
    setToasts(t => [...t, { id, message, variant }]);
    timers.current[id] = setTimeout(() => dismiss(id), 3000);
  }, [dismiss]);

  return { toasts, showToast, dismiss };
}
