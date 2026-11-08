// Shared event shape for the forced popup window.
// Both rapid-consumption alerts and scheduled reminders use the same window.

export interface ConsumptionAlertEvent {
  kind: 'consumption'
  ruleId: string
  ruleName: string
  windowMinutes: number
  threshold: number
  consumed: number
  triggeredAt: number
}

export interface ReminderAlertEvent {
  kind: 'reminder'
  reminderId: string
  title: string
  note: string
  scheduledAt: number
  triggeredAt: number
}

export type AlertEvent = ConsumptionAlertEvent | ReminderAlertEvent
