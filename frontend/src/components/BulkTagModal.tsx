import { Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { files as api } from '../api'

interface Props {
  fileCount: number
  selectedPaths: string[]
  onClose: () => void
  onSuccess: () => void
}

export default function BulkTagModal({ fileCount, selectedPaths, onClose, onSuccess }: Props) {
  const { t } = useTranslation()
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [loading, setLoading] = useState(false)
  const tagInputRef = useRef<HTMLInputElement>(null)

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase()
    if (!tag || tags.includes(tag)) return
    setTags([...tags, tag])
    setTagInput('')
    tagInputRef.current?.focus()
  }

  function removeTag(tag: string) {
    setTags(tags.filter((x) => x !== tag))
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  async function submit() {
    if (tags.length === 0) {
      toast.error('Add at least one tag')
      return
    }
    setLoading(true)
    try {
      await api.setTagsBulk(selectedPaths, tags, [])
      toast.success(`Applied to ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`)
      onSuccess()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
              <Plus className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">Add Tags</h2>
          </div>

          <p className="text-sm text-text-secondary mb-4">
            Apply tags to {fileCount} {fileCount === 1 ? 'file' : 'files'}
          </p>

          {/* Tag input */}
          <div className="mb-4 p-3 bg-overlay/30 border border-border rounded-lg">
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-accent/20 text-accent rounded-md text-xs font-medium"
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="hover:opacity-70 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              ref={tagInputRef}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKeyDown}
              placeholder="Type tag, press Enter"
              className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={submit}
              disabled={loading || tags.length === 0}
              className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {loading ? 'Applying…' : 'Apply Tags'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
