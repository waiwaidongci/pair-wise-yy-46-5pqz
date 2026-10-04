import type {
  CoAuditEvent,
  CoBatch,
  CoComputation,
  CoConflict,
  CoCountersign,
  CoCountersignBasis,
  CoItemAllocation,
  CoPolicy,
  CoPolicyAllocation,
} from './co-insurance.models'

// 共保分摊核心规则：去重、试算、会签失效、先到生效、旧案补录、本地恢复

export const now = () => new Date().toLocaleString('zh-CN', { hour12: false })

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

export const audit = (event: Omit<CoAuditEvent, 'id' | 'at'> & { at?: string }): CoAuditEvent => ({
  id: nextId('A'),
  at: event.at ?? now(),
  operator: event.operator,
  action: event.action,
  detail: event.detail,
  dedupeKey: event.dedupeKey,
})

/** 同一事故按保单号去重：重复录入的保单只保留首条，返回去重后的保单与合并条数 */
export function dedupePolicies(policies: CoPolicy[]): { policies: CoPolicy[]; merged: number } {
  const seen = new Set<string>()
  const kept: CoPolicy[] = []
  let merged = 0
  for (const policy of policies) {
    if (seen.has(policy.policyNo)) {
      merged++
      continue
    }
    seen.add(policy.policyNo)
    kept.push(policy)
  }
  return { policies: kept, merged }
}

/** 试算：按科目登记的份额/免赔额分摊，合计超过实际损失即停算并要求复核 */
export function computeBatch(batch: CoBatch): CoComputation {
  const itemAllocations: CoItemAllocation[] = batch.items.map((item) => {
    const perPolicy = item.registrations.map((reg) => ({
      policyNo: reg.policyNo,
      share: reg.share,
      deductible: reg.deductible,
      base: Math.round(item.lossAmount * (reg.share / 100)),
    }))
    return {
      itemId: item.id,
      category: item.category,
      lossAmount: item.lossAmount,
      perPolicy,
      totalBase: perPolicy.reduce((sum, entry) => sum + entry.base, 0),
    }
  })

  const allocations: CoPolicyAllocation[] = batch.policies.map((policy) => {
    const gross = itemAllocations.reduce((sum, item) => {
      const hit = item.perPolicy.find((entry) => entry.policyNo === policy.policyNo)
      return sum + (hit?.base ?? 0)
    }, 0)
    return {
      policyNo: policy.policyNo,
      insurer: policy.insurer,
      share: policy.share,
      deductible: policy.deductible,
      gross,
      payable: Math.max(0, gross - policy.deductible),
    }
  })

  const totalGross = itemAllocations.reduce((sum, item) => sum + item.totalBase, 0)
  const totalPayable = allocations.reduce((sum, policy) => sum + policy.payable, 0)
  const overLimit = totalPayable > batch.actualLoss
  return {
    allocations,
    itemAllocations,
    totalGross,
    totalPayable,
    overLimit,
    stopped: overLimit,
    stopReason: overLimit
      ? `赔付合计 ${totalPayable.toLocaleString()} 元超过实际损失 ${batch.actualLoss.toLocaleString()} 元，已停算并要求复核`
      : undefined,
  }
}

/** 会签依据快照：该科目当前各保单的份额/免赔额 */
export function basisOf(batch: CoBatch, itemId: string): CoCountersignBasis[] {
  const item = batch.items.find((loss) => loss.id === itemId)
  if (!item) return []
  return item.registrations.map((reg) => ({ policyNo: reg.policyNo, share: reg.share, deductible: reg.deductible }))
}

/**
 * 登记科目承保份额/免赔额。
 * 先到生效：同一科目同一保单已被其他受理员登记时，后到内容只留冲突、不覆盖。
 * 返回新批次（不可变更新）与冲突记录（若有）。
 */
