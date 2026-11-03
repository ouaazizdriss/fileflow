import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { userMgmt } from '../api'
import type { UserView } from '../types'
import { formatSize } from '../utils'

export default function StorageQuotaWidget() {
  const { t } = useTranslation()
  const [user, setUser] = useState<UserView | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    userMgmt.list()
      .then(users => {
        // Get current user from first user in list (API would need /me endpoint for actual user)
        if (users.length > 0) setUser(users[0])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading || !user || user.quota_gb === null) return null

  const usedGb = user.used_bytes / (1024 * 1024 * 1024)
  const quotaGb = user.quota_gb
  const percentageUsed = (usedGb / quotaGb) * 100
  const isWarning = percentageUsed >= 80
  const isCritical = percentageUsed >= 95

  return (
    <div className="px-4 py-3 bg-overlay/30 rounded-lg space-y-2">
      <div className="flex items-center gap-2">
        <HardDrive className={`w-4 h-4 ${
          isCritical ? 'text-danger' : isWarning ? 'text-warning' : 'text-accent'
        }`} />
        <span className="text-xs font-semibold text-text-primary">{t('storageQuota.title')}</span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-2 bg-overlay rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-colors ${
              isCritical ? 'bg-danger' : isWarning ? 'bg-warning' : 'bg-accent'
            }`}
            style={{ width: `${Math.min(percentageUsed, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-secondary">
            {formatSize(user.used_bytes)} / {quotaGb}GB
          </span>
          <span className={`font-semibold ${
            isCritical ? 'text-danger' : isWarning ? 'text-warning' : 'text-text-secondary'
          }`}>
            {Math.round(percentageUsed)}%
          </span>
        </div>
      </div>

      {/* Warning message */}
      {(isWarning || isCritical) && (
        <p className={`text-[10px] ${
          isCritical ? 'text-danger' : 'text-warning'
        }`}>
          {isCritical
            ? t('storageQuota.criticalWarning')
            : t('storageQuota.warningApproaching')}
        </p>
      )}
    </div>
  )
}
