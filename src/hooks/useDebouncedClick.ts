import { useRef, useCallback } from 'react'

export function useDebouncedClick<T extends (...args: any[]) => any>(
    callback: T,
    delay = 500
): T {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const isProcessing = useRef(false)

    const debounced = useCallback((...args: Parameters<T>) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        if (isProcessing.current) return

        timeoutRef.current = setTimeout(async () => {
            isProcessing.current = true
            try {
                await callback(...args)
            } finally {
                isProcessing.current = false
                timeoutRef.current = null
            }
        }, delay)
    } as T, [callback, delay])

    return debounced
}