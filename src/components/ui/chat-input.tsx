'use client'

import * as React from "react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import "@/i18n"
import { SendIcon } from "./icons/send-icon"
import { extractAutocompleteTarget } from "@/lib/autocomplete-utils"

const MAX_AUTOCOMPLETE_SCORE = 220

function getAutocompleteScore(candidate: string, query: string): number {
  const normalizedCandidate = candidate.toLowerCase()
  const normalizedQuery = query.toLowerCase()

  if (normalizedCandidate === normalizedQuery) {
    return Number.POSITIVE_INFINITY
  }

  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return 0
  }

  const wordIndex = normalizedCandidate.indexOf(` ${normalizedQuery}`)
  if (wordIndex >= 0) {
    return 100 + wordIndex
  }

  const containsIndex = normalizedCandidate.indexOf(normalizedQuery)
  if (containsIndex >= 0) {
    return 200 + containsIndex
  }

  let queryIndex = 0
  for (const char of normalizedCandidate) {
    if (char === normalizedQuery[queryIndex]) {
      queryIndex += 1
      if (queryIndex === normalizedQuery.length) {
        return 400 + normalizedCandidate.length
      }
    }
  }

  return Number.POSITIVE_INFINITY
}

function isTypedTokenMatch(currentToken: string, suggestionToken: string): boolean {
  const normalizedCurrent = currentToken.toLowerCase()
  const normalizedSuggestion = suggestionToken.toLowerCase()
  return normalizedCurrent === normalizedSuggestion || normalizedSuggestion.startsWith(normalizedCurrent)
}

function getReplacementWordCount(current: string, suggestion: string, autocompleteItems: string[]): number {
  const currentWords = current.split(/\s+/).filter(Boolean)
  const suggestionWords = suggestion.trim().split(/\s+/).filter(Boolean)

  if (suggestionWords.length < 2 || currentWords.length < suggestionWords.length) {
    return 1
  }

  const phraseLength = suggestionWords.length
  const currentTailWords = currentWords.slice(-phraseLength)
  const knownAutocompletePhrases = new Set(
    autocompleteItems.map((item) => item.trim().toLowerCase()).filter(Boolean),
  )

  if (!knownAutocompletePhrases.has(currentTailWords.join(" ").toLowerCase())) {
    return 1
  }

  for (let index = 1; index < phraseLength; index += 1) {
    if (!isTypedTokenMatch(currentTailWords[index] ?? "", suggestionWords[index] ?? "")) {
      return 1
    }
  }

  return phraseLength
}

interface ChatInputProps {
  onSubmit: (message: string) => Promise<void> | void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  className?: string
  autocompleteItems?: string[]
}

export function ChatInput({
  onSubmit,
  placeholder,
  disabled = false,
  loading = false,
  className = "",
  autocompleteItems = [],
}: ChatInputProps) {
  const [message, setMessage] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(false)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = React.useState(0)
  const [areSuggestionsHidden, setAreSuggestionsHidden] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const { t } = useTranslation('common')
  const isBusy = isLoading || loading

  const computedPlaceholder = placeholder ?? t('chat.placeholder')

  const MAX_HEIGHT = 160

  const suggestions = React.useMemo(() => {
    if (areSuggestionsHidden) {
      return []
    }

    if (/\s$/.test(message)) {
      return []
    }

    const target = extractAutocompleteTarget(message)
    if (!target || target.length < 3) {
      return []
    }

    return autocompleteItems
      .map((item) => ({ item, score: getAutocompleteScore(item, target) }))
      .filter((entry) => Number.isFinite(entry.score) && entry.score <= MAX_AUTOCOMPLETE_SCORE)
      .sort((left, right) => left.score - right.score || left.item.localeCompare(right.item))
      .map((entry) => entry.item)
      .slice(0, 6)
  }, [areSuggestionsHidden, autocompleteItems, message])

  React.useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      const newHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT)
      textarea.style.height = `${newHeight}px`
      textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT ? "auto" : "hidden"
    }
  }, [message])

  React.useEffect(() => {
    setSelectedSuggestionIndex(0)
  }, [suggestions])

  const applySuggestion = React.useCallback((suggestion: string) => {
    setAreSuggestionsHidden(false)
    setMessage((current) => {
      const withoutTrailingWhitespace = current.replace(/\s+$/, "")
      if (!withoutTrailingWhitespace) {
        return `${suggestion} `
      }

      const currentWords = withoutTrailingWhitespace.split(/\s+/).filter(Boolean)
      if (currentWords.length === 0) {
        return `${suggestion} `
      }

      const replacementWordCount = getReplacementWordCount(
        withoutTrailingWhitespace,
        suggestion,
        autocompleteItems,
      )

      const prefixWords = currentWords.slice(0, Math.max(0, currentWords.length - replacementWordCount))
      return `${[...prefixWords, suggestion].join(" ")} `
    })

    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [autocompleteItems])

  const handleSubmit = async () => {
    const trimmed = message.trim()
    if (!trimmed || isBusy || disabled) return

    setAreSuggestionsHidden(true)
    setIsLoading(true)
    try {
      await onSubmit(trimmed)
      setMessage("")
      setAreSuggestionsHidden(false)
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
    if (suggestions.length > 0 && e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedSuggestionIndex((current) => (current + 1) % suggestions.length)
      return
    }

    if (suggestions.length > 0 && e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length)
      return
    }

    if (suggestions.length > 0 && (e.key === "Tab" )) {
      e.preventDefault()
      applySuggestion(suggestions[selectedSuggestionIndex] ?? suggestions[0])
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className={`flex min-h-10 items-end gap-2 ${className}`}>
      <div className="relative flex-1">
        <Textarea
          ref={textareaRef}
          placeholder={computedPlaceholder}
          aria-label={computedPlaceholder}
          value={message}
          onChange={(e) => {
            setAreSuggestionsHidden(false)
            setMessage(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled || isBusy}
          rows={1}
          className="flex-1 min-h-10 resize-none transition-all duration-100 ease-in-out order-1"
        />
        {suggestions.length > 0 ? (
          <div className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-md border bg-background shadow-md">
            <ul className="max-h-100 overflow-y-auto ">
              {suggestions.map((suggestion, index) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm break-words whitespace-normal ${index === selectedSuggestionIndex ? "bg-muted" : "bg-background"}`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applySuggestion(suggestion)
                    }}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 break-words">{suggestion}</span>
                      {index === selectedSuggestionIndex ? (
                        <span className="shrink-0 rounded border border-border/70 bg-muted-foreground/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          ↹ TAB
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
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
