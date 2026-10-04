import { HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import { seedCoinsuranceBatches } from './coinsurance.seed'
import { activeRegistrations, basisLabel, isOverrun, refreshBatchStatus } from './coinsurance.logic'
import type { CoinsuranceBatch, LossSubject, SubjectRegistration } from './models'

let claims = structuredClone(seedClaims)
let coinsuranceBatches = structuredClone(seedCoinsuranceBatches)

/** 已模拟过“写入成功但响应丢失”的 事故号:端点 组合，首次之后的重试正常返回 */
const lostWriteResponses = new Set<string>()

const nowText = () => new Date().toLocaleString('zh-CN')

function appendAudit(batch: CoinsuranceBatch, entry: { id: string; operator: string; action: string; detail: string }) {
  // 幂等：同一 auditId 不重复追加，重试不会产生重复审计
  if (batch.audit.some((item) => item.id === entry.id)) return false
  batch.audit.push({ ...entry, at: nowText() })
  return true
}

function findSubject(batch: CoinsuranceBatch, subjectKey: string): LossSubject | undefined {
  return batch.subjects.find((subject) => subject.key === subjectKey)
}

function findActiveReg(subject: LossSubject, policyNo: string): SubjectRegistration | undefined {
  return activeRegistrations(subject).find((reg) => reg.policyNo === policyNo)
}

function ok<T>(body: T, status = 200, latency = 180) {
  return of(new HttpResponse({ status, body })).pipe(delay(latency))
}

function fail(status: number, message: string) {
  return throwError(() => new HttpErrorResponse({ status, error: { message } })).pipe(delay(160))
}

function handleCoinsurance(request: HttpRequest<unknown>) {
  const parts = request.url.split('/')
  const accidentNo = parts[4] ?? ''
  const action = parts[5] ?? ''

  if (request.method === 'GET' && request.url === '/api/coinsurance/batches') {
    return ok(coinsuranceBatches, 200, 220)
  }

  const batch = coinsuranceBatches.find((item) => item.accidentNo === accidentNo)
  if (!batch) return fail(404, '事故批次不存在')

  // 科目登记：同一科目同一保单先到生效，后到留冲突
  if (request.method === 'POST' && action === 'registrations') {
    const body = request.body as {
      subjectKey: string
      policyNo: string
      insurer: string
      share: number
      deductible: number
      submittedBy: string
      auditId: string
    }
    const subject = findSubject(batch, body.subjectKey)
    if (!subject) return fail(404, '损失科目不存在')
    const duplicated = subject.registrations.some((reg) => reg.policyNo === body.policyNo && reg.status === '生效')
    const registration: SubjectRegistration = {
      id: `REG-${accidentNo}-${subject.key}-${subject.registrations.length + 1}`,
      policyNo: body.policyNo,
      insurer: body.insurer,
      share: body.share,
      deductible: body.deductible,
      status: duplicated ? '冲突' : '生效',
      submittedBy: body.submittedBy,
      submittedAt: nowText(),
      versions: [{ version: 1, share: body.share, deductible: body.deductible, reason: '初始登记', operator: body.submittedBy, createdAt: nowText() }],
    }
    subject.registrations.push(registration)
    appendAudit(batch, {
      id: body.auditId,
      operator: body.submittedBy,
      action: duplicated ? '科目登记冲突留存' : '科目登记',
      detail: duplicated
        ? `${subject.name} · ${body.policyNo} 已存在生效登记，本次提交保留为冲突（先到生效，后到留冲突），不参与分摊。`
        : `${subject.name} · ${body.policyNo} 登记承保份额 ${Math.round(body.share * 100)}%、免赔额 ${body.deductible.toLocaleString('zh-CN')} 元。`,
    })
    refreshBatchStatus(batch)
    return ok(batch, 201)
  }

  // 份额/免赔调整：受影响会签立即失效重算；首次写入模拟“响应丢失”，重试按 auditId 幂等
  if (request.method === 'POST' && action === 'shares') {
    const body = request.body as {
      subjectKey: string
      policyNo: string
      share: number
      deductible: number
      reason: string
      operator: string
      auditId: string
    }
    const subject = findSubject(batch, body.subjectKey)
    const registration = subject ? findActiveReg(subject, body.policyNo) : undefined
    if (!subject || !registration) return fail(404, '生效登记不存在')
    if (registration.share == null || registration.deductible == null) return fail(409, '该登记缺少承保份额，请先补录首版')

    const applyShareChange = () => {
      const oldShare = registration.share as number
      const oldDeductible = registration.deductible as number
      registration.versions.push({
        version: registration.versions.length + 1,
        share: body.share,
        deductible: body.deductible,
        reason: body.reason,
        operator: body.operator,
        createdAt: nowText(),
      })
      registration.share = body.share
      registration.deductible = body.deductible
      subject.version += 1
      // 份额或免赔额一变，本科目受影响会签立即失效，旧意见保留并标出原依据
      const invalidated = batch.opinions.filter((opinion) => opinion.subjectKey === subject.key && opinion.status === '有效')
      for (const opinion of invalidated) {
        opinion.status = '已失效'
        opinion.invalidatedAt = nowText()
      }
      appendAudit(batch, {
        id: body.auditId,
        operator: body.operator,
        action: '份额/免赔调整',
        detail:
          `${subject.name} · ${registration.policyNo} 份额 ${Math.round(oldShare * 100)}% → ${Math.round(body.share * 100)}%，` +
          `免赔 ${oldDeductible.toLocaleString('zh-CN')} → ${body.deductible.toLocaleString('zh-CN')} 元；` +
          `${invalidated.length} 条受影响会签已失效并保留原依据，分摊重算。`,
      })
      refreshBatchStatus(batch)
    }

    const lossKey = `shares:${accidentNo}`
    if (!lostWriteResponses.has(lossKey)) {
      // 模拟写入已提交但响应丢失：变更已落库，客户端只能按事故号恢复本地批次后重试
      lostWriteResponses.add(lossKey)
      applyShareChange()
      return fail(500, '写入结果未知：请按事故号恢复本地批次后重试，重试不会重复追加审计')
    }
    if (batch.audit.some((entry) => entry.id === body.auditId)) {
      // 重试命中同一 auditId：变更与审计均已存在，直接返回当前批次
      return ok(batch)
    }
    applyShareChange()
    return ok(batch)
  }

  // 会签：停算或待补录时拒绝；意见记录当前依据快照
  if (request.method === 'POST' && action === 'opinions') {
    const body = request.body as { subjectKey: string; role: string; result: string; comment: string; operator: string; auditId: string }
    if (batch.status === '超限停算') return fail(409, '分摊合计超过实际损失，已停算，须主管复核后才能继续会签')
    if (batch.status === '待补录') return fail(409, '旧案件缺少承保份额，请先补录首版')
    const subject = findSubject(batch, body.subjectKey)
    if (!subject) return fail(404, '损失科目不存在')
    batch.opinions.push({
      id: `OP-${accidentNo}-${batch.opinions.length + 1}`,
      subjectKey: subject.key,
      role: body.role,
      result: body.result === '退回' ? '退回' : '同意',
      comment: body.comment,
      operator: body.operator,
      createdAt: nowText(),
      basisVersion: subject.version,
      basisLabel: basisLabel(subject),
      status: '有效',
    })
    appendAudit(batch, {
      id: body.auditId,
      operator: body.operator,
      action: '会签意见',
      detail: `${subject.name} · ${body.role}${body.result}：${body.comment}（依据 V${subject.version}：${basisLabel(subject)}）。`,
    })
    return ok(batch, 201)
  }

  // 旧案件补录首版份额
  if (request.method === 'POST' && action === 'backfill') {
    const body = request.body as { subjectKey: string; policyNo: string; share: number; deductible: number; operator: string; auditId: string }
    const subject = findSubject(batch, body.subjectKey)
    const registration = subject ? findActiveReg(subject, body.policyNo) : undefined
    if (!subject || !registration) return fail(404, '生效登记不存在')
    if (registration.share != null) return fail(409, '该登记已有承保份额，请走份额调整')
    registration.share = body.share
    registration.deductible = body.deductible
    registration.versions.push({
      version: 1,
      share: body.share,
      deductible: body.deductible,
      reason: '旧案件补录首版',
      operator: body.operator,
      createdAt: nowText(),
    })
    subject.version = Math.max(subject.version, 1)
    appendAudit(batch, {
      id: body.auditId,
      operator: body.operator,
      action: '补录首版份额',
      detail: `${subject.name} · ${registration.policyNo} 补录首版：份额 ${Math.round(body.share * 100)}%、免赔额 ${body.deductible.toLocaleString('zh-CN')} 元。`,
    })
    refreshBatchStatus(batch)
    return ok(batch)
  }

  // 主管复核：合计降回实际损失以内才允许解除停算
  if (request.method === 'POST' && action === 'review') {
    const body = request.body as { comment: string; operator: string; auditId: string }
    if (batch.status !== '超限停算') return fail(409, '当前批次未处于停算状态')
    if (isOverrun(batch)) return fail(409, '分摊合计仍超过实际损失，不能解除停算')
    batch.status = '计算中'
    batch.reviewNote = `主管复核通过：${body.comment}`
    appendAudit(batch, {
      id: body.auditId,
      operator: body.operator,
      action: '主管复核',
      detail: `解除停算：${body.comment}。复核后分摊合计未超过实际损失。`,
    })
    return ok(batch)
  }

  return fail(404, '未知接口')
}

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)
  if (request.url.startsWith('/api/coinsurance/')) return handleCoinsurance(request)

  if (request.method === 'GET' && request.url === '/api/claims') {
    const query = request.params.get('query')?.toLowerCase() ?? ''
    const status = request.params.get('status') ?? ''
    const risk = request.params.get('risk') ?? ''
    const page = Number(request.params.get('page') ?? 1)
    const pageSize = Number(request.params.get('pageSize') ?? 10)
    const filtered = claims.filter(
      (item) =>
        (!query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(query)) &&
        (!status || item.status === status) &&
        (!risk || item.riskLevel === risk),
    )
    const start = (page - 1) * pageSize
    return of(new HttpResponse({ status: 200, body: { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize } })).pipe(delay(220))
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = claims.find((claim) => claim.id === id)
    return item ? of(new HttpResponse({ status: 200, body: item })).pipe(delay(120)) : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { itemId: string; amount: number; reason: string }
    const item = claims.find((claim) => claim.id === id)?.lossItems.find((loss) => loss.id === body.itemId)
    if (!item) return throwError(() => new HttpErrorResponse({ status: 404 }))
    item.repairQuotes.push({
      version: item.repairQuotes.length + 1,
      amount: body.amount,
      reason: body.reason,
      operator: '当前用户',
      createdAt: new Date().toLocaleString('zh-CN'),
    })
    return of(new HttpResponse({ status: 201, body: item })).pipe(delay(180))
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as { role: string; result: string; comment: string }
    const item = claims.find((claim) => claim.id === id)
    const step = item?.approvals.find((approval) => approval.role === body.role)
    if (!item || !step) return throwError(() => new HttpErrorResponse({ status: 404 }))
    step.status = body.result === '已通过' ? '已通过' : '已退回'
    step.operator = '当前用户'
    step.comment = body.comment
    step.completedAt = new Date().toLocaleString('zh-CN')
    item.audit.push({ id: `A-${Date.now()}`, at: '刚刚', operator: '当前用户', action: `会签${step.status}`, detail: body.comment })
    item.status = body.result === '已通过' ? '审批中' : '退回补件'
    return of(new HttpResponse({ status: 200, body: item })).pipe(delay(180))
  }

  return next(request)
}
