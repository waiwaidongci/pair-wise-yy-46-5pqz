// 共保分摊批次领域模型：事故 → 保单 → 损失科目 → 会签依据

export type CoBatchStatus = '待补录' | '计算中' | '待复核' | '已锁定'

export type CoPolicy = {
  policyNo: string // 保单号（同一事故内按保单号去重）
  insurer: string // 承保公司
  share: number // 承保份额 %
  deductible: number // 免赔额（元/事故）
  enteredBy: string // 受理员
}

export type CoRegistration = {
  policyNo: string
  share: number // 承保份额 %
  deductible: number // 免赔额（元）
  version: number // 份额版本（旧案件补录从 V1 起）
  lockedBy: string // 先到生效的受理员
  lockedAt: string
}

export type CoCountersignBasis = {
  policyNo: string
  share: number
  deductible: number
}

export type CoCountersign = {
  id: string
  role: string // 会签角色
  operator: string
  opinion: string
  decidedAt: string
  status: '有效' | '已失效'
  basis: CoCountersignBasis[] // 会签时的原依据快照（份额/免赔额）
  invalidatedAt?: string
  invalidatedReason?: string
}

export type CoConflict = {
  id: string
  at: string
  operator: string
  policyNo: string
  attempted: { share: number; deductible: number }
  reason: string
}

export type CoLossItem = {
  id: string
  category: string
  description: string
  lossAmount: number // 科目损失金额（元）
  registrations: CoRegistration[] // 按保单登记的承保份额/免赔额
  countersigns: CoCountersign[]
  conflicts: CoConflict[]
}

export type CoAuditEvent = {
  id: string
  at: string
  operator: string
  action: string
  detail: string
  dedupeKey?: string // 幂等键：重试提交时服务端据此去重，不重复追加审计
}

export type CoBatch = {
  accidentNo: string // 事故号（批次主键，本地草稿按此恢复）
  insured: string
  lossAddress: string
  accidentDate: string
  actualLoss: number // 实际损失（元），赔付合计不得超过它
  status: CoBatchStatus
  policies: CoPolicy[]
  mergedCount?: number // 按保单号去重合并的重复录入条数
  items: CoLossItem[]
  audit: CoAuditEvent[]
  reviewReason?: string // 停算要求复核的原因
}

export type CoPolicyAllocation = {
  policyNo: string
  insurer: string
  share: number
  deductible: number
  gross: number // 科目分摊合计 = Σ 损失金额 × 份额
  payable: number // 赔付 = max(0, gross - 免赔额)
}

export type CoItemAllocation = {
  itemId: string
  category: string
  lossAmount: number
  perPolicy: Array<{ policyNo: string; share: number; deductible: number; base: number }>
  totalBase: number // 该科目分摊基数合计
}

export type CoComputation = {
  allocations: CoPolicyAllocation[]
  itemAllocations: CoItemAllocation[]
  totalGross: number // 分摊基数合计
  totalPayable: number // 赔付合计（扣免赔后）
  overLimit: boolean // 合计是否超过实际损失
  stopped: boolean // 是否停算
  stopReason?: string
}
