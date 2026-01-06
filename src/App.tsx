import { useState, useRef, useEffect } from 'react'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import ReactMarkdown from 'react-markdown'
import './App.css'

// Strip markdown syntax for plain text
const stripMarkdown = (text: string): string => {
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY
const TTS_MODEL_ID = 'eleven_v3'
const GPT_MODEL_ID = 'gpt-5.2'

const elevenlabs = new ElevenLabsClient({
  apiKey: ELEVENLABS_API_KEY,
})

interface Voice {
  voice_id: string
  name: string
  category?: string
}

function App() {
  // ChatGPT state
  const [prompt, setPrompt] = useState('')
  const [gptResponse, setGptResponse] = useState('')
  const [gptLoading, setGptLoading] = useState(false)
  const [gptError, setGptError] = useState<string | null>(null)

  // TTS state
  const [text, setText] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [voices, setVoices] = useState<Voice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [stability, setStability] = useState(0.5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  // Fetch voices on mount
  useEffect(() => {
    const fetchVoices = async () => {
      if (!ELEVENLABS_API_KEY) return

      setVoicesLoading(true)
      try {
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
          },
        })
        if (response.ok) {
          const data = await response.json()
          // Sort voices: user-created first (cloned, generated), then premade
          const sortedVoices = (data.voices || []).sort((a: Voice, b: Voice) => {
            const userCategories = ['cloned', 'generated']
            const aIsUser = userCategories.includes(a.category || '')
            const bIsUser = userCategories.includes(b.category || '')
            if (aIsUser && !bIsUser) return -1
            if (!aIsUser && bIsUser) return 1
            return a.name.localeCompare(b.name)
          })
          setVoices(sortedVoices)
          // Auto-select first voice if available
          if (sortedVoices.length > 0 && !voiceId) {
            setVoiceId(sortedVoices[0].voice_id)
          }
        }
      } catch (err) {
        console.error('Failed to fetch voices:', err)
      } finally {
        setVoicesLoading(false)
      }
    }

    fetchVoices()
  }, [])

  const generateGptResponse = async () => {
    if (!prompt.trim()) {
      setGptError('Please enter a prompt')
      return
    }
    if (!OPENAI_API_KEY) {
      setGptError('OpenAI API key not configured in .env file')
      return
    }

    setGptLoading(true)
    setGptError(null)

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: GPT_MODEL_ID,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error?.message || `API Error: ${response.status}`)
      }

      const data = await response.json()
      setGptResponse(data.choices[0]?.message?.content || '')
    } catch (err) {
      setGptError(err instanceof Error ? err.message : 'Failed to generate response')
    } finally {
      setGptLoading(false)
    }
  }

  const copyToTTS = () => {
    setText(stripMarkdown(gptResponse))
  }

  const generateAudio = async () => {
    if (!text.trim()) {
      setError('Please enter some text')
      return
    }
    if (!voiceId.trim()) {
      setError('Please enter a Voice ID')
      return
    }
    if (!ELEVENLABS_API_KEY) {
      setError('API key not configured in .env file')
      return
    }

    setLoading(true)
    setError(null)

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
    }

    try {
      const audio = await elevenlabs.textToSpeech.convert(voiceId, {
        text: text,
        modelId: TTS_MODEL_ID,
        outputFormat: 'mp3_44100_128',
        voiceSettings: {
          stability: stability,
          similarityBoost: 0.75,
        },
      })

      const reader = audio.getReader()
      const chunks: BlobPart[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(new Uint8Array(value) as BlobPart)
      }
      const blob = new Blob(chunks, { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      setAudioUrl(url)

      if (audioRef.current) {
        audioRef.current.src = url
        audioRef.current.play()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate audio')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Han's Voice Studio</h1>
      </header>

      <main className="main">
        <div className="panels">
          {/* ChatGPT Panel */}
          <div className="card">
            <div className="card-header">
              <h2>ChatGPT</h2>
              <span className="model-badge">{GPT_MODEL_ID}</span>
            </div>

            <div className="form-group">
              <label htmlFor="prompt">Prompt</label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter your prompt for ChatGPT..."
                className="prompt-input"
              />
            </div>

            <button
              onClick={generateGptResponse}
              disabled={gptLoading}
              className="generate-btn"
            >
              {gptLoading ? (
                <>
                  <span className="spinner"></span>
                  Generating...
                </>
              ) : (
                'Generate Response'
              )}
            </button>

            {gptError && <div className="error">{gptError}</div>}

            {gptResponse && (
              <div className="response-section">
                <div className="response-header">
                  <label>Response</label>
                  <button onClick={copyToTTS} className="copy-btn">
                    Copy to TTS →
                  </button>
                </div>
                <div className="response-box">
                  <ReactMarkdown>{gptResponse}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>

          {/* TTS Panel */}
          <div className="card">
            <div className="card-header">
              <h2>Text to Speech</h2>
              <span className="model-badge">{TTS_MODEL_ID}</span>
            </div>

            <div className="input-row">
              <div className="form-group">
                <label htmlFor="voiceId">Voice</label>
                <select
                  id="voiceId"
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  disabled={voicesLoading}
                >
                  {voicesLoading ? (
                    <option>Loading voices...</option>
                  ) : voices.length === 0 ? (
                    <option value="">No voices found</option>
                  ) : (
                    voices.map((voice) => (
                      <option key={voice.voice_id} value={voice.voice_id}>
                        {voice.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="stability">
                  Stability <span className="value">{stability.toFixed(2)}</span>
                </label>
                <div className="slider-container">
                  <input
                    id="stability"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={stability}
                    onChange={(e) => setStability(parseFloat(e.target.value))}
                  />
                  <div className="slider-labels">
                    <span>Variable</span>
                    <span>Stable</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="text">Text</label>
              <textarea
                id="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter the text you want to convert to speech..."
              />
            </div>

            <button
              onClick={generateAudio}
              disabled={loading}
              className="generate-btn"
            >
              {loading ? (
                <>
                  <span className="spinner"></span>
                  Generating...
                </>
              ) : (
                'Generate Speech'
              )}
            </button>

            {error && <div className="error">{error}</div>}

            {audioUrl && (
              <div className="audio-section">
                <audio ref={audioRef} controls src={audioUrl} />
                <a href={audioUrl} download="generated-audio.mp3" className="download-btn">
                  Download
                </a>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
