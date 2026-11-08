import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AlertEvent } from './vite-env.d'
import './alert.css'

function eventKey(event: AlertEvent): string {
  return event.kind === 'reminder'
    ? `reminder:${event.reminderId}:${event.scheduledAt}`
    : `consumption:${event.ruleId}:${event.triggeredAt}`
}

function mergeEvents(current: AlertEvent[], incoming: AlertEvent[]): AlertEvent[] {
  const map = new Map<string, AlertEvent>()
  for (const event of [...current, ...incoming]) {
    map.set(eventKey(event), event)
  }
  return Array.from(map.values()).sort((a, b) => a.triggeredAt - b.triggeredAt)
}

function formatWindow(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}

function formatMoney(value: number): string {
  return `¥${value.toFixed(2)}`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// The acknowledge button of a reminder pops up at a random spot inside the
// close zone, so it cannot be dismissed out of muscle memory.
function randomAckPosition(
  zone: HTMLElement | null,
  hasSecondary: boolean
): { left: number; top: number } {
  const width = zone?.clientWidth || 448
  const height = zone?.clientHeight || 112
  const btnWidth = 160
  const btnHeight = 38
  const pad = 14
  const maxLeft = Math.max(pad, width - btnWidth - pad)
  const maxTop = Math.max(pad, height - btnHeight - pad)
  // The fixed secondary button sits at the bottom-left of the zone.
  const secondary = { x1: 16, x2: 148, y1: height - 52, y2: height - 14 }

  for (let i = 0; i < 60; i++) {
    const left = pad + Math.random() * (maxLeft - pad)
    const top = pad + Math.random() * (maxTop - pad)
    if (!hasSecondary) return { left, top }
    const overlaps =
      left < secondary.x2 &&
      left + btnWidth > secondary.x1 &&
      top < secondary.y2 &&
      top + btnHeight > secondary.y1
    if (!overlaps) return { left, top }
  }
  return { left: maxLeft, top: pad }
}

function AlertPage() {
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [ackPos, setAckPos] = useState({ left: 200, top: 14 })
  const closeZoneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.alertApi?.getEvents().then(list => {
      setEvents(prev => mergeEvents(prev, list))
      setLoaded(true)
    }).catch(() => setLoaded(true))

    window.alertApi?.onAlerts(list => {
      setEvents(prev => mergeEvents(prev, list))
      setLoaded(true)
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.alertApi?.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const hasConsumption = events.some(e => e.kind === 'consumption')
  const hasReminder = events.some(e => e.kind === 'reminder')
  const eventSignature = events.map(eventKey).join('|')

  // Re-randomize the acknowledge button for every new reminder batch.
  useLayoutEffect(() => {
    if (!hasReminder || events.length === 0) return
    setAckPos(randomAckPosition(closeZoneRef.current, hasConsumption))
  }, [eventSignature, hasConsumption, hasReminder, events.length])

  const headerIcon = hasReminder && !hasConsumption ? '⏰' : hasReminder ? '🔔' : '⚠️'
  const headerTitle = hasReminder && !hasConsumption
    ? '定时提醒'
    : hasReminder
      ? '提醒与预警'
      : '快速消耗预警'
  const headerSubtitle = hasReminder && !hasConsumption
    ? '你设置的时间到了'
    : hasReminder
      ? '定时提醒与 Token 余额预警'
      : 'Token 余额在设定时间内快速下降'

  return (
    <div className="alert-shell">
      <div className="alert-card">
        <div className="alert-header">
          <div className="alert-icon">{headerIcon}</div>
          <div className="alert-title-wrap">
            <div className="alert-title">{headerTitle}</div>
            <div className="alert-subtitle">{headerSubtitle}</div>
          </div>
          {events.length > 0 && <div className="alert-count">{events.length} 条</div>}
        </div>

        <div className="alert-events">
          {!loaded && events.length === 0 ? (
            <div className="alert-empty">正在加载提醒信息…</div>
          ) : events.length === 0 ? (
            <div className="alert-empty">暂无提醒信息</div>
          ) : (
            events.map(event => {
              if (event.kind === 'reminder') {
                return (
                  <div className="alert-event reminder" key={eventKey(event)}>
                    <div className="alert-event-top">
                      <div className="alert-event-name">{event.title}</div>
                      <div className="alert-event-time">{formatTime(event.triggeredAt)}</div>
                    </div>
                    {event.note && <div className="alert-reminder-note">{event.note}</div>}
                    <div className="alert-event-meta">
                      计划时间 {formatDateTime(event.scheduledAt)}
                    </div>
                  </div>
                )
              }

              const percent = event.threshold > 0
                ? Math.min(100, (event.consumed / event.threshold) * 100)
                : 100
              return (
                <div className="alert-event" key={eventKey(event)}>
                  <div className="alert-event-top">
                    <div className="alert-event-name">{event.ruleName}</div>
                    <div className="alert-event-time">{formatTime(event.triggeredAt)}</div>
                  </div>
                  <div className="alert-event-amount">
                    <span className="consumed">{formatMoney(event.consumed)}</span>
                    <span className="label">已在最近 {formatWindow(event.windowMinutes)} 内消耗</span>
                  </div>
                  <div className="alert-event-meta">
                    触发阈值 {formatMoney(event.threshold)} · 超出 {formatMoney(Math.max(0, event.consumed - event.threshold))}
                  </div>
                  <div className="alert-progress">
                    <div className="alert-progress-fill" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="alert-tip">
          {hasReminder
            ? '到点的提醒会强制置顶弹出，点击「我知道了」关闭。'
            : '点击「我知道了」后关闭；同一预警 30 分钟内不会重复弹出。请到 Token 面板确认各平台余额。'}
        </div>

        {hasReminder ? (
          <div className="alert-close-zone" ref={closeZoneRef}>
            {hasConsumption && (
              <button
                className="alert-btn secondary"
                onClick={() => window.alertApi?.openTokenPanel()}
              >
                查看余额监控
              </button>
            )}
            <button
              className="alert-btn primary"
              style={{ left: ackPos.left, top: ackPos.top }}
              onClick={() => window.alertApi?.close()}
            >
              我知道了
            </button>
          </div>
        ) : (
          <div className="alert-footer">
            {hasConsumption && (
              <button className="alert-btn secondary" onClick={() => window.alertApi?.openTokenPanel()}>
                查看余额监控
              </button>
            )}
            <button className="alert-btn primary" onClick={() => window.alertApi?.close()}>
              我知道了
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<AlertPage />)
