export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

export type Attachment = {
  id: string
  name: string
  category: '现场照片' | '修复报告' | '专家意见' | '保单摘录'
  version: number
  uploadedBy: string
  uploadedAt: string
}

export type LossItem = {
  id: string
  category: string
  description: string
  damage: string
  repairQuotes: Array<{ version: number; amount: number; reason: string; operator: string; createdAt: string }>
  salvage: number
  liability: number
  disputed: boolean
  attachments: Attachment[]
  expertNotes: string[]
}

export type ApprovalStep = {
  role: string
  threshold: number
  status: '待处理' | '已通过' | '已退回'
  operator?: string
  comment?: string
  completedAt?: string
}

export type ClaimCase = {
  id: string
  policyNo: string
  insured: string
  lossAddress: string
  accidentDate: string
  reportedAt: string
  adjuster: string
  status: ClaimStatus
  riskLevel: '低' | '中' | '高'
  reserve: number
  paid: number
  deductible: number
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: Array<{ id: string; at: string; operator: string; action: string; detail: string }>
}

export type ClaimFilters = {
  query: string
  status: string
  risk: string
  page: number
  pageSize: number
}

export type PagedClaims = {
  items: ClaimCase[]
  total: number
  page: number
  pageSize: number
}

// ---- 共保分摊批次 ----

export type CoinsuranceBatchStatus = '待补录' | '计算中' | '超限停算'

/** 同一事故下的一笔立案；多张立案按保单号去重 */
export type PolicyFiling = {
  claimId: string
  policyNo: string
  insurer: string
  handler: string
  filedAt: string
}

/** 承保份额 / 免赔额的一个版本（旧案件补录时从 V1 开始） */
export type ShareVersion = {
  version: number
  share: number
  deductible: number
  reason: string
  operator: string
  createdAt: string
}

/** 某科目下某保单的一次登记；先到生效，后到留冲突 */
export type SubjectRegistration = {
  id: string
  policyNo: string
  insurer: string
  share: number | null
  deductible: number | null
  status: '生效' | '冲突'
  submittedBy: string
  submittedAt: string
  versions: ShareVersion[]
}

export type LossSubject = {
  key: string
  name: string
  actualLoss: number
  /** 依据版本：份额或免赔额变化时 +1，用于定位受影响会签 */
  version: number
  registrations: SubjectRegistration[]
}

/** 会签意见；失效后保留，并标出提交时的原依据 */
export type ApprovalOpinion = {
  id: string
  subjectKey: string
  role: string
  result: '同意' | '退回'
  comment: string
  operator: string
  createdAt: string
  basisVersion: number
  basisLabel: string
  status: '有效' | '已失效'
  invalidatedAt?: string
}

export type CoinsuranceBatch = {
  accidentNo: string
  title: string
  accidentDate: string
  site: string
  actualLoss: number
  status: CoinsuranceBatchStatus
  reviewNote: string
  filings: PolicyFiling[]
  subjects: LossSubject[]
  opinions: ApprovalOpinion[]
  audit: Array<{ id: string; at: string; operator: string; action: string; detail: string }>
}