export function submitRegistration(
  batch: CoBatch,
  itemId: string,
  input: { policyNo: string; share: number; deductible: number },
  operator: string,
): { batch: CoBatch; conflict?: CoConflict } {
  const item = batch.items.find((loss) => loss.id === itemId)
  if (!item) return { batch }
  const existing = item.registrations.find((reg) => reg.policyNo === input.policyNo)

  if (existing && existing.lockedBy !== operator) {
    const conflict = {
      id: nextId('CF'),
      at: now(),
      operator,
      policyNo: input.policyNo,
      attempted: { share: input.share, deductible: input.deductible },
      reason: `并发提交：科目 ${item.category}（${input.policyNo}）已由 ${existing.lockedBy} 先行登记，按先到生效处理，后到内容仅作冲突留痕`,
    }
    const nextBatch: CoBatch = {
      ...batch,
      items: batch.items.map((loss) => (loss.id === itemId ? { ...loss, conflicts: [...loss.conflicts, conflict] } : loss)),
      audit: [
        ...batch.audit,
        audit({
          operator,
          action: '并发冲突',
          detail: `科目 ${item.category}（${input.policyNo}）份额 ${input.share}%、免赔 ${input.deductible.toLocaleString()} 元未生效，先到受理员 ${existing.lockedBy} 已锁定该科目`,
          dedupeKey: `conflict:${itemId}:${input.policyNo}:${conflict.id}`,
        }),
      ],
    }
    return { batch: nextBatch, conflict }
  }

  const registrations = existing
    ? item.registrations.map((reg) =>
        reg.policyNo === input.policyNo
          ? { ...reg, share: input.share, deductible: input.deductible, version: reg.version + 1, lockedBy: operator, lockedAt: now() }
          : reg,
      )
    : [
        ...item.registrations,
        {
          policyNo: input.policyNo,
          share: input.share,
          deductible: input.deductible,
          version: 1,
          lockedBy: operator,
          lockedAt: now(),
        },
      ]

  // 份额或免赔额一变，受影响会签立即失效重算；旧意见保留并标出原依据
  const invalidated: string[] = []
  const countersigns = item.countersigns.map((sign) => {
    const affected = sign.basis.some(
      (snap) => snap.policyNo === input.policyNo && (snap.share !== input.share || snap.deductible !== input.deductible),
    )
    if (sign.status === '有效' && affected) {
      invalidated.push(sign.id)
      return {
        ...sign,
        status: '已失效' as const,
        invalidatedAt: now(),
        invalidatedReason: `科目 ${item.category}（${input.policyNo}）份额/免赔额变更，会签原依据已失效，需重新会签`,
      }
    }
    return sign
  })

  const nextBatch: CoBatch = {
    ...batch,
    items: batch.items.map((loss) => (loss.id === itemId ? { ...loss, registrations, countersigns } : loss)),
    audit: [
      ...batch.audit,
      audit({
        operator,
        action: existing ? '份额/免赔额变更' : '承保份额登记',
        detail: existing
          ? `科目 ${item.category}（${input.policyNo}）份额 ${existing.share}% → ${input.share}%，免赔 ${existing.deductible.toLocaleString()} → ${input.deductible.toLocaleString()} 元；${
              invalidated.length ? `${invalidated.length} 条受影响会签已失效，待重新会签` : '无受影响会签'
            }`
          : `科目 ${item.category}（${input.policyNo}）按份额 ${input.share}%、免赔 ${input.deductible.toLocaleString()} 元完成首版登记`,
        dedupeKey: `reg:${itemId}:${input.policyNo}:${existing ? existing.version + 1 : 1}`,
      }),
    ],
  }
  return { batch: nextBatch }
}

/** 发起会签：意见保留，并固化当前份额/免赔额作为会签依据 */
export function addCountersign(
  batch: CoBatch,
  itemId: string,
  input: { role: string; operator: string; opinion: string },
): CoBatch {
  const item = batch.items.find((loss) => loss.id === itemId)
  if (!item || item.registrations.length === 0) return batch
  const sign: CoCountersign = {
    id: nextId('CS'),
    role: input.role,
    operator: input.operator,
    opinion: input.opinion,
    decidedAt: now(),
    status: '有效',
    basis: basisOf(batch, itemId),
  }
  return {
    ...batch,
    items: batch.items.map((loss) => (loss.id === itemId ? { ...loss, countersigns: [...loss.countersigns, sign] } : loss)),
    audit: [
      ...batch.audit,
      audit({
        operator: input.operator,
        action: '会签依据确认',
        detail: `科目 ${item.category} 按当前份额/免赔额完成会签：${input.opinion}`,
        dedupeKey: `cs:${itemId}:${sign.id}`,
      }),
    ],
  }
}

