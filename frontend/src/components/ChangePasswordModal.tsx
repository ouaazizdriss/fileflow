import { FormEvent, useState } from 'react'
import { KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { userMgmt } from '../api'

interface Props {
  onClose: () => void
}

export default function ChangePasswordModal({ onClose }: Props) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !loading

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    try {
      await userMgmt.changeOwnPassword(current, next)
      toast.success('Password updated')
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
              <KeyRound className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">{t('changePassword.title')}</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <Field
              label={t('changePassword.current')}
              type="password"
              value={current}
              onChange={setCurrent}
              autoFocus
              placeholder="••••••••"
            />
            <Field
              label={t('changePassword.new')}
              type="password"
              value={next}
              onChange={setNext}
              placeholder={t('changePassword.newHint')}
              hint={next.length > 0 && next.length < 8 ? t('changePassword.newError') : undefined}
            />
            <Field
              label={t('changePassword.confirm')}
              type="password"
              value={confirm}
              onChange={setConfirm}
              placeholder="••••••••"
              error={mismatch ? t('changePassword.confirmError') : undefined}
            />

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {loading ? t('changePassword.saving') : t('changePassword.submit')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoFocus,
  hint,
  error,
}: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  hint?: string
  error?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
      />
      {hint && <p className="text-xs text-warning mt-1">{hint}</p>}
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  )
}
