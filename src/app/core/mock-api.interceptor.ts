import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import { seedCoBatches } from './co-insurance.seed'
import { refreshBatch } from './co-insurance.logic'
import type { CoBatch } from './co-insurance.models'

let claims = structuredClone(seedClaims)
let coBatches: CoBatch[] = seedCoBatches.map((batch) => refreshBatch(structuredClone(batch)))

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)

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

  if (request.method === 'GET' && request.url === '/api/co-batches') {
    return of(new HttpResponse({ status: 200, body: { items: coBatches } })).pipe(delay(220))
  }

  if (request.method === 'GET' && request.url.startsWith('/api/co-batches/')) {
    const accidentNo = decodeURIComponent(request.url.split('/').pop() ?? '')
    const batch = coBatches.find((item) => item.accidentNo === accidentNo)
    return batch ? of(new HttpResponse({ status: 200, body: batch })).pipe(delay(120)) : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  if (request.method === 'POST' && request.url === '/api/co-batches') {
    // 模拟写入失败：调用方按事故号恢复本地批次后重试
    if (request.headers.has('X-Simulate-Fail')) {
      return throwError(() => new HttpErrorResponse({ status: 500, error: { message: '模拟写入失败：服务端未保存' } })).pipe(delay(120))
    }
    const body = request.body as CoBatch
    const existing = coBatches.find((item) => item.accidentNo === body.accidentNo)
    if (existing) {
      // 审计幂等：按 dedupeKey 去重，重试不会重复追加审计
      const knownKeys = new Set(existing.audit.map((event) => event.dedupeKey).filter(Boolean))
      const mergedAudit = [...existing.audit]
      for (const event of body.audit) {
        if (event.dedupeKey && knownKeys.has(event.dedupeKey)) continue
        mergedAudit.push(event)
        if (event.dedupeKey) knownKeys.add(event.dedupeKey)
      }
      const saved = refreshBatch({ ...body, audit: mergedAudit })
      coBatches = coBatches.map((item) => (item.accidentNo === saved.accidentNo ? saved : item))
      return of(new HttpResponse({ status: 200, body: saved })).pipe(delay(180))
    }
    const saved = refreshBatch(structuredClone(body))
    coBatches = [...coBatches, saved]
    return of(new HttpResponse({ status: 201, body: saved })).pipe(delay(180))
  }

  return next(request)
}
