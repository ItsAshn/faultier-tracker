import { useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'

export interface Toast {
  id: string
  message: string
  type: 'success' | 'info' | 'error'
  duration?: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (message: string, type?: Toast['type'], duration?: number) => void
  removeToast: (id: string) => void
}

let toastListeners: ((toasts: Toast[]) => void)[] = []
let toasts: Toast[] = []

function notifyListeners() {
  toastListeners.forEach((listener) => listener([...toasts]))
}

export function addToast(
  message: string,
  type: Toast['type'] = 'info',
  duration: number = 4000
): void {
  const id = Math.random().toString(36).substring(2, 9)
  const toast: Toast = { id, message, type, duration }
  toasts = [...toasts, toast]
  notifyListeners()

  // Auto-remove after duration
  setTimeout(() => {
    removeToast(id)
  }, duration)
}

export function removeToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id)
  notifyListeners()
}

export function subscribeToToasts(callback: (toasts: Toast[]) => void): () => void {
  toastListeners.push(callback)
  callback([...toasts])
  return () => {
    toastListeners = toastListeners.filter((cb) => cb !== callback)
  }
}

// Hook for components
export function useToasts(): ToastState {
  const [localToasts, setLocalToasts] = useState<Toast[]>([])

  const addToastCallback = useCallback(
    (message: string, type: Toast['type'] = 'info', duration: number = 4000) => {
      addToast(message, type, duration)
    },
    []
  )

  const removeToastCallback = useCallback((id: string) => {
    removeToast(id)
  }, [])

  useEffect(() => {
    const unsubscribe = subscribeToToasts((newToasts) => {
      setLocalToasts(newToasts)
    })
    return unsubscribe
  }, [])

  return {
    toasts: localToasts,
    addToast: addToastCallback,
    removeToast: removeToastCallback,
  }
}

// Toast container component
export function ToastContainer(): JSX.Element {
  const [toastList, setToastList] = useState<Toast[]>([])

  useEffect(() => {
    const unsubscribe = subscribeToToasts((newToasts) => {
      setToastList(newToasts)
    })
    return unsubscribe
  }, [])

  if (toastList.length === 0) return null as any

  return (
    <div className="toast-container">
      {toastList.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.type}`}
          onClick={() => removeToast(toast.id)}
        >
          <span className="toast__message">{toast.message}</span>
          <button
            className="toast__close"
            onClick={(e) => {
              e.stopPropagation()
              removeToast(toast.id)
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
