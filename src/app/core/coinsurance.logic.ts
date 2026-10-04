import type { CoinsuranceBatch, LossSubject, PolicyFiling, SubjectRegistration } from './models'

export type UniquePolicy = {
  policyNo: string
  insurer: string
  filings: PolicyFiling[]
}

/** 同一事故按保单号去重，重复立案合并到同一张保单下 */
export function uniquePolicies(batch: CoinsuranceBatch): UniquePolicy[] {
  const map = new Map<string, UniquePolicy>()
  for (const filing of batch.filings) {
    const existing = map.get(filing.policyNo)
    if (existing) existing.filings.push(filing)
    else map.set(filing.policyNo, { policyNo: filing.policyNo, insurer: filing.insurer, filings: [filing] })
  }
  return [...map.values()]
}

export function activeRegistrations(subject: LossSubject): SubjectRegistration[] {
  return subject.registrations.filter((reg) => reg.status === '生效')
}

export function conflictRegistrations(subject: LossSubject): SubjectRegistration[] {
  return subject.registrations.filter((reg) => reg.status === '冲突')
}

/** 单条生效登记的分摊额；旧案件缺少份额/免赔时按 0 计，等待补录首版 */
export function apportionedFor(subject: LossSubject, reg: SubjectRegistration): number {
  if (reg.share == null || reg.deductible == null) return 0
  return Math.max(0, subject.actualLoss - reg.deductible) * reg.share
}

export function subjectApportioned(subject: LossSubject): number {
  return activeRegistrations(subject).reduce((sum, reg) => sum + apportionedFor(subject, reg), 0)
}

export function batchApportioned(batch: CoinsuranceBatch): number {
  return batch.subjects.reduce((sum, subject) => sum + subjectApportioned(subject), 0)
}

/** 合计超过实际损失即超限，需要停算复核 */
export function isOverrun(batch: CoinsuranceBatch): boolean {
  return batchApportioned(batch) > batch.actualLoss
}

export function hasMissingShares(batch: CoinsuranceBatch): boolean {
  return batch.subjects.some((subject) => activeRegistrations(subject).some((reg) => reg.share == null || reg.deductible == null))
}

/** 会签依据快照：当前生效登记的份额与免赔额 */
export function basisLabel(subject: LossSubject): string {
  const regs = activeRegistrations(subject)
  const shares = regs.map((reg) => (reg.share == null ? '缺失' : `${Math.round(reg.share * 100)}%`)).join('/')
  const deductibles = regs.map((reg) => (reg.deductible == null ? '缺失' : `${(reg.deductible / 10000).toFixed(1)}万`)).join('/')
  return `份额 ${shares} · 免赔 ${deductibles}`
}

/**
 * 每次登记/份额变更后重算批次状态：
 * 缺份额 → 待补录；合计超限 → 停算并要求复核；超限后即使调回也需人工复核解除。
 */
export function refreshBatchStatus(batch: CoinsuranceBatch): void {
  if (hasMissingShares(batch)) {
    batch.status = '待补录'
    return
  }
  if (isOverrun(batch)) {
    if (batch.status !== '超限停算') batch.reviewNote = '分摊合计超过实际损失，已自动停算，需主管复核后方可继续会签。'
    batch.status = '超限停算'
    return
  }
  if (batch.status !== '超限停算') batch.status = '计算中'
}
