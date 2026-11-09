'use client'

import * as React from "react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import "@/i18n"
import { SendIcon } from "./icons/send-icon"
import { extractAutocompleteTargets } from "@/lib/autocomplete-utils"

const MAX_AUTOCOMPLETE_SCORE = 520

function normalizeAutocompleteText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function getAutocompleteScore(candidate: string, query: string): number {
  const normalizedCandidate = normalizeAutocompleteText(candidate)
  const normalizedQuery = normalizeAutocompleteText(query)

  if (!normalizedCandidate || !normalizedQuery) {
    return Number.POSITIVE_INFINITY
  }

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
        return 300 + normalizedCandidate.length
      }
    }
  }

  return Number.POSITIVE_INFINITY
}

interface AutocompleteSuggestion {
  item: string
  matchedTarget: string
  score: number
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

  const suggestions = React.useMemo<AutocompleteSuggestion[]>(() => {
    if (areSuggestionsHidden) {
      return []
    }

    if (/\s$/.test(message)) {
      return []
    }

    const targets = extractAutocompleteTargets(message)
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= 2)

    if (targets.length === 0) {
      return []
    }

    return autocompleteItems
      .map((item) => {
        let bestTarget = ""
        let bestScore = Number.POSITIVE_INFINITY

        for (const target of targets) {
          const score = getAutocompleteScore(item, target)
          if (score < bestScore) {
            bestScore = score
            bestTarget = target
          }
        }

        return {
          item,
          matchedTarget: bestTarget,
          score: bestScore,
        }
      })
      .filter((entry) => Number.isFinite(entry.score) && entry.score <= MAX_AUTOCOMPLETE_SCORE)
      .sort((left, right) => left.score - right.score || left.item.localeCompare(right.item))
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
  }, [computedPlaceholder, isBusy, message])

  // New suggestions start at the first one; disabling the input clears it.
  const [shownSuggestions, setShownSuggestions] = React.useState(suggestions)
  if (suggestions !== shownSuggestions) {
    setShownSuggestions(suggestions)
    setSelectedSuggestionIndex(0)
  }
  const [wasDisabled, setWasDisabled] = React.useState(false)
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled)
    if (disabled) {
      setMessage("")
      setAreSuggestionsHidden(false)
    }
  }

  const applySuggestion = React.useCallback((suggestion: string, matchedTarget?: string) => {
    setAreSuggestionsHidden(false)
    setMessage((current) => {
      const withoutTrailingWhitespace = current.replace(/\s+$/, "")
      if (!withoutTrailingWhitespace) {
        return `${suggestion} `
      }

      const normalizedMatchedTarget = matchedTarget?.trim().toLowerCase()
      if (normalizedMatchedTarget && withoutTrailingWhitespace.toLowerCase().endsWith(normalizedMatchedTarget)) {
        const startIndex = withoutTrailingWhitespace.length - matchedTarget!.trim().length
        const prefix = withoutTrailingWhitespace.slice(0, Math.max(0, startIndex))
        return `${prefix}${suggestion} `
      }

      const activeTokenMatch = withoutTrailingWhitespace.match(/\S+$/)
      if (!activeTokenMatch || activeTokenMatch.index === undefined) {
        return `${withoutTrailingWhitespace} ${suggestion} `
      }

      const prefix = withoutTrailingWhitespace.slice(0, activeTokenMatch.index)
      return `${prefix}${suggestion} `
    })

    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [])

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

    if (suggestions.length > 0 && e.key === "Tab") {
      e.preventDefault()
      const selectedSuggestion = suggestions[selectedSuggestionIndex] ?? suggestions[0]
      if (selectedSuggestion) {
        applySuggestion(selectedSuggestion.item, selectedSuggestion.matchedTarget)
      }
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className={`flex min-h-10 items-end  ${className}`}>
      <div className="relative flex-1">
        <Textarea
          ref={textareaRef}
          autoComplete="off"
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
          className="order-1 flex-1 min-h-10 resize-none duration-100 ease-in-out"
        />
        {suggestions.length > 0 ? (
          <div className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-md border bg-background shadow-md">
            <ul className="max-h-100 overflow-y-auto ">
              {suggestions.map((suggestion, index) => (
                <li key={suggestion.item}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm break-words whitespace-normal ${index === selectedSuggestionIndex ? "bg-muted" : "bg-background"}`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applySuggestion(suggestion.item, suggestion.matchedTarget)
                    }}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 break-words">{suggestion.item}</span>
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
