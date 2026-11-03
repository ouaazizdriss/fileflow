import { X, HardDrive } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onClose: () => void
}

export default function AboutModal({ onClose }: Props) {
  const { t } = useTranslation()

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-text-primary">{t('about.title')}</span>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 flex flex-col items-center gap-4 text-center">
          {/* Logo */}
          <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <HardDrive className="w-8 h-8 text-accent" />
          </div>

          {/* Name + version */}
          <div>
            <h2 className="text-xl font-bold text-text-primary tracking-tight">{t('about.appName')}</h2>
            <p className="text-xs text-text-muted mt-0.5">{t('about.version')}</p>
          </div>

          {/* Description */}
          <p className="text-sm text-text-secondary leading-relaxed max-w-xs">
            {t('about.description')}
          </p>

          {/* Divider */}
          <div className="w-full h-px bg-border" />

          {/* Meta */}
          <dl className="w-full grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-text-muted text-left">{t('about.author')}</dt>
            <dd className="text-text-primary text-right font-medium">{t('about.authorName')}</dd>

            <dt className="text-text-muted text-left">{t('about.license')}</dt>
            <dd className="text-right">
              <span className="inline-block px-2 py-0.5 rounded bg-success/10 text-success text-xs font-semibold border border-success/20">
                {t('about.licenseName')}
              </span>
            </dd>

            <dt className="text-text-muted text-left">{t('about.stack')}</dt>
            <dd className="text-text-secondary text-right text-xs">{t('about.stackValue')}</dd>
          </dl>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-overlay hover:bg-border rounded-lg text-text-secondary hover:text-text-primary transition-colors"
          >
            {t('about.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
