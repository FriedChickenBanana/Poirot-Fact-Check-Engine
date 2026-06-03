import { useMemo, useRef, useState } from 'react'
import { I18N, t, normalizeVerdictCode, speakVerdict, isSocialMediaLink, isValidUrl } from './i18n'

const DEFAULT_BACKEND_BASE_URL = 'https://poirot-fact-check-engine.onrender.com'
const DEFAULT_LANGUAGE_MODE = 'auto'

function normalizeBaseUrl(value) {
  const trimmed = (value || '').trim()
  if (!trimmed) return DEFAULT_BACKEND_BASE_URL
  return trimmed.replace(/\/+$/, '')
}

function buildBackendUrl(baseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${normalizedPath}`
}

function resolveUiLanguage(mode) {
  if (mode === 'bn' || mode === 'en') return mode
  const browserLang = (navigator.language || 'en').toLowerCase()
  return browserLang.startsWith('bn') ? 'bn' : 'en'
}

function verdictTone(verdict) {
  const normalized = (verdict || '').toLowerCase()
  if (normalized.includes('true')) return 'text-emerald-300'
  if (normalized.includes('false')) return 'text-red-400'
  if (normalized.includes('satir')) return 'text-purple-300'
  if (normalized.includes('uncertain')) return 'text-yellow-300'
  return 'text-white'
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to read file.'))
    reader.readAsDataURL(file)
  })
}

function App() {
  const [languageMode, setLanguageMode] = useState(DEFAULT_LANGUAGE_MODE)
  const [draft, setDraft] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [messages, setMessages] = useState([
    {
      id: 'intro',
      role: 'assistant',
      type: 'system',
      content: t(resolveUiLanguage(languageMode), 'enterClaimOrImage')
    }
  ])
  const fileInputRef = useRef(null)
  const uiLanguage = resolveUiLanguage(languageMode)

  const backendBaseUrl = useMemo(() => {
    return normalizeBaseUrl(import.meta.env.VITE_BACKEND_BASE_URL)
  }, [])

  const canSubmit = draft.trim().length > 0 || imageFile

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const preview = await fileToBase64(file)
    setImageFile(file)
    setImagePreview(preview)
  }

  const resetFileInput = () => {
    setImageFile(null)
    setImagePreview('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const pushMessage = (message) => {
    setMessages((prev) => [...prev, message])
  }

  const replaceLastMessage = (message) => {
    setMessages((prev) => {
      const next = [...prev]
      next[next.length - 1] = message
      return next
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit || isSubmitting) return

    const isImage = Boolean(imageFile)
    let content = isImage ? imageFile.name : draft.trim()
    let isSocialLink = false
    let linkUrl = ''

    if (!isImage && isValidUrl(content)) {
      isSocialLink = isSocialMediaLink(content)
      if (isSocialLink) {
        linkUrl = content
      }
    }

    const preview = imagePreview

    pushMessage({
      id: crypto.randomUUID(),
      role: 'user',
      type: isImage ? 'image' : isSocialLink ? 'social-link' : 'text',
      content,
      imagePreview: preview
    })

    pushMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      type: 'loading',
      content: isSocialLink ? t(uiLanguage, 'extractingContent') : t(uiLanguage, 'analyzing')
    })

    setIsSubmitting(true)
    try {
      let payload
      if (isImage) {
        payload = {
          type: 'image',
          content: content || 'uploaded image',
          base64: preview,
          language: uiLanguage
        }
      } else if (isSocialLink) {
        payload = {
          type: 'social-media',
          content: linkUrl,
          url: linkUrl,
          language: uiLanguage
        }
      } else {
        payload = {
          type: 'text',
          content: content,
          language: uiLanguage
        }
      }

      const response = await fetch(buildBackendUrl(backendBaseUrl, '/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`)
      }

      const result = await response.json()
      const verdictCode = normalizeVerdictCode(result.verdict)
      
      replaceLastMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        type: 'result',
        verdict: result.verdict || t(uiLanguage, 'verdictUncertain'),
        verdict_code: verdictCode,
        confidence: result.confidence,
        explanation: result.explanation || t(uiLanguage, 'noExplanation'),
        sources: result.sources || [],
        keyFindings: result.key_findings || [],
        isSocialLink
      })
    } catch (error) {
      replaceLastMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        type: 'error',
        verdict: t(uiLanguage, 'error'),
        explanation: error.message || t(uiLanguage, 'failedToExtract')
      })
    } finally {
      setIsSubmitting(false)
      setDraft('')
      resetFileInput()
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/15">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center border border-white/30">
              <img src="/icon.png" alt="Poirot" className="h-8 w-8" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
                Poirot
              </p>
              <h1 className="text-2xl font-semibold tracking-tight">
                {t(uiLanguage, 'title')}
              </h1>
            </div>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <div className="text-left text-xs uppercase tracking-[0.3em] text-white/60">
              {t(uiLanguage, 'subtitle')}
            </div>
            <div className="flex gap-3 flex-wrap">
              <select
                value={languageMode}
                onChange={(e) => setLanguageMode(e.target.value)}
                className="border border-white/30 bg-black px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white"
              >
                <option value="auto">{t(uiLanguage, 'languageAuto')}</option>
                <option value="en">{t(uiLanguage, 'languageEnglish')}</option>
                <option value="bn">{t(uiLanguage, 'languageBangla')}</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="border border-white/15 bg-black/70">
          <div className="flex flex-col gap-2 border-b border-white/15 px-4 py-3 text-xs uppercase tracking-[0.25em] text-white/60 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span>{t(uiLanguage, 'consoleTitle')}</span>
            <span>{t(uiLanguage, 'consoleStatus')}</span>
          </div>

          <div className="flex min-h-[50vh] flex-col gap-4 px-4 py-5 sm:min-h-[56vh] sm:px-5 sm:py-6">
            {messages.map((message) => {
              const isUser = message.role === 'user'
              return (
                <div
                  key={message.id}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[92%] border border-white/15 px-4 py-3 text-sm leading-relaxed sm:max-w-[80%] ${
                      isUser ? 'bg-white text-black' : 'bg-black text-white'
                    }`}
                  >
                    {message.type === 'loading' && (
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse bg-white" />
                        <span className="text-xs uppercase tracking-[0.3em] text-white/70">
                          {message.content}
                        </span>
                      </div>
                    )}

                    {message.type === 'system' && (
                      <p className="text-xs uppercase tracking-[0.25em] text-white/70">
                        {message.content}
                      </p>
                    )}

                    {message.type === 'text' && <p>{message.content}</p>}

                    {message.type === 'social-link' && (
                      <div className="flex flex-col gap-2">
                        <div className="text-xs uppercase tracking-[0.25em] text-white/70">
                          {t(uiLanguage, 'linkVerification')}
                        </div>
                        <p className="text-sm break-all">{message.content}</p>
                      </div>
                    )}

                    {message.type === 'image' && (
                      <div className="flex flex-col gap-3">
                        <div className="text-xs uppercase tracking-[0.25em] text-white/70">
                          Image
                        </div>
                        {message.imagePreview && (
                          <img
                            src={message.imagePreview}
                            alt="Uploaded preview"
                            className="max-h-56 w-full border border-white/30 object-cover"
                          />
                        )}
                        <p className="text-sm">{message.content}</p>
                      </div>
                    )}

                    {message.type === 'result' && (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <span
                              className={`text-xs font-semibold uppercase tracking-[0.3em] ${verdictTone(
                                message.verdict
                              )}`}
                            >
                              {t(uiLanguage, 'verdict')}: {message.verdict}
                            </span>
                            {message.confidence && (
                              <span className="text-xs uppercase tracking-[0.25em] text-white/60">
                                {t(uiLanguage, 'confidence')} {message.confidence}%
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => speakVerdict(uiLanguage, message.verdict_code)}
                            className="border border-white/30 bg-black px-2 py-1 text-xs font-semibold uppercase tracking-[0.2em] hover:border-white"
                            title={t(uiLanguage, 'speak')}
                          >
                            🔊
                          </button>
                        </div>
                        <p className="text-sm text-white/80">{message.explanation}</p>
                        {message.keyFindings?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">
                              {t(uiLanguage, 'keyFindings')}
                            </p>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
                              {message.keyFindings.map((finding) => (
                                <li key={finding}>{finding}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {message.sources?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">
                              {t(uiLanguage, 'sources')}
                            </p>
                            <ul className="mt-2 space-y-1 text-xs uppercase tracking-[0.2em]">
                              {message.sources.map((source) => (
                                <li key={source}>
                                  <a
                                    href={source}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline decoration-white/40 underline-offset-4"
                                  >
                                    {source}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {message.type === 'error' && (
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.3em]">
                          {message.verdict}
                        </span>
                        <p className="text-sm text-white/80">{message.explanation}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-white/15">
            <div className="flex flex-col gap-4 px-4 py-5 sm:px-5">
              <div className="flex flex-col gap-2 text-xs uppercase tracking-[0.25em] text-white/60 sm:flex-row sm:items-center sm:justify-between">
                <span>Input</span>
                <span>{imageFile ? 'Image ready' : 'Text only'}</span>
              </div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t(uiLanguage, 'placeholderClaim')}
                rows={3}
                className="w-full resize-none border border-white/20 bg-black px-4 py-3 text-sm text-white outline-none focus:border-white"
              />

              {imagePreview && (
                <div className="flex flex-col gap-2 border border-white/20 bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs uppercase tracking-[0.25em] text-white/60 break-all">
                    {imageFile?.name}
                  </div>
                  <button
                    type="button"
                    onClick={resetFileInput}
                    className="text-xs font-semibold uppercase tracking-[0.25em] text-white"
                  >
                    Remove
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em]"
                >
                  {t(uiLanguage, 'uploadImage')}
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="border border-white px-6 py-2 text-xs font-semibold uppercase tracking-[0.3em] disabled:border-white/20 disabled:text-white/40"
                >
                  {isSubmitting ? 'Running' : t(uiLanguage, 'submit')}
                </button>
              </div>
            </div>
          </form>
        </section>
      </main>
    </div>
  )
}

export default App