/**
 * 旧案件缺少承保份额，先补首版：
 * 为尚未登记的科目按保单份额/免赔额补录 V1，已存在的版本不动。
 */
export function backfillShares(batch: CoBatch, operator: string): { batch: CoBatch; filledItems: number } {
  let filledItems = 0
  const items = batch.items.map((item) => {
    const missing = batch.policies.filter((policy) => !item.registrations.some((reg) => reg.policyNo === policy.policyNo))
    if (missing.length === 0) return item
    filledItems++
    const registrations: CoBatch['items'][number]['registrations'] = [
      ...item.registrations,
      ...missing.map((policy) => ({
        policyNo: policy.policyNo,
        share: policy.share,
        deductible: policy.deductible,
        version: 1,
        lockedBy: operator,
        lockedAt: now(),
      })),
    ]
    return { ...item, registrations }
  })
  if (filledItems === 0) return { batch, filledItems: 0 }
  const nextBatch: CoBatch = {
    ...batch,
    status: '计算中',
    items,
    audit: [
      ...batch.audit,
      audit({
        operator,
        action: '旧案份额补录',
        detail: `检测到 ${filledItems} 个损失科目缺少承保份额，已按保单份额/免赔额补录首版 V1（${batch.policies
          .map((p) => `${p.policyNo} ${p.share}%/${p.deductible.toLocaleString()} 元`)
          .join('，')}）`,
        dedupeKey: `backfill:${batch.accidentNo}`,
      }),
    ],
  }
  return { batch: nextBatch, filledItems }
}

/** 保单去重 + 试算后刷新批次状态/复核原因 */
export function refreshBatch(batch: CoBatch): CoBatch {
  const { policies, merged } = dedupePolicies(batch.policies)
  const computation = computeBatch({ ...batch, policies })
  const auditEvents = [...batch.audit]
  if (merged > 0) {
    auditEvents.push(
      audit({
        operator: '系统',
        action: '保单去重',
        detail: `同一事故按保单号去重，合并重复录入保单 ${merged} 条（${policies.map((p) => p.policyNo).join('、')}）`,
        dedupeKey: `dedupe:${batch.accidentNo}`,
      }),
    )
  }
  const status: CoBatch['status'] = computation.overLimit
    ? '待复核'
    : batch.status === '待补录'
      ? '待补录'
      : '计算中'
  return {
    ...batch,
    policies,
    mergedCount: (batch.mergedCount ?? 0) + merged,
    status,
    reviewReason: computation.stopReason,
    audit: auditEvents,
  }
}

/** 本地草稿：按事故号保存，写入失败后据此恢复 */
export const draftKey = (accidentNo: string) => `co-batch-draft-v1-${accidentNo}`

export function saveDraft(batch: CoBatch) {
  localStorage.setItem(draftKey(batch.accidentNo), JSON.stringify(batch))
}

export function loadDraft(accidentNo: string): CoBatch | null {
  const raw = localStorage.getItem(draftKey(accidentNo))
  if (!raw) return null
  try {
    return JSON.parse(raw) as CoBatch
  } catch {
    return null
  }
}

export function listDraftAccidents(): string[] {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith('co-batch-draft-v1-'))
    .map((key) => key.replace('co-batch-draft-v1-', ''))
}

/** 从本地草稿恢复批次；恢复动作本身记审计，但幂等键保证重试不重复追加 */
export function restoreDraft(accidentNo: string, operator: string): CoBatch | null {
  const draft = loadDraft(accidentNo)
  if (!draft) return null
  const alreadyRestored = draft.audit.some((event) => event.action === '本地恢复')
  return {
    ...draft,
    audit: alreadyRestored
      ? draft.audit
      : [
          ...draft.audit,
          audit({
            operator,
            action: '本地恢复',
            detail: `写入失败后按事故号 ${accidentNo} 从本地草稿恢复批次，可重新提交`,
            dedupeKey: `restore:${accidentNo}`,
          }),
        ],
  }
}
