'use client'

import * as React from "react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import "@/i18n"
import { SendIcon } from "./icons/send-icon"

interface ChatInputProps {
  onSubmit: (message: string) => Promise<void> | void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  className?: string
}

export function ChatInput({
  onSubmit,
  placeholder,
  disabled = false,
  loading = false,
  className = "",
}: ChatInputProps) {
  const [message, setMessage] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const { t } = useTranslation('common')
  const isBusy = isLoading || loading

  const computedPlaceholder = placeholder ?? t('chat.placeholder')

  const MAX_HEIGHT = 160

  React.useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      const newHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT)
      textarea.style.height = `${newHeight}px`
      textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT ? "auto" : "hidden"
    }
  }, [message])

  const handleSubmit = async () => {
    const trimmed = message.trim()
    if (!trimmed || isBusy || disabled) return

    setIsLoading(true)
    try {
      await onSubmit(trimmed)
      setMessage("")
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    } catch (err) {
      console.error("Submit error:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className={`flex min-h-10 items-end gap-2 ${className}`}>

      <Textarea
        ref={textareaRef}
        placeholder={computedPlaceholder}
        aria-label={computedPlaceholder}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || isBusy}
        rows={1}
        className="flex-1 min-h-10 resize-none transition-all duration-100 ease-in-out order-1 "
      />
      <Button
        onClick={handleSubmit}
        disabled={isBusy || disabled || !message.trim()}
        size="icon"
        aria-label={t('chat.send')}
        title={t('chat.send')}
        className="rounded-full flex-shrink-0"
      >
        {isBusy ? <Loader2 className="animate-spin size-6" /> : <SendIcon className="fill-white size-7 translate-x-0.5" />}
      </Button>
    </div>
  )
}
