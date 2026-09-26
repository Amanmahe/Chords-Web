"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

// Error and warning toasts stay until the user closes them (X button or
// swipe) so they aren't missed. Patched once here so every
// `toast.error` / `toast.warning` call in the app gets it; a call can still
// pass its own `duration` / `closeButton`.
type PersistentToast = typeof toast.error & { __persistent?: boolean }
for (const type of ["error", "warning"] as const) {
  const original = toast[type] as PersistentToast
  if (original.__persistent) continue // already patched (hot reload)
  const persistent: PersistentToast = (message, data) =>
    original(message, { duration: Infinity, closeButton: true, dismissible: true, ...data })
  persistent.__persistent = true
  toast[type] = persistent
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Sonner puts the X top-left in LTR; move it to the top-right corner.
          closeButton: "!left-auto !right-0 ![transform:translate(35%,-35%)]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
